"""Knowledge base: markdown files in data/kb/ split by heading into chunks, indexed with SQLite FTS5 (stdlib, no extra dependency).

Each file starts with front matter:  source: ...  /  status: ...   (blank line, then markdown).
"""
from __future__ import annotations

import re
import sqlite3
from functools import cached_property
from pathlib import Path

KB_DIR = Path(__file__).resolve().parents[1] / "data" / "kb"


class KnowledgeBase:
    def __init__(self, directory: Path = KB_DIR):
        self.directory = directory

    @cached_property
    def _db(self) -> sqlite3.Connection:
        db = sqlite3.connect(":memory:", check_same_thread=False)
        db.execute("CREATE VIRTUAL TABLE chunks USING fts5(title, body, source UNINDEXED, status UNINDEXED, tokenize='porter unicode61')")
        for f in sorted(self.directory.glob("*.md")):
            meta, text = self._parse(f.read_text())
            for title, body in self._split(text, f.stem):
                db.execute("INSERT INTO chunks VALUES (?,?,?,?)", (title, body, meta.get("source", f.name), meta.get("status", "estimate")))
        db.commit()
        return db

    @staticmethod
    def _parse(raw: str) -> tuple[dict, str]:
        head, _, rest = raw.partition("\n\n")
        meta = dict(re.findall(r"^(\w+):\s*(.+)$", head, re.M))
        return (meta, rest) if meta else ({}, raw)

    @staticmethod
    def _split(text: str, stem: str):
        parts = re.split(r"^(#{1,3} .+)$", text, flags=re.M)
        title = stem
        if parts[0].strip():
            yield stem, parts[0].strip()
        for i in range(1, len(parts), 2):
            title = f"{stem} / {parts[i].lstrip('# ').strip()}"
            body = parts[i + 1].strip()
            if body:
                yield title, body

    def search(self, query: str, k: int = 4) -> list[dict]:
        words = re.findall(r"\w{2,}", query.lower())
        if not words:
            return []
        q = " OR ".join(f'"{w}"' for w in words)
        rows = self._db.execute("SELECT title, body, source, status FROM chunks WHERE chunks MATCH ? ORDER BY bm25(chunks, 4.0, 1.0) LIMIT ?", (q, k)).fetchall()
        return [{"title": t, "text": b[:1200], "source": s, "status": st} for t, b, s, st in rows]


kb = KnowledgeBase()
