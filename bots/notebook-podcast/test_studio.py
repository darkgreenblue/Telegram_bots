import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import bot
import studio
from store import Store


class _Client:
    def __init__(self):
        self.artifacts = SimpleNamespace(
            generate_slide_deck=AsyncMock(return_value=SimpleNamespace(task_id="task-1")),
            wait_for_completion=AsyncMock(return_value=SimpleNamespace(is_complete=True)),
            download_slide_deck=AsyncMock(side_effect=self._download),
        )

    async def _download(self, notebook_id, path, **kwargs):
        Path(path).write_bytes(b"PPTX content")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None


class StudioTests(unittest.IsolatedAsyncioTestCase):
    def test_output_buttons_use_short_type_ids(self):
        markup = bot.output_buttons("a" * 32)
        data = [row[0].callback_data for row in markup.inline_keyboard]
        self.assertEqual({item.split(":")[-1] for item in data}, set(studio.KIND_LABELS))
        self.assertTrue(all(len(item.encode()) <= 64 for item in data))

    async def test_empty_old_collection_can_be_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            local_store = Store(Path(tmp) / "db.sqlite")
            local_store.put(42, {"batch_id": "old", "state": "collecting", "inputs": [], "notebook_title": "Old automatic title"})
            message = SimpleNamespace(reply_text=AsyncMock(return_value=SimpleNamespace(message_id=12)))
            update = SimpleNamespace(effective_user=SimpleNamespace(id=42), message=message)
            with patch.object(bot, "store", local_store):
                await bot.begin(update, SimpleNamespace())
            self.assertEqual(local_store.get(42, "old")["state"], "title")
            self.assertEqual(local_store.get(42, "old")["notebook_title"], "")
            self.assertEqual(local_store.open_count(42), 1)

    async def test_slide_generation_saves_task_and_downloads_pptx(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = {"batch_id": "abc", "work_dir": tmp, "notebook_id": "nb", "source_ids": ["src"],
                       "output_type": "slides", "language": "fa", "settings": {"file_format": "pptx"}}
            client = _Client()
            snapshots = []
            with patch.object(studio.NotebookLMClient, "from_storage", return_value=client):
                output = await studio.generate_artifact(session, lambda s: snapshots.append(s.copy()), "profile")
            self.assertEqual(output.suffix, ".pptx")
            self.assertEqual(output.read_bytes(), b"PPTX content")
            self.assertEqual(snapshots[0]["task_id"], "task-1")
            self.assertEqual(client.artifacts.download_slide_deck.await_args.kwargs,
                             {"artifact_id": "task-1", "output_format": "pptx"})

    async def test_reused_notebook_can_start_new_output_without_sources_upload(self):
        with tempfile.TemporaryDirectory() as tmp:
            local_store = Store(Path(tmp) / "db.sqlite")
            local_store.put(42, {"batch_id": "original", "state": "done", "notebook_id": "nb",
                                 "notebook_title": "My notes", "source_ids": ["src"], "inputs": []})
            message = SimpleNamespace(reply_text=AsyncMock())
            with patch.object(bot, "store", local_store), patch.object(bot, "DATA", Path(tmp)):
                notebooks = bot.saved_notebooks(42)
                self.assertEqual(len(notebooks), 1)
                await bot.choose_notebook(42, notebooks[0], message)
                fresh = local_store.get(42)
                self.assertEqual(fresh["state"], "output_type")
                self.assertEqual(fresh["notebook_id"], "nb")
                self.assertEqual(fresh["source_ids"], ["src"])
                self.assertEqual(fresh["inputs"], [])


if __name__ == "__main__":
    unittest.main()
