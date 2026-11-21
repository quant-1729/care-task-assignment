import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ACTORS,
  ATTENTION_REASONS,
  EVENT_KINDS,
  PRIORITIES,
  SPECIALTIES,
  STATUSES,
  keys,
} from './constants.js';

const list = (items) => keys(items).map((k) => `'${k}'`).join(', ');

// The rules that must never break live here as CHECK constraints, so the
// database refuses bad states even if the code has a bug.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS patients (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  bed  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nurses (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  specialties TEXT NOT NULL,            -- JSON array of specialty keys
  on_shift    INTEGER NOT NULL CHECK (on_shift IN (0, 1))
);

CREATE TABLE IF NOT EXISTS tasks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id         INTEGER NOT NULL REFERENCES patients(id),
  care_needed        TEXT NOT NULL,
  specialty          TEXT NOT NULL CHECK (specialty IN (${list(SPECIALTIES)})),
  acuity             INTEGER NOT NULL CHECK (acuity BETWEEN 1 AND 4),
  priority           TEXT NOT NULL CHECK (priority IN (${list(PRIORITIES)})),
  status             TEXT NOT NULL CHECK (status IN (${list(STATUSES)})),
  attention_reason   TEXT CHECK (attention_reason IS NULL OR attention_reason IN (${list(ATTENTION_REASONS)})),
  nurse_id           INTEGER REFERENCES nurses(id),
  current_request_id TEXT,
  request_started_at INTEGER,
  offered_at         INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  -- a nurse is set exactly when the task is offered, accepted or done
  CHECK ((nurse_id IS NOT NULL) = (status IN ('offered', 'accepted', 'done'))),
  -- a reason is set exactly when the task needs attention
  CHECK ((attention_reason IS NOT NULL) = (status = 'needs_attention'))
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  at         INTEGER NOT NULL,
  actor      TEXT NOT NULL CHECK (actor IN (${list(ACTORS)})),
  kind       TEXT NOT NULL CHECK (kind IN (${list(EVENT_KINDS)})),
  message    TEXT NOT NULL,
  request_id TEXT,
  nurse_id   INTEGER REFERENCES nurses(id)
);

CREATE INDEX IF NOT EXISTS events_by_task ON events (task_id, id);
CREATE INDEX IF NOT EXISTS tasks_by_nurse ON tasks (nurse_id);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// node:sqlite has no transaction helper. IMMEDIATE takes the write lock up
// front, so two changes to the same task can never interleave.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}
