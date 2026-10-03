"""Choose a working outbound for this bot's loopback-only Xray proxy."""

import asyncio
import fcntl
import json
import logging
import os
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(os.getenv("NOTEBOOK_PROXY_ROOT", Path(__file__).resolve().parent))
CONFIG = Path(os.getenv("NOTEBOOK_PROXY_CONFIG", ROOT / ".proxy/config.json"))
XRAY = ROOT / ".proxy/xray"
API_ADDRESS = os.getenv("NOTEBOOK_PROXY_API", "127.0.0.1:18769")
CACHE = ROOT / ".proxy/health.json"
LOCK = ROOT / ".proxy/health.lock"
LOG = logging.getLogger(__name__)
_lock = asyncio.Lock()
_selected: str | None = None


def candidates() -> list[tuple[str, int]]:
    config = json.loads(CONFIG.read_text())
    outbounds = {item["tag"] for item in config["outbounds"]}
    result = []
    for inbound in config["inbounds"]:
        match = re.fullmatch(r"probe-(\d+)", inbound.get("tag", ""))
        if match and f"node-{match[1]}" in outbounds:
            if inbound.get("listen") != "127.0.0.1":
                raise ValueError("Probe listener must be loopback-only")
            result.append((f"node-{match[1]}", inbound["port"]))
    if not result:
        raise ValueError("No proxy candidates configured")
    return result


async def _probe(port: int) -> bool:
    """Check Telegram and an authenticated NotebookLM RPC through one node."""
    import httpx
    from notebooklm import NotebookLMClient

    load_dotenv(ROOT / ".env")
    token = os.environ["BOT_TOKEN"]
    async with httpx.AsyncClient(proxy=f"http://127.0.0.1:{port}", timeout=10) as http:
        response = await http.get(f"https://api.telegram.org/bot{token}/getMe")
        if response.status_code != 200 or response.json().get("ok") is not True:
            return False
    # NotebookLMClient uses httpx's environment proxy. This runs in a separate
    # process so each simultaneous probe has its own proxy environment.
    async with NotebookLMClient.from_storage(profile=os.getenv("NOTEBOOKLM_PROFILE", "notebook-podcast")) as client:
        await asyncio.wait_for(client.notebooks.list(), timeout=15)
    return True


async def _network_probe(port: int) -> bool:
    """Cheap first pass; the authenticated NotebookLM RPC follows separately."""
    import httpx

    load_dotenv(ROOT / ".env")
    async with httpx.AsyncClient(proxy=f"http://127.0.0.1:{port}", timeout=8) as http:
        telegram, notebook = await asyncio.gather(
            http.get(f"https://api.telegram.org/bot{os.environ['BOT_TOKEN']}/getMe"),
            http.get("https://notebooklm.google.com/", follow_redirects=False),
        )
        return telegram.status_code == 200 and telegram.json().get("ok") is True and notebook.status_code in {200, 301, 302}


async def _probe_process(tag: str, port: int, network_only: bool = False) -> tuple[str, float] | None:
    env = os.environ.copy()
    env.update({key: f"http://127.0.0.1:{port}" for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")})
    started = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        sys.executable, str(Path(__file__).resolve()), "--network-probe" if network_only else "--probe", str(port),
        env=env, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        code = await asyncio.wait_for(proc.wait(), timeout=18 if network_only else 27)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return None
    return (tag, time.monotonic() - started) if code == 0 else None


async def _scan_healthy(available: list[tuple[str, int]]) -> list[tuple[str, float]]:
    network = []
    for start in range(0, len(available), 4):
        group = available[start:start + 4]
        network.extend(await asyncio.gather(*(_probe_process(tag, port, True) for tag, port in group)))
    reachable = sorted((item for item in network if item), key=lambda item: item[1])
    ports = dict(available)
    healthy = []
    for start in range(0, len(reachable), 4):
        group = reachable[start:start + 4]
        healthy.extend(item for item in await asyncio.gather(
            *(_probe_process(tag, ports[tag]) for tag, _ in group)
        ) if item)
    return sorted(healthy, key=lambda item: item[1])


async def select_proxy(exclude: set[str] | None = None, slot: int | None = None) -> str:
    """Select the fastest working node; nearby jobs reuse the health scan."""
    global _selected
    if slot is not None and slot not in range(3):
        raise ValueError("Invalid proxy slot")
    async with _lock:
        available = candidates()
        ports = dict(available)
        LOCK.parent.mkdir(parents=True, exist_ok=True)
        with LOCK.open("a+") as lock_file:
            fcntl.flock(lock_file, fcntl.LOCK_EX)
            cached = None
            if CACHE.exists():
                try:
                    cached = json.loads(CACHE.read_text())
                except (ValueError, OSError):
                    pass
            if cached and cached.get("config_mtime") == CONFIG.stat().st_mtime_ns and time.time() - cached.get("at", 0) < 90:
                healthy = [(tag, elapsed) for tag, elapsed in cached["healthy"] if tag in ports]
            else:
                healthy = await _scan_healthy(available)
                temp = CACHE.with_name(f"health.{os.getpid()}.tmp")
                temp.write_text(json.dumps({"at": time.time(), "config_mtime": CONFIG.stat().st_mtime_ns, "healthy": healthy}))
                temp.replace(CACHE)
            fcntl.flock(lock_file, fcntl.LOCK_UN)
        healthy = [(tag, elapsed) for tag, elapsed in healthy if tag not in (exclude or set())]
        if not healthy:
            raise ConnectionError("No proxy node can reach both NotebookLM and Telegram")
        for tag, _ in healthy:
            port = ports[tag]
            # A second successful check avoids choosing a node that only worked once.
            if await _probe_process(tag, port) is None:
                continue
            balancer = "active" if slot is None else f"job-{slot}"
            proc = await asyncio.create_subprocess_exec(
                str(XRAY), "api", "bo", f"--server={API_ADDRESS}", "-b", balancer, tag,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            if await proc.wait() != 0:
                raise RuntimeError("Xray rejected outbound selection")
            _selected = tag
            LOG.warning("Selected proxy %s after authenticated health checks", tag)
            return tag
        raise ConnectionError("Proxy nodes failed the confirmation check")


def selected_proxy() -> str | None:
    return _selected


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] in {"--probe", "--network-probe"}:
        try:
            check = _network_probe if sys.argv[1] == "--network-probe" else _probe
            ok = asyncio.run(check(int(sys.argv[2])))
        except Exception:
            ok = False
        raise SystemExit(0 if ok else 1)
    if len(sys.argv) == 1:
        print(asyncio.run(select_proxy()))
    else:
        raise SystemExit(2)
