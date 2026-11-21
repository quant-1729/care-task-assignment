import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createEngine } from '../src/engine.js';

// A fresh database file, a fake clock, and an engine whose timers are only
// recorded: nothing fires by itself. Tests fire answers by hand with fire().
export function makeEnv({ file, random = () => 0.5, start = 1_000_000 } = {}) {
  const dbFile = file ?? path.join(os.tmpdir(), `care-routing-test-${randomUUID()}.db`);
  const db = openDb(dbFile);
  const clock = { t: start };
  const scheduled = []; // { fn, ms, cancelled }
  const engine = createEngine({
    random,
    schedule: (fn, ms) => {
      const handle = { fn, ms, cancelled: false };
      scheduled.push(handle);
      return handle;
    },
    cancel: (handle) => {
      handle.cancelled = true;
    },
  });
  const ctx = { db, now: () => clock.t, engine };
  return {
    ctx,
    db,
    clock,
    scheduled,
    file: dbFile,
    advance: (ms) => {
      clock.t += ms;
    },
    // Fire the Nth recorded answer (default: the latest one).
    fire: (index = scheduled.length - 1) => scheduled[index].fn(),
    close: () => db.close(),
    cleanup: () => {
      try {
        db.close();
      } catch {
        // already closed
      }
      for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(dbFile + suffix, { force: true });
    },
  };
}

export function addPatient(db, id, name = `Patient ${id}`) {
  db.prepare('INSERT INTO patients (id, name, bed) VALUES (?, ?, ?)').run(id, name, String(id));
}

export function addNurse(db, id, name, specialties, onShift = true) {
  db.prepare('INSERT INTO nurses (id, name, specialties, on_shift) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    JSON.stringify(specialties),
    onShift ? 1 : 0,
  );
}

// Put a task straight into the database, e.g. to give a nurse some workload.
export function addTaskRow(db, { patientId = 1, specialty = 'icu', acuity = 2, status = 'accepted', nurseId = null }) {
  const res = db
    .prepare(
      `INSERT INTO tasks (patient_id, care_needed, specialty, acuity, priority, status, nurse_id, created_at, updated_at)
       VALUES (?, 'Existing care', ?, ?, 'routine', ?, ?, 0, 0)`,
    )
    .run(patientId, specialty, acuity, status, nurseId);
  return Number(res.lastInsertRowid);
}

export const newTaskBody = (overrides = {}) => ({
  patientId: 1,
  careNeeded: 'Ventilated patient, hourly checks',
  specialty: 'icu',
  acuity: 2,
  priority: 'routine',
  ...overrides,
});

export const taskRow = (db, id) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
export const eventKinds = (db, taskId) =>
  db.prepare('SELECT kind FROM events WHERE task_id = ? ORDER BY id').all(taskId).map((e) => e.kind);
export const eventsOfKind = (db, taskId, kind) =>
  db.prepare('SELECT * FROM events WHERE task_id = ? AND kind = ? ORDER BY id').all(taskId, kind);

// Small seeded random generator, for repeatable runs.
export function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
