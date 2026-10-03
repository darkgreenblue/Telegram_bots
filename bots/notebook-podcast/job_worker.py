"""Run one NotebookLM request in its own process and proxy slot."""

import asyncio
import fcntl
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from notebooklm import NetworkError, ServerError
from telegram import Bot
from telegram.request import HTTPXRequest

from notebook import InputValidationError, generate, upload
from proxy_select import select_proxy
from store import Store

ROOT = Path(__file__).resolve().parent


async def work(owner: int, batch_id: str, phase: str, slot: int) -> int:
    load_dotenv(ROOT / ".env")
    store = Store(ROOT / "data/bot.db")
    session = store.get(owner, batch_id)
    if not session or session.get("state") != phase:
        return 3

    def save(updated: dict) -> None:
        store.put(owner, updated)

    output = Path(session["work_dir"]) / f"{batch_id}.m4a"
    if phase in {"generating", "sending"} and output.exists() and output.stat().st_size:
        return 0

    chosen = await select_proxy(slot=slot)
    if phase == "uploading":
        async def switch() -> None:
            nonlocal chosen
            try:
                chosen = await select_proxy(exclude={chosen}, slot=slot)
            except ConnectionError:
                pass  # A retry on the current node may still succeed.

        async def download_file(file_id: str, target: Path) -> None:
            request = HTTPXRequest(connect_timeout=30, read_timeout=30, write_timeout=30)
            async with Bot(os.environ["BOT_TOKEN"], request=request) as bot:
                file = await bot.get_file(file_id)
                await file.download_to_drive(custom_path=target)

        await upload(session, save, download_file, os.getenv("NOTEBOOKLM_PROFILE", "notebook-podcast"), switch)
        return 0

    if phase in {"generating", "sending"}:
        for attempt in range(3):
            try:
                await generate(session, save, os.getenv("NOTEBOOKLM_PROFILE", "notebook-podcast"))
                return 0
            except (NetworkError, ServerError):
                # Reissuing a generation without its saved task ID could spend
                # quota twice. Recovery of that case stays a manual retry.
                if not session.get("task_id") or attempt == 2:
                    raise
                chosen = await select_proxy(exclude={chosen}, slot=slot)
        return 1
    return 3


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit(3)
    owner, batch_id, phase, slot = sys.argv[1:]
    if not batch_id.isalnum():
        raise SystemExit(3)
    lock_path = ROOT / "data" / str(int(owner)) / batch_id / ".worker.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with lock_path.open("a+") as lock_file:
            fcntl.flock(lock_file, fcntl.LOCK_EX)
            code = asyncio.run(work(int(owner), batch_id, phase, int(slot)))
    except InputValidationError as exc:
        store = Store(ROOT / "data/bot.db")
        session = store.get(int(owner), batch_id)
        if session:
            session["worker_error"] = str(exc)
            store.put(int(owner), session)
        code = 2
    except Exception:
        code = 1
    raise SystemExit(code)


if __name__ == "__main__":
    main()
