"""Durable, independent podcast requests for each owner."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

OPEN_STATES = {"title", "collecting", "uploading", "output_type", "studio_language", "studio_language_custom", "studio_setting", "studio_prompt", "format", "language", "language_custom", "length", "prompt", "generating", "sending"}
RUNNING_STATES = {"uploading", "generating", "sending"}


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=30)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS sessions (owner_id INTEGER PRIMARY KEY, data TEXT NOT NULL)")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS requests ("
            "owner_id INTEGER NOT NULL, batch_id TEXT NOT NULL, data TEXT NOT NULL, "
            "PRIMARY KEY(owner_id, batch_id))"
        )
        # Preserve the old table for rollback; copy each legacy request once.
        for owner, raw in self.db.execute("SELECT owner_id, data FROM sessions"):
            session = json.loads(raw)
            batch_id = session.get("batch_id", f"legacy-{owner}")
            session["batch_id"] = batch_id
            self.db.execute(
                "INSERT OR IGNORE INTO requests(owner_id,batch_id,data) VALUES (?,?,?)",
                (owner, batch_id, json.dumps(session, ensure_ascii=False)),
            )
        self.db.commit()

    def get(self, owner_id: int, batch_id: str | None = None) -> dict | None:
        if batch_id is None:
            row = self.db.execute(
                "SELECT data FROM requests WHERE owner_id=? ORDER BY rowid DESC LIMIT 1", (owner_id,)
            ).fetchone()
        else:
            row = self.db.execute(
                "SELECT data FROM requests WHERE owner_id=? AND batch_id=?", (owner_id, batch_id)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, owner_id: int, session: dict) -> None:
        batch_id = session.setdefault("batch_id", f"legacy-{owner_id}")
        self.db.execute(
            "INSERT INTO requests(owner_id,batch_id,data) VALUES (?,?,?) "
            "ON CONFLICT(owner_id,batch_id) DO UPDATE SET data=excluded.data",
            (owner_id, batch_id, json.dumps(session, ensure_ascii=False)),
        )
        self.db.commit()

    def list(self, owner_id: int) -> list[dict]:
        return [json.loads(row[0]) for row in self.db.execute(
            "SELECT data FROM requests WHERE owner_id=? ORDER BY rowid DESC", (owner_id,)
        )]

    def latest_in_state(self, owner_id: int, *states: str) -> dict | None:
        return next((s for s in self.list(owner_id) if s.get("state") in states), None)

    def open_count(self, owner_id: int) -> int:
        return sum(s.get("state") in OPEN_STATES for s in self.list(owner_id))

    def active(self) -> list[tuple[int, dict]]:
        return [
            (owner, session)
            for owner, raw in self.db.execute("SELECT owner_id,data FROM requests")
            if (session := json.loads(raw)).get("state") in RUNNING_STATES
        ]
