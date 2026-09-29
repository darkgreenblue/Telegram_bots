import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from bot import MAX_FILE, on_message, parse_message
from notebook import generate, upload
from store import Store


class CollectionTests(unittest.TestCase):
    def test_multiline_text_stays_one_source(self):
        message = SimpleNamespace(document=None, video=None, audio=None, text="اولین بند\nدومین بند")
        self.assertEqual(parse_message(message), [{"kind": "text", "value": message.text}])

    def test_links_are_separate_sources(self):
        message = SimpleNamespace(document=None, video=None, audio=None, text="https://example.com\nhttps://youtu.be/abc")
        self.assertEqual([item["kind"] for item in parse_message(message)], ["url", "url"])

    def test_large_file_is_held_for_end_of_collection(self):
        document = SimpleNamespace(file_id="id", file_name="paper.pdf", file_size=MAX_FILE + 1)
        message = SimpleNamespace(document=document, video=None, audio=None, text=None)
        self.assertIn("error", parse_message(message)[0])

    def test_restart_retains_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bot.db"
            Store(path).put(42, {"state": "collecting", "inputs": [{"kind": "text", "value": "سلام"}]})
            self.assertEqual(Store(path).get(42)["inputs"][0]["value"], "سلام")


class GenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_upload_retries_redirect_and_reuses_url_created_before_failure(self):
        source = SimpleNamespace(id="source-1", url="https://youtu.be/abc")

        class Sources:
            def __init__(self):
                self.items = []
                self.add_url = AsyncMock(side_effect=self.create)

            async def list(self, notebook_id):
                return self.items

            async def create(self, notebook_id, url, *, wait):
                self.items.append(source)
                raise ValueError("CSRF token not found in HTML. Final URL: https://notebook.google/")

        class Client:
            sources = Sources()

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return None

        client = Client()
        session = {
            "batch_id": "batch", "notebook_id": "notebook-1",
            "inputs": [{"kind": "url", "value": "https://youtu.be/abc"}],
        }
        with patch("notebook.NotebookLMClient.from_storage", return_value=client), \
             patch("notebook.asyncio.sleep", new_callable=AsyncMock):
            await upload(session, lambda s: None, None, "profile")
        self.assertEqual(client.sources.add_url.await_count, 1)
        self.assertEqual(session["inputs"][0]["source_id"], "source-1")

    async def test_text_upload_retries_without_unsupported_idempotent_flag(self):
        created = SimpleNamespace(id="source-1", title="Telegram text batch-1")

        class Sources:
            def __init__(self):
                self.items = []
                self.add_text = AsyncMock(side_effect=self.create)

            async def list(self, notebook_id):
                return self.items

            async def create(self, notebook_id, title, content, *, wait):
                self.items.append(created)
                return created

        class Client:
            sources = Sources()

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return None

        client = Client()
        session = {
            "batch_id": "batch", "notebook_id": "notebook-1", "inputs": [
                {"kind": "text", "value": "متن آزمایشی"}
            ],
        }
        with patch("notebook.NotebookLMClient.from_storage", return_value=client):
            await upload(session, lambda s: None, None, "profile")
            self.assertEqual(session["inputs"][0]["source_id"], "source-1")
            self.assertEqual(client.sources.add_text.await_count, 1)
            self.assertEqual(client.sources.add_text.await_args.kwargs, {"wait": True})

            # A retry after the remote write should reuse the titled source.
            session["inputs"][0].pop("source_id")
            await upload(session, lambda s: None, None, "profile")
            self.assertEqual(client.sources.add_text.await_count, 1)
            self.assertEqual(session["inputs"][0]["source_id"], "source-1")

    async def test_collecting_input_is_persisted_without_reply(self):
        with tempfile.TemporaryDirectory() as tmp:
            local_store = Store(Path(tmp) / "bot.db")
            local_store.put(42, {"state": "collecting", "inputs": []})
            message = SimpleNamespace(
                text="یک متن برای پادکست", document=None, video=None, audio=None,
                reply_text=AsyncMock(),
            )
            update = SimpleNamespace(
                effective_user=SimpleNamespace(id=42),
                effective_chat=SimpleNamespace(type="private"),
                effective_message=message,
            )
            with patch("bot.store", local_store), patch("bot.OWNER_IDS", {42}):
                await on_message(update, SimpleNamespace(application=None))
            message.reply_text.assert_not_awaited()
            self.assertEqual(local_store.get(42)["inputs"][0]["value"], message.text)

    async def test_persian_long_length_is_sent_to_notebooklm(self):
        calls = {}

        class Artifacts:
            async def generate_audio(self, notebook_id, **options):
                calls.update(options)
                return SimpleNamespace(task_id="task-1")

            async def wait_for_completion(self, *args, **kwargs):
                return SimpleNamespace(is_complete=True)

            async def download_audio(self, notebook_id, path, artifact_id):
                Path(path).write_bytes(b"audio")

        class Client:
            artifacts = Artifacts()

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return None

        with tempfile.TemporaryDirectory() as tmp:
            session = {
                "batch_id": "batch", "work_dir": tmp, "notebook_id": "notebook-1",
                "inputs": [{"source_id": "source-1"}], "format": "deep-dive",
                "length": "long", "language": "fa", "prompt": "عمیق توضیح بده",
            }
            with patch("notebook.NotebookLMClient.from_storage", return_value=Client()):
                result = await generate(session, lambda s: None, "profile")
            self.assertEqual(result.read_bytes(), b"audio")
            self.assertEqual(calls["language"], "fa")
            self.assertEqual(calls["audio_length"].name, "LONG")
            self.assertEqual(calls["instructions"], "عمیق توضیح بده")


if __name__ == "__main__":
    unittest.main()
