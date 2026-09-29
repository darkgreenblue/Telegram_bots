"""Small durable state store for the owner's current podcast request."""

import json
import sqlite3
from pathlib import Path


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS sessions (owner_id INTEGER PRIMARY KEY, data TEXT NOT NULL)"
        )
        self.db.commit()

    def get(self, owner_id: int) -> dict | None:
        row = self.db.execute(
            "SELECT data FROM sessions WHERE owner_id = ?", (owner_id,)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, owner_id: int, session: dict) -> None:
        self.db.execute(
            "INSERT INTO sessions(owner_id, data) VALUES (?, ?) "
            "ON CONFLICT(owner_id) DO UPDATE SET data = excluded.data",
            (owner_id, json.dumps(session, ensure_ascii=False)),
        )
        self.db.commit()

    def active(self) -> list[tuple[int, dict]]:
        return [
            (owner_id, json.loads(data))
            for owner_id, data in self.db.execute("SELECT owner_id, data FROM sessions")
            if json.loads(data).get("state") in {"uploading", "generating", "sending"}
        ]
