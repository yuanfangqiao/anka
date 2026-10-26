"""Durable hashed capabilities; invitation TTL and player TTL are independent."""
import hashlib
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


class CapabilityStore:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS invitations (
                hash TEXT PRIMARY KEY, room TEXT NOT NULL, expires REAL NOT NULL,
                used INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS visitors (
                hash TEXT PRIMARY KEY, room TEXT NOT NULL, app TEXT NOT NULL,
                player TEXT NOT NULL, expires REAL NOT NULL);
        ''')
        self.db.commit()

    @contextmanager
    def transaction(self):
        with self.lock:
            with self.db:
                yield self.db

    def visitor(self, token, now):
        if not token or len(token) > 256:
            return None
        with self.lock:
            row = self.db.execute(
                'SELECT * FROM visitors WHERE hash=? AND expires>?',
                (digest(token), now)).fetchone()
        return dict(row) if row else None

    def revoke(self, room, player=None):
        with self.transaction() as db:
            if player:
                db.execute('DELETE FROM visitors WHERE room=? AND player=?',
                           (room, player))
            else:
                db.execute('DELETE FROM visitors WHERE room=?', (room,))
            db.execute('DELETE FROM invitations WHERE room=?', (room,))

    def close(self):
        with self.lock:
            self.db.close()
