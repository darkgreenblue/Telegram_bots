import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import auth_keepalive


class AuthKeepaliveTests(unittest.IsolatedAsyncioTestCase):
    async def test_refresh_requires_verified_success_and_does_not_log_response_secrets(self):
        process = SimpleNamespace(returncode=1, communicate=AsyncMock(return_value=(
            b'{"error":true,"code":"AUTH_FAILED","message":"private-cookie-value"}', b"")))
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(auth_keepalive.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)), \
             self.assertLogs(auth_keepalive.LOG, level="ERROR") as logs:
            self.assertFalse(await auth_keepalive.refresh_auth(Path(directory), "profile"))
        self.assertNotIn("private-cookie-value", "".join(logs.output))
        self.assertIn("AUTH_FAILED", "".join(logs.output))

    async def test_refresh_timeout_kills_child_before_retry(self):
        process = SimpleNamespace(returncode=None, communicate=AsyncMock(side_effect=asyncio.TimeoutError),
                                  kill=lambda: None, wait=AsyncMock(return_value=1))
        with patch.object(auth_keepalive.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)):
            with self.assertRaises(asyncio.TimeoutError):
                await auth_keepalive.refresh_auth(Path("/tmp"), "profile")
        process.wait.assert_awaited_once()

    async def test_failed_route_reselects_proxy_and_refreshes_before_next_interval(self):
        with patch.object(auth_keepalive, "refresh_auth", AsyncMock(side_effect=[False, True])) as refresh, \
             patch.object(auth_keepalive, "select_proxy", AsyncMock()) as select, \
             patch.object(auth_keepalive.asyncio, "sleep", AsyncMock(side_effect=asyncio.CancelledError)) as sleep:
            with self.assertRaises(asyncio.CancelledError):
                await auth_keepalive.auth_loop(Path("/tmp"), "profile")
        self.assertEqual(refresh.await_count, 2)
        select.assert_awaited_once()
        sleep.assert_awaited_once_with(900)
