import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import bot
import proxy_select
from store import Store


class StoreMigrationTests(unittest.TestCase):
    def test_legacy_request_is_migrated_without_losing_progress(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bot.db"
            db = sqlite3.connect(path)
            db.execute("CREATE TABLE sessions (owner_id INTEGER PRIMARY KEY, data TEXT NOT NULL)")
            old = {"batch_id": "old-1", "state": "generating", "task_id": "task-1", "inputs": [{"source_id": "source-1"}]}
            db.execute("INSERT INTO sessions VALUES (?,?)", (42, json.dumps(old)))
            db.commit()
            db.close()
            store = Store(path)
            self.assertEqual(store.get(42, "old-1"), old)
            self.assertEqual(len(store.active()), 1)
            self.assertEqual(len(Store(path).list(42)), 1)


class MultipleRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_collection_is_allowed_during_another_upload(self):
        with tempfile.TemporaryDirectory() as tmp:
            local_store = Store(Path(tmp) / "bot.db")
            first = {"batch_id": "old-1", "state": "uploading", "inputs": [{"kind": "text", "value": "first"}]}
            local_store.put(42, first)
            message = SimpleNamespace(reply_text=AsyncMock(return_value=SimpleNamespace(message_id=123)))
            update = SimpleNamespace(effective_user=SimpleNamespace(id=42), message=message)
            with patch.object(bot, "store", local_store), patch.object(bot, "DATA", Path(tmp)):
                await bot.begin(update, SimpleNamespace())
                self.assertEqual(local_store.get(42, "old-1")["state"], "uploading")
                self.assertEqual(local_store.open_count(42), 2)
                self.assertEqual(local_store.latest_in_state(42, "title")["inputs"], [])
                await bot.begin(update, SimpleNamespace())
                self.assertEqual(local_store.open_count(42), 2)

    async def test_three_open_requests_are_allowed_but_fourth_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            local_store = Store(Path(tmp) / "bot.db")
            for index in range(3):
                local_store.put(42, {"batch_id": f"job-{index}", "state": "generating"})
            message = SimpleNamespace(reply_text=AsyncMock())
            update = SimpleNamespace(effective_user=SimpleNamespace(id=42), message=message)
            with patch.object(bot, "store", local_store):
                await bot.begin(update, SimpleNamespace())
            self.assertEqual(local_store.open_count(42), 3)
            self.assertIn("سه درخواست", message.reply_text.await_args.args[0])

    async def test_three_workers_receive_distinct_proxy_ports(self):
        with tempfile.TemporaryDirectory() as tmp:
            local_store = Store(Path(tmp) / "bot.db")
            release = asyncio.Event()
            ports = []

            async def launch(*args, **kwargs):
                ports.append(kwargs["env"]["HTTPS_PROXY"])
                async def wait():
                    await release.wait()
                    return 0
                return SimpleNamespace(wait=wait)

            app = SimpleNamespace(bot=SimpleNamespace(send_message=AsyncMock()))
            for index in range(3):
                local_store.put(42, {"batch_id": f"job{index}", "state": "uploading", "inputs": []})
            with patch.object(bot, "store", local_store), \
                 patch.object(bot.asyncio, "create_subprocess_exec", side_effect=launch):
                tasks = [asyncio.create_task(bot.run_job(42, f"job{index}", app)) for index in range(3)]
                for _ in range(20):
                    if len(ports) == 3:
                        break
                    await asyncio.sleep(0)
                self.assertEqual(set(ports), {f"http://127.0.0.1:{port}" for port in range(18770, 18773)})
                release.set()
                await asyncio.gather(*tasks)
            self.assertEqual(bot.busy_slots, set())


class ProxySlotTests(unittest.IsolatedAsyncioTestCase):
    async def test_selection_changes_only_the_requested_job_balancer(self):
        async def probe(tag, port, network_only=False):
            return (tag, 0.2 if tag == "node-1" else 0.5)

        process = SimpleNamespace(wait=AsyncMock(return_value=0))
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "config.json"
            config.write_text("{}")
            with patch.object(proxy_select, "CONFIG", config), \
                 patch.object(proxy_select, "CACHE", Path(tmp) / "health.json"), \
                 patch.object(proxy_select, "LOCK", Path(tmp) / "health.lock"), \
                 patch.object(proxy_select, "candidates", return_value=[("node-0", 18760), ("node-1", 18761)]), \
                 patch.object(proxy_select, "_scan_healthy", new_callable=AsyncMock, return_value=[("node-1", 0.2), ("node-0", 0.5)]), \
                 patch.object(proxy_select, "_probe_process", side_effect=probe), \
                 patch.object(proxy_select.asyncio, "create_subprocess_exec", new_callable=AsyncMock, return_value=process) as create:
                chosen = await proxy_select.select_proxy(slot=2)
        self.assertEqual(chosen, "node-1")
        self.assertEqual(create.await_args.args[-3:], ("-b", "job-2", "node-1"))


if __name__ == "__main__":
    unittest.main()
