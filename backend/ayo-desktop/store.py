import sqlite3


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY, title TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, chat INTEGER NOT NULL,
                role TEXT NOT NULL, content TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)

    def chats(self, term=""):
        return self.db.execute("""SELECT id,title FROM chats WHERE instr(lower(title),lower(?))
            OR id IN (SELECT chat FROM messages WHERE instr(lower(content),lower(?)))
            ORDER BY id DESC""", (term, term)).fetchall()

    def add(self, chat, role, content):
        with self.db:
            if not chat:
                chat = self.db.execute("INSERT INTO chats(title) VALUES (?)", (content[:64],)).lastrowid
            self.db.execute("INSERT INTO messages(chat,role,content) VALUES (?,?,?)", (chat, role, content))
        return chat

    def history(self, chat):
        return [dict(role=r, content=c) for r,c in self.db.execute(
            "SELECT role,content FROM messages WHERE chat=? ORDER BY id", (chat,))]

    def setting(self, name, default):
        row = self.db.execute("SELECT value FROM settings WHERE name=?", (name,)).fetchone()
        return row[0] if row else default

    def configure(self, values):
        with self.db:
            self.db.executemany("INSERT OR REPLACE INTO settings VALUES (?,?)", values.items())
