"""Keep the server's Google session fresh without creating notebooks or artifacts."""

import asyncio
import json
import logging
import sys
from pathlib import Path

LOG = logging.getLogger("notebook-podcast.auth")
INTERVAL = 15 * 60
RETRY_INTERVAL = 60


async def select_proxy(root: Path) -> None:
    # The selector's cross-process file lock must never block Telegram's event loop.
    process = await asyncio.create_subprocess_exec(
        sys.executable, str(root / "proxy_select.py"), cwd=root,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        code = await asyncio.wait_for(process.wait(), timeout=240)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    LOG.info("auth_proxy_selection_completed exit_code=%d", code)
    if code:
        raise ConnectionError("No authenticated proxy available")


async def refresh_auth(root: Path, profile: str) -> bool:
    process = await asyncio.create_subprocess_exec(
        str(Path(sys.executable).with_name("notebooklm")), "-p", profile,
        "auth", "refresh", "--verify", "--json",
        cwd=root, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=120)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    try:
        result = json.loads(stdout)
    except (ValueError, TypeError):
        result = {}
    success = process.returncode == 0 and result.get("status") == "ok" and result.get("verified") is True
    LOG.log(logging.INFO if success else logging.ERROR,
            "auth_refresh_completed success=%s exit_code=%s error_code=%s", success, process.returncode, result.get("code", "none"))
    return success


async def auth_loop(root: Path, profile: str) -> None:
    while True:
        success = False
        try:
            success = await refresh_auth(root, profile)
            if not success:
                # A reachable proxy can still redirect a signed-in account to a
                # regional landing page. Re-select using an authenticated RPC.
                await select_proxy(root)
                success = await refresh_auth(root, profile)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            LOG.error("auth_refresh_failed exception=%s retry_seconds=%d", type(exc).__name__, RETRY_INTERVAL)
        await asyncio.sleep(INTERVAL if success else RETRY_INTERVAL)
