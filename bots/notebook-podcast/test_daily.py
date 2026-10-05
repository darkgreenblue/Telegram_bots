"""Dated Notion lesson ingestion and the 06:00/06:30 delivery boundary."""

import tempfile
import unittest
from types import SimpleNamespace
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import httpx

import bot
from daily import NotionLessons, make_session, send_due, start_due
from store import Store
from studio import output_path


TEHRAN = ZoneInfo("Asia/Tehran")


class DailyTests(unittest.IsolatedAsyncioTestCase):
    async def test_notion_reads_all_pages_and_nested_blocks_as_one_source(self):
        calls = []

        def response(request):
            calls.append(request)
            if request.url.path.endswith("/query"):
                return httpx.Response(200, json={"results": [{
                    "id": "lesson-id", "url": "https://notion.so/lesson-id",
                    "properties": {"عنوان": {"title": [{"plain_text": "درس امروز"}]}},
                }], "has_more": False})
            if request.url.path.endswith("lesson-id/children") and "start_cursor" not in request.url.params:
                return httpx.Response(200, json={"results": [
                    {"id": "one", "type": "heading_2", "heading_2": {"rich_text": [{"plain_text": "بخش اول"}]}},
                    {"id": "table-id", "type": "table", "table": {}, "has_children": True},
                ], "has_more": True, "next_cursor": "page-two"})
            if request.url.path.endswith("lesson-id/children"):
                return httpx.Response(200, json={"results": [
                    {"id": "toggle-id", "type": "toggle", "toggle": {"rich_text": [{"plain_text": "یادداشت سازنده"}]}, "has_children": True},
                ], "has_more": False})
            if request.url.path.endswith("table-id/children"):
                return httpx.Response(200, json={"results": [{"id": "row", "type": "table_row", "table_row": {"cells": [[{"plain_text": "ستون یک"}], [{"plain_text": "ستون دو"}]]}}], "has_more": False})
            if request.url.path.endswith("toggle-id/children"):
                return httpx.Response(200, json={"results": [{"id": "note", "type": "paragraph", "paragraph": {"rich_text": [{"plain_text": "گفت‌وگوی دو نفره با جزئیات کامل"}]}}], "has_more": False})
            raise AssertionError(request.url)

        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as http:
            lesson = await NotionLessons("test-token", http).lesson_for_date("2026-10-05")
        self.assertEqual(len(calls), 5)
        self.assertIn("ستون یک | ستون دو", lesson["text"])
        self.assertIn("گفت‌وگوی دو نفره با جزئیات کامل", lesson["text"])
        self.assertEqual(lesson["title"], "درس امروز")
        session = make_session(123, "a" * 32, "2026-10-05", lesson, Path("/tmp/data"))
        self.assertEqual(len(session["inputs"]), 1)
        self.assertEqual(session["settings"], {"audio_format": "deep-dive", "audio_length": "long"})
        self.assertEqual(session["language"], "fa")
        self.assertEqual(session["prompt"], "")

    def test_schedule_starts_at_six_and_sends_at_six_thirty(self):
        self.assertFalse(start_due(datetime(2026, 10, 5, 5, 59, tzinfo=TEHRAN)))
        self.assertTrue(start_due(datetime(2026, 10, 5, 6, 0, tzinfo=TEHRAN)))
        self.assertFalse(send_due("2026-10-05", datetime(2026, 10, 5, 6, 29, tzinfo=TEHRAN)))
        self.assertTrue(send_due("2026-10-05", datetime(2026, 10, 5, 6, 30, tzinfo=TEHRAN)))

    async def test_missing_lesson_sends_once_at_six_thirty(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "bot.db")
            now = datetime(2026, 10, 5, 6, 0, tzinfo=TEHRAN)
            fake_lesson = AsyncMock(return_value=None)
            send = AsyncMock()
            app = SimpleNamespace(bot=SimpleNamespace(send_message=send))
            with patch.object(bot, "store", store), patch.object(bot, "OWNER_IDS", {123}), \
                 patch.object(bot, "DAILY_NOTION_TOKEN", "token"), \
                 patch.object(bot, "tehran_now", return_value=now) as clock, \
                 patch.object(bot, "NotionLessons") as reader:
                reader.return_value.lesson_for_date = fake_lesson
                await bot.daily_tick(app)
                self.assertEqual(store.get(123)["state"], "daily_missing_pending")
                send.assert_not_awaited()
                clock.return_value = datetime(2026, 10, 5, 6, 30, tzinfo=TEHRAN)
                await bot.daily_tick(app)
                await bot.daily_tick(app)
                send.assert_awaited_once_with(123, "امروز محتوای آموزشی نداریم!")
                self.assertEqual(store.get(123)["state"], "daily_missing_sent")
                self.assertEqual(fake_lesson.await_count, 2)

    async def test_daily_job_uses_existing_worker_and_notebook_remains_reusable(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "bot.db")
            lesson = {"page_id": "page", "url": "https://notion.so/page", "title": "درس امروز", "text": "محتوای کامل درس " * 20}
            session = make_session(123, "b" * 32, "2026-10-05", lesson, Path(directory))
            session["state"] = "uploading"
            store.put(123, session)
            phases = []

            async def fake_process(*args, **kwargs):
                phase = args[4]
                phases.append(phase)

                async def wait():
                    current = store.get(123, session["batch_id"])
                    if phase == "uploading":
                        current["notebook_id"] = "notebook-id"
                        current["inputs"][0]["source_id"] = "source-id"
                    elif phase == "generating":
                        current["task_id"] = "task-id"
                        path = output_path(current)
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(b"audio data")
                    store.put(123, current)
                    return 0

                return SimpleNamespace(wait=wait)

            app = SimpleNamespace(bot=SimpleNamespace(send_audio=AsyncMock()))
            send_audio = AsyncMock()
            app.bot.send_audio = send_audio
            with patch.object(bot, "store", store), patch.object(bot, "busy_slots", set()), \
                 patch.object(bot.asyncio, "create_subprocess_exec", fake_process), \
                 patch.object(bot, "send_due", return_value=False):
                await bot.run_job(123, session["batch_id"], app)
                self.assertEqual(phases, ["uploading", "generating"])
                self.assertEqual(store.get(123)["state"], "daily_ready")
                send_audio.assert_not_awaited()
                self.assertEqual(bot.saved_notebooks(123)[0]["notebook_id"], "notebook-id")
            current = store.get(123)
            current["state"] = "sending"
            store.put(123, current)
            with patch.object(bot, "store", store), patch.object(bot, "busy_slots", set()), \
                 patch.object(bot.asyncio, "create_subprocess_exec", fake_process), \
                 patch.object(bot, "send_due", return_value=True):
                await bot.run_job(123, session["batch_id"], app)
            send_audio.assert_awaited_once()
            self.assertEqual(store.get(123)["state"], "done")
            with patch.object(bot, "store", store):
                self.assertEqual(bot.saved_notebooks(123)[0]["notebook_id"], "notebook-id")


if __name__ == "__main__":
    unittest.main()
