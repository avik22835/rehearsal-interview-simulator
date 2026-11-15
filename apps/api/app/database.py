import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime, timezone

def now():
    return datetime.now(timezone.utc).isoformat()

class Database:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(
                  id TEXT PRIMARY KEY, mode TEXT NOT NULL, title TEXT NOT NULL, topic TEXT NOT NULL,
                  level TEXT NOT NULL, duration INTEGER NOT NULL, provider TEXT NOT NULL,
                  remote_consent INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'setup',
                  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  type TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS events_session ON events(session_id, id);
                CREATE TABLE IF NOT EXISTS messages(
                  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
                  created_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, created_at);
            """)
            db.execute("INSERT OR IGNORE INTO schema_migrations VALUES(1, ?)", (now(),))
            columns = {row[1] for row in db.execute('PRAGMA table_info(sessions)')}
            if 'gateway_conversation_url' not in columns:
                db.execute('ALTER TABLE sessions ADD COLUMN gateway_conversation_url TEXT')
            if 'gateway_bound' not in columns:
                db.execute('ALTER TABLE sessions ADD COLUMN gateway_bound INTEGER NOT NULL DEFAULT 0')
            if 'gateway_session_version' not in columns:
                db.execute('ALTER TABLE sessions ADD COLUMN gateway_session_version INTEGER NOT NULL DEFAULT 0')
            db.executescript("""
                CREATE TABLE IF NOT EXISTS assessments(
                  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  kind TEXT NOT NULL, message_id TEXT, status TEXT NOT NULL, content TEXT,
                  error TEXT, created_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS assessments_session ON assessments(session_id,created_at);
            """)
            db.execute("INSERT OR IGNORE INTO schema_migrations VALUES(2, ?)", (now(),))
            db.execute("""CREATE TABLE IF NOT EXISTS provider_outputs(
                id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                task TEXT NOT NULL, raw TEXT NOT NULL, created_at TEXT NOT NULL)""")
            db.execute("INSERT OR IGNORE INTO schema_migrations VALUES(3, ?)", (now(),))
            db.executescript("""
                CREATE TABLE IF NOT EXISTS coding_workspaces(
                    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    source TEXT NOT NULL, request TEXT NOT NULL, problem TEXT NOT NULL, code TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS coding_snapshots(
                    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES coding_workspaces(id) ON DELETE CASCADE,
                    revision INTEGER NOT NULL, code TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS coding_runs(
                    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES coding_workspaces(id) ON DELETE CASCADE,
                    snapshot_id TEXT NOT NULL REFERENCES coding_snapshots(id), status TEXT NOT NULL,
                    result TEXT, created_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS coding_session ON coding_workspaces(session_id,created_at);
            """)
            db.execute("INSERT OR IGNORE INTO schema_migrations VALUES(4, ?)", (now(),))
            db.execute("""CREATE TABLE IF NOT EXISTS coding_turn_contexts(
                id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                assistant_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                workspace_id TEXT NOT NULL REFERENCES coding_workspaces(id) ON DELETE CASCADE,
                content TEXT NOT NULL,created_at TEXT NOT NULL)""")
            db.execute("INSERT OR IGNORE INTO schema_migrations VALUES(5, ?)",(now(),))
            db.executescript("""
                CREATE TABLE IF NOT EXISTS coding_attempts(
                    id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    workspace_id TEXT NOT NULL REFERENCES coding_workspaces(id) ON DELETE CASCADE,
                    snapshot_id TEXT NOT NULL REFERENCES coding_snapshots(id),run_id TEXT NOT NULL REFERENCES coding_runs(id),
                    request_id TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(session_id,request_id));
                CREATE TABLE IF NOT EXISTS assessment_sources(
                    assessment_id TEXT PRIMARY KEY REFERENCES assessments(id) ON DELETE CASCADE,content TEXT NOT NULL);
            """)
            db.execute("INSERT OR IGNORE INTO schema_migrations VALUES(6, ?)",(now(),))

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def event(self, db, session_id, kind, data):
        db.execute("INSERT INTO events(session_id,type,data,created_at) VALUES(?,?,?,?)",
                   (session_id, kind, json.dumps(data), now()))

    def session(self, session_id):
        with self.connection() as db:
            row = db.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
            if not row:
                return None
            result = dict(row)
            result["remote_consent"] = bool(result["remote_consent"])
            result["messages"] = [dict(x) for x in db.execute("SELECT * FROM messages WHERE session_id=? ORDER BY rowid", (session_id,))]
            result["events"] = [{**dict(x), "data": json.loads(x["data"])} for x in db.execute("SELECT * FROM events WHERE session_id=? ORDER BY id", (session_id,))]
            result["assessments"] = [{**dict(x), "content": json.loads(x["content"]) if x["content"] else None} for x in db.execute("SELECT * FROM assessments WHERE session_id=? ORDER BY rowid", (session_id,))]
            for assessment in result['assessments']:
                source_row=db.execute('SELECT content FROM assessment_sources WHERE assessment_id=?',(assessment['id'],)).fetchone()
                if source_row:
                    manifest=json.loads(source_row['content'])
                    assessment['evidence_sources']=[{k:v for k,v in source.items() if k!='text'} for source in manifest['sources']]
                    assessment['evidence_scope']={k:v for k,v in manifest.items() if k not in ('sources','attempts')}
                    assessment['evidence_scope']['attempt_ids']=[a['id'] for a in manifest.get('attempts',[])]
            problem=db.execute('SELECT id,problem FROM coding_workspaces WHERE session_id=? ORDER BY rowid DESC LIMIT 1',(session_id,)).fetchone()
            if problem:result['coding_problem']={'workspace_id':problem['id'],**json.loads(problem['problem'])}
            return result

    def recover(self):
        # A stopped server cannot still own an in-flight generation.
        with self.connection() as db:
            db.execute("UPDATE coding_runs SET status='interrupted' WHERE status='running'")
            db.execute("UPDATE assessments SET status='interrupted',error='Server restarted during report generation. Retry the report.' WHERE status='generating'")
            pending = db.execute("SELECT id,session_id FROM messages WHERE status='generating'").fetchall()
            for row in pending:
                db.execute("UPDATE messages SET status='interrupted' WHERE id=?", (row["id"],))
                self.event(db, row["session_id"], "generation_interrupted", {"message_id": row["id"], "reason": "server_restart"})
