"""Local question library: one source file per question, explicitly grouped by topic."""
import re
from uuid import uuid4
from fastapi import HTTPException
from pydantic import BaseModel, Field
from .database import now

class ResourceInput(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    content: str = Field(min_length=10, max_length=20000)
    topic: str = Field(default='', max_length=180)

class ResourceBatch(BaseModel):
    resources: list[ResourceInput] = Field(min_length=1, max_length=100)

def install_resource_routes(app, database):
    with database.connection() as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS coding_resources(id TEXT PRIMARY KEY,name TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,topic TEXT NOT NULL DEFAULT "")')
        if 'topic' not in {row['name'] for row in conn.execute('PRAGMA table_info(coding_resources)')}:
            conn.execute('ALTER TABLE coding_resources ADD COLUMN topic TEXT NOT NULL DEFAULT ""')

    def insert(conn, payload):
        rid = str(uuid4())
        topic = payload.topic.strip()
        conn.execute('INSERT INTO coding_resources(id,name,content,created_at,topic) VALUES(?,?,?,?,?)', (rid,payload.name.strip(),payload.content,now(),topic))
        return {'id':rid,'name':payload.name.strip(),'topic':topic}

    @app.post('/api/coding/resources', status_code=201)
    def add(payload: ResourceInput):
        with database.connection() as conn:
            return insert(conn, payload)

    @app.post('/api/coding/resources/import', status_code=201)
    def import_questions(payload: ResourceBatch):
        # One transaction: a failed batch never leaves a partially imported folder.
        with database.connection() as conn:
            return [insert(conn, item) for item in payload.resources]

    @app.get('/api/coding/resources/topics')
    def topics():
        with database.connection() as conn:
            return [dict(row) for row in conn.execute('SELECT topic,COUNT(*) AS count FROM coding_resources GROUP BY topic ORDER BY topic COLLATE NOCASE')]

    @app.get('/api/coding/resources')
    def browse(q: str = '', topic: str | None = None):
        terms = set(re.findall(r'\w+', q.casefold()))
        with database.connection() as conn:
            rows = [dict(row) for row in conn.execute('SELECT * FROM coding_resources ORDER BY topic COLLATE NOCASE,name COLLATE NOCASE')]
        result=[]
        for row in rows:
            if topic is not None and row['topic']!=topic:continue
            text=(row['name']+' '+row['topic']+' '+row['content']).casefold()
            row['score']=sum(term in text for term in terms)
            if not terms or row['score']==len(terms):result.append(row)
        return result

    @app.delete('/api/coding/resources/{resource_id}', status_code=204)
    def remove(resource_id: str):
        with database.connection() as conn:
            if not conn.execute('DELETE FROM coding_resources WHERE id=?', (resource_id,)).rowcount:
                raise HTTPException(404, 'Resource not found.')
