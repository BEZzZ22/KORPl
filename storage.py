"""SQLite-хранилище: привязанные аккаунты и дневной лимит ИИ-разборов."""
import sqlite3
from datetime import date
from pathlib import Path


class Storage:
    def __init__(self, path: str | Path):
        self.db = sqlite3.connect(path)
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                tg_id INTEGER PRIMARY KEY,
                account_id INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ai_usage (
                tg_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (tg_id, day)
            );
            CREATE TABLE IF NOT EXISTS blocked (
                tg_id INTEGER PRIMARY KEY
            );
            """
        )
        self.db.commit()

    def get_account(self, tg_id: int) -> int | None:
        row = self.db.execute("SELECT account_id FROM users WHERE tg_id = ?", (tg_id,)).fetchone()
        return row[0] if row else None

    def set_account(self, tg_id: int, account_id: int):
        self.db.execute(
            "INSERT INTO users (tg_id, account_id) VALUES (?, ?) "
            "ON CONFLICT(tg_id) DO UPDATE SET account_id = excluded.account_id",
            (tg_id, account_id),
        )
        self.db.commit()

    def take_ai_quota(self, tg_id: int, daily_limit: int) -> bool:
        """Списывает один ИИ-разбор. False, если лимит на сегодня исчерпан."""
        today = date.today().isoformat()
        row = self.db.execute("SELECT count FROM ai_usage WHERE tg_id = ? AND day = ?", (tg_id, today)).fetchone()
        if row and row[0] >= daily_limit:
            return False
        self.db.execute(
            "INSERT INTO ai_usage (tg_id, day, count) VALUES (?, ?, 1) "
            "ON CONFLICT(tg_id, day) DO UPDATE SET count = count + 1",
            (tg_id, today),
        )
        self.db.commit()
        return True

    def refund_ai_quota(self, tg_id: int):
        """Возвращает списанный ИИ-разбор, если модель не ответила."""
        self.db.execute(
            "UPDATE ai_usage SET count = MAX(count - 1, 0) WHERE tg_id = ? AND day = ?",
            (tg_id, date.today().isoformat()),
        )
        self.db.commit()

    def block(self, tg_id: int):
        """Запоминает id заблокированного: смена ника блок не снимает."""
        self.db.execute("INSERT OR IGNORE INTO blocked (tg_id) VALUES (?)", (tg_id,))
        self.db.commit()

    def is_blocked(self, tg_id: int) -> bool:
        return self.db.execute("SELECT 1 FROM blocked WHERE tg_id = ?", (tg_id,)).fetchone() is not None

    def close(self):
        self.db.close()
