import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

let connection: DatabaseSync | undefined;

export function getDatabase(): DatabaseSync {
  if (connection) return connection;
  const path = resolve(process.env.DATABASE_PATH || ".data/one-percent.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`
PRAGMA busy_timeout=5000;
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 password TEXT NOT NULL, timezone TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_zones (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 effective_at INTEGER NOT NULL, timezone TEXT NOT NULL,
 PRIMARY KEY(user_id,effective_at)
);
CREATE TABLE IF NOT EXISTS sessions (
 hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS parties (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
 party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 joined_at INTEGER NOT NULL, PRIMARY KEY(party_id,user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS invites (
 id TEXT PRIMARY KEY, party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
 hash TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, position INTEGER NOT NULL, created_date TEXT NOT NULL,
 archived_from TEXT
);
CREATE INDEX IF NOT EXISTS tasks_user ON tasks(user_id);
CREATE TABLE IF NOT EXISTS task_versions (
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 effective_date TEXT NOT NULL, definition TEXT NOT NULL,
 PRIMARY KEY(task_id,effective_date)
);
CREATE TABLE IF NOT EXISTS task_days (
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 date TEXT NOT NULL, timezone TEXT NOT NULL, definition TEXT NOT NULL,
 party_id TEXT, value REAL NOT NULL DEFAULT 0, logged INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER, PRIMARY KEY(task_id,date)
);
CREATE INDEX IF NOT EXISTS days_owner_date ON task_days(user_id,date);
CREATE INDEX IF NOT EXISTS days_party_date ON task_days(party_id,date);
CREATE INDEX IF NOT EXISTS days_party_updated ON task_days(party_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS timers (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 task_id TEXT NOT NULL REFERENCES tasks(id), started_at INTEGER NOT NULL,
 accounted_at INTEGER NOT NULL
);
PRAGMA user_version=1;
COMMIT;
`);
    connection = db;
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return getDatabase()
    .prepare(sql)
    .get(...params) as T | undefined;
}
export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return getDatabase()
    .prepare(sql)
    .all(...params) as T[];
}
export function run(sql: string, ...params: SQLInputValue[]) {
  return getDatabase()
    .prepare(sql)
    .run(...params);
}
let depth = 0;
export function transaction<T>(fn: () => T): T {
  if (depth) return fn();
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  depth++;
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    depth--;
  }
}
