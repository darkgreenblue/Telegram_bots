"""Read the dated Notion lesson as one NotebookLM source, without an LLM."""

from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx

DATABASE_ID = "7f7f7ea4a0d748938f736edf4b411820"
NOTION_VERSION = "2022-06-28"
TEHRAN = ZoneInfo("Asia/Tehran")
START_AT = time(6, 0)
SEND_AT = time(6, 30)


def tehran_now() -> datetime:
    return datetime.now(TEHRAN)


def dated_session(sessions: list[dict], date: str) -> dict | None:
    return next((session for session in sessions if session.get("daily_date") == date), None)


def send_due(date: str, now: datetime | None = None) -> bool:
    now = now or tehran_now()
    return now.date().isoformat() > date or (now.date().isoformat() == date and now.time() >= SEND_AT)


def start_due(now: datetime | None = None) -> bool:
    now = now or tehran_now()
    return now.time() >= START_AT


def retry_due(session: dict, now: datetime | None = None) -> bool:
    now = now or tehran_now()
    return now.timestamp() >= session.get("daily_retry_at", 0)


def retry_later(session: dict, now: datetime | None = None) -> None:
    now = now or tehran_now()
    session["daily_retry_at"] = (now + timedelta(minutes=5)).timestamp()
    session["daily_attempts"] = session.get("daily_attempts", 0) + 1


def _rich(items: list[dict] | None) -> str:
    return "".join(item.get("plain_text") or item.get("text", {}).get("content", "") for item in items or [])


class NotionLessons:
    def __init__(self, token: str, client: httpx.AsyncClient | None = None):
        self.token = token
        self.client = client

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        headers = {"Authorization": f"Bearer {self.token}", "Notion-Version": NOTION_VERSION}
        if self.client:
            response = await self.client.request(method, f"https://api.notion.com/v1{path}", headers=headers, **kwargs)
        else:
            async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
                response = await client.request(method, f"https://api.notion.com/v1{path}", headers=headers, **kwargs)
        response.raise_for_status()
        return response.json()

    async def _pages(self, method: str, path: str, *, json: dict | None = None) -> list[dict]:
        results = []
        cursor = None
        while True:
            if method == "POST":
                payload = dict(json or {}, page_size=100)
                if cursor:
                    payload["start_cursor"] = cursor
                response = await self._request(method, path, json=payload)
            else:
                params = {"page_size": 100}
                if cursor:
                    params["start_cursor"] = cursor
                response = await self._request(method, path, params=params)
            results.extend(response.get("results", []))
            if len(results) > 2000:
                raise ValueError("Notion lesson exceeds the safe block limit")
            cursor = response.get("next_cursor") if response.get("has_more") else None
            if not cursor:
                return results

    async def lesson_for_date(self, date: str) -> dict | None:
        rows = await self._pages("POST", f"/databases/{DATABASE_ID}/query", json={
            "filter": {"property": "تاریخ", "date": {"equals": date}},
        })
        if not rows:
            return None
        if len(rows) != 1:
            raise ValueError(f"Multiple Notion lessons have date {date}")
        row = rows[0]
        title = _rich(row["properties"]["عنوان"]["title"])
        if not title:
            raise ValueError("Dated Notion lesson has no title")
        lines = [f"# {title}", f"تاریخ: {date}"]
        lines.extend(await self._render_children(row["id"], 0))
        content = "\n".join(line for line in lines if line).strip()
        if len(content) < 100:
            raise ValueError("Dated Notion lesson has too little content")
        return {"page_id": row["id"], "title": title, "url": row.get("url", ""), "text": content}

    async def _render_children(self, parent_id: str, depth: int) -> list[str]:
        if depth > 12:
            raise ValueError("Notion lesson nesting exceeds the safe limit")
        blocks = await self._pages("GET", f"/blocks/{parent_id}/children")
        lines = []
        for block in blocks:
            kind = block["type"]
            value = block.get(kind, {})
            prefix = "  " * depth
            if kind.startswith("heading_"):
                lines.append(f"{'#' * int(kind[-1])} {_rich(value.get('rich_text'))}")
            elif kind in {"bulleted_list_item", "numbered_list_item"}:
                lines.append(f"{prefix}- {_rich(value.get('rich_text'))}")
            elif kind == "to_do":
                lines.append(f"{prefix}- {'[x]' if value.get('checked') else '[ ]'} {_rich(value.get('rich_text'))}")
            elif kind == "table_row":
                lines.append(" | ".join(_rich(cell) for cell in value.get("cells", [])))
            elif kind == "divider":
                lines.append("---")
            elif kind == "child_page":
                lines.append(f"{prefix}## {value.get('title', '')}")
            else:
                content = _rich(value.get("rich_text") or value.get("caption"))
                if content:
                    lines.append(f"{prefix}{content}")
                elif kind not in {"table", "toggle", "paragraph", "bulleted_list_item", "numbered_list_item", "quote", "callout", "code"}:
                    raise ValueError(f"Unsupported Notion block in lesson: {kind}")
            if block.get("has_children"):
                lines.extend(await self._render_children(block["id"], depth + 1))
        return lines


def make_session(owner: int, batch_id: str, date: str, lesson: dict, data_dir) -> dict:
    return {
        "batch_id": batch_id,
        "daily_date": date,
        "daily_page_id": lesson["page_id"],
        "daily_page_url": lesson["url"],
        "notebook_title": f"درس {date} | {lesson['title']}"[:100],
        "create_title": f"Daily Brief draft {batch_id}",
        "state": "daily_pending",
        "inputs": [{"kind": "text", "title": lesson["title"], "value": lesson["text"]}],
        "output_type": "audio",
        "language": "fa",
        "settings": {"audio_format": "deep-dive", "audio_length": "long"},
        "prompt": "",
        "work_dir": str(data_dir / str(owner) / batch_id),
    }
