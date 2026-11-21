// Every state change and every query lives here. Routes and timers only call
// these functions. Each change runs in one transaction.

import { randomUUID } from 'node:crypto';
import { tx } from './db.js';
import {
  DEMO_MODES,
  EXCLUDING_EVENT_KINDS,
  OFFER_TIMEOUT_MS,
  PRIORITIES,
  SPECIALTIES,
  WARN_AFTER_MS,
  WORKLOAD_LIMIT,
  keys,
  specialtyLabel,
  statusLabel,
} from './constants.js';
import { isEligible, pickNurse } from './matching.js';

// ---------------------------------------------------------------- errors

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const badRequest = (message) => new HttpError(400, message);
const notFound = (message) => new HttpError(404, message);

// A 409: the action is no longer valid. It is also written to the history.
class Conflict extends HttpError {
  constructor(message) {
    super(409, message);
  }
}

// ---------------------------------------------------------------- small helpers

const short = (requestId) => requestId.slice(0, 6);
const secs = (ms) => Math.round(ms / 1000);

function getTask(db, id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

function getNurse(db, id) {
  const row = db.prepare('SELECT * FROM nurses WHERE id = ?').get(id);
  return row ? toNurse(row) : null;
}

const toNurse = (row) => ({
  id: row.id,
  name: row.name,
  specialties: JSON.parse(row.specialties),
  onShift: row.on_shift === 1,
});

export function nurseName(db, id) {
  return db.prepare('SELECT name FROM nurses WHERE id = ?').get(id)?.name ?? `nurse ${id}`;
}

// Workload is never stored: it is the sum of acuity of offered + accepted tasks.
function workloadOf(db, nurseId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(acuity), 0) AS w FROM tasks
       WHERE nurse_id = ? AND status IN ('offered', 'accepted')`,
    )
    .get(nurseId).w;
}

// Nurses who declined, timed out or failed on this task (from its history).
function excludedNurseIds(db, taskId) {
  const marks = EXCLUDING_EVENT_KINDS.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT DISTINCT nurse_id FROM events
       WHERE task_id = ? AND nurse_id IS NOT NULL AND kind IN (${marks})
       ORDER BY nurse_id`,
    )
    .all(taskId, ...EXCLUDING_EVENT_KINDS)
    .map((r) => r.nurse_id);
}

export function addEvent(ctx, { taskId, actor, kind, message, requestId = null, nurseId = null }) {
  ctx.db
    .prepare(
      `INSERT INTO events (task_id, at, actor, kind, message, request_id, nurse_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(taskId, ctx.now(), actor, kind, message, requestId, nurseId);
}

// Runs a head nurse / nurse action in one transaction. If it ends in a 409, the
// transaction is rolled back and then the rejection is written to the history
// (outside the rolled-back transaction, so it survives).
// fn returns { request? }; a new auto-assign request is handed to the engine
// only after the commit.
function act(ctx, { taskId, actor, nurseId = null }, fn) {
  let result;
  try {
    result = tx(ctx.db, fn);
  } catch (err) {
    if (err instanceof Conflict) {
      addEvent(ctx, { taskId, actor, kind: 'action_rejected', message: err.message, nurseId });
    }
    throw err;
  }
  if (result?.request) dispatch(ctx, result.request);
  return { task: viewTask(ctx.db, taskId) };
}

function requireTask(db, id) {
  const task = getTask(db, id);
  if (!task) throw notFound('That care task does not exist.');
  return task;
}

function requireStatus(task, allowed, doing) {
  if (!allowed.includes(task.status)) {
    throw new Conflict(`Cannot ${doing}: the task is ${statusLabel(task.status).toLowerCase()}.`);
  }
}

// ---------------------------------------------------------------- auto-assign requests

// Submit, retry and create all go through here. Must run inside a transaction.
function startRequest(ctx, task) {
  const { db } = ctx;
  const now = ctx.now();
  const requestId = randomUUID();

  db.prepare(
    `UPDATE tasks SET status = 'finding', current_request_id = ?, request_started_at = ?,
       nurse_id = NULL, attention_reason = NULL, offered_at = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(requestId, now, now, task.id);

  addEvent(ctx, {
    taskId: task.id,
    actor: 'system',
    kind: 'request_sent',
    message: `Auto-assign request ${short(requestId)} sent to find a nurse for ${specialtyLabel(task.specialty)}.`,
    requestId,
  });

  const candidateIds = db
    .prepare('SELECT * FROM nurses WHERE on_shift = 1 ORDER BY id')
    .all()
    .map(toNurse)
    .filter((n) => n.specialties.includes(task.specialty))
    .map((n) => n.id);

  return { taskId: task.id, requestId, candidateIds };
}

function dispatch(ctx, request) {
  ctx.engine.start(request, (answer) => resolveRequest(ctx, request.taskId, request.requestId, answer));
}

// The auto-assign system has answered. Only the task's current request may
// change the task; anything else is recorded and ignored.
export function resolveRequest(ctx, taskId, requestId, { candidateIds, forceNoNurse = false }) {
  const { db } = ctx;
  return tx(db, () => {
    const task = getTask(db, taskId);
    if (!task) return { applied: false }; // e.g. the demo was reset

    if (task.current_request_id !== requestId) {
      addEvent(ctx, {
        taskId,
        actor: 'system',
        kind: 'late_answer_ignored',
        message: `Late answer ignored (request ${short(requestId)}): ${staleReason(db, task, requestId)}`,
        requestId,
        nurseId: task.nurse_id,
      });
      return { applied: false };
    }

    const now = ctx.now();
    const excluded = excludedNurseIds(db, taskId);

    // Choose at answer time, from candidates that are still eligible now.
    const candidates = candidateIds.map((id) => getNurse(db, id)).filter(Boolean);
    const workloadById = new Map(candidates.map((n) => [n.id, workloadOf(db, n.id)]));
    const nurse = forceNoNurse
      ? null
      : pickNurse({ nurses: candidates, task, workloadById, excludedIds: excluded });

    if (!nurse) {
      const result = db
        .prepare(
          `UPDATE tasks SET status = 'needs_attention', attention_reason = 'no_nurse',
             current_request_id = NULL, request_started_at = NULL, updated_at = ?
           WHERE id = ? AND current_request_id = ?`,
        )
        .run(now, taskId, requestId);
      assertOneRow(result);
      addEvent(ctx, {
        taskId,
        actor: 'system',
        kind: 'no_nurse',
        message: forceNoNurse
          ? `Auto-assign request ${short(requestId)} answered: no nurse available.`
          : `Auto-assign request ${short(requestId)} answered: no nurse available. No on-shift ${specialtyLabel(task.specialty)} nurse is free within the workload limit of ${WORKLOAD_LIMIT}${excluded.length ? ' (nurses who already declined or failed on this task are skipped)' : ''}.`,
        requestId,
      });
      return { applied: true, status: 'needs_attention' };
    }

    const before = workloadById.get(nurse.id);
    const result = db
      .prepare(
        `UPDATE tasks SET status = 'offered', nurse_id = ?, offered_at = ?,
           current_request_id = NULL, request_started_at = NULL, attention_reason = NULL, updated_at = ?
         WHERE id = ? AND current_request_id = ?`,
      )
      .run(nurse.id, now, now, taskId, requestId);
    assertOneRow(result);
    addEvent(ctx, {
      taskId,
      actor: 'system',
      kind: 'offered',
      message: `Auto-assign request ${short(requestId)} offered the task to ${nurse.name} (workload ${before} → ${before + task.acuity}). Waiting for her to accept.`,
      requestId,
      nurseId: nurse.id,
    });
    return { applied: true, status: 'offered', nurseId: nurse.id };
  });
}

function assertOneRow(result) {
  if (result.changes !== 1) throw new Error('Guarded update changed no row: the request is no longer current.');
}

// Explain, from the history, why an old request no longer counts.
function staleReason(db, task, requestId) {
  const ev = db
    .prepare(
      `SELECT * FROM events
       WHERE task_id = ? AND request_id = ?
         AND kind IN ('assigned_by_hand', 'retry', 'cancelled', 'restart_interrupted')
       ORDER BY id DESC LIMIT 1`,
    )
    .get(task.id, requestId);

  if (ev?.kind === 'assigned_by_hand') return `already assigned by head nurse to ${nurseName(db, ev.nurse_id)}.`;
  if (ev?.kind === 'cancelled') return 'the task was cancelled.';
  if (ev?.kind === 'restart_interrupted') return 'request was lost when the server restarted.';
  if (ev?.kind === 'retry') {
    const next = db
      .prepare(
        `SELECT request_id FROM events
         WHERE task_id = ? AND kind = 'request_sent' AND id > ? ORDER BY id LIMIT 1`,
      )
      .get(task.id, ev.id);
    return next ? `replaced by a newer request (${short(next.request_id)}).` : 'replaced by a newer request.';
  }
  return `the task has moved on (it is now ${statusLabel(task.status).toLowerCase()}).`;
}

// ---------------------------------------------------------------- head nurse actions

function parseNewTask(db, body) {
  const b = body ?? {};
  const patient = Number.isInteger(b.patientId) && db.prepare('SELECT id FROM patients WHERE id = ?').get(b.patientId);
  if (!patient) throw badRequest('Choose a patient from the list.');
  const careNeeded = typeof b.careNeeded === 'string' ? b.careNeeded.trim() : '';
  if (!careNeeded || careNeeded.length > 200) throw badRequest('Describe the care needed in 1 to 200 characters.');
  if (!keys(SPECIALTIES).includes(b.specialty)) throw badRequest('Choose one of the nursing specialties.');
  if (!Number.isInteger(b.acuity) || b.acuity < 1 || b.acuity > 4) throw badRequest('Acuity must be a whole number from 1 to 4.');
  if (!PRIORITIES.includes(b.priority)) throw badRequest('Priority must be urgent or routine.');
  return { patientId: b.patientId, careNeeded, specialty: b.specialty, acuity: b.acuity, priority: b.priority };
}

export function createTask(ctx, body) {
  const { db } = ctx;
  const input = parseNewTask(db, body);
  let taskId;
  const out = tx(db, () => {
    const now = ctx.now();
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(input.patientId);
    const res = db
      .prepare(
        `INSERT INTO tasks (patient_id, care_needed, specialty, acuity, priority, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'new', ?, ?)`,
      )
      .run(input.patientId, input.careNeeded, input.specialty, input.acuity, input.priority, now, now);
    taskId = Number(res.lastInsertRowid);
    addEvent(ctx, {
      taskId,
      actor: 'head_nurse',
      kind: 'created',
      message: `Care task created for ${patient.name} (Bed ${patient.bed}): ${input.careNeeded}. ${specialtyLabel(input.specialty)}, acuity ${input.acuity}, ${input.priority}.`,
    });
    return { request: startRequest(ctx, getTask(db, taskId)) };
  });
  dispatch(ctx, out.request);
  return { task: viewTask(db, taskId) };
}

export function submitTask(ctx, taskId) {
  return act(ctx, { taskId, actor: 'head_nurse' }, () => {
    const task = requireTask(ctx.db, taskId);
    requireStatus(task, ['new'], 'send it for auto-assign');
    return { request: startRequest(ctx, task) };
  });
}

export function retryTask(ctx, taskId) {
  return act(ctx, { taskId, actor: 'head_nurse' }, () => {
    const task = requireTask(ctx.db, taskId);
    requireStatus(task, ['finding', 'needs_attention'], 'retry');
    const old = task.current_request_id;
    addEvent(ctx, {
      taskId,
      actor: 'head_nurse',
      kind: 'retry',
      message: old
        ? `Head nurse asked for a retry. Request ${short(old)} was replaced; its answer will be ignored.`
        : 'Head nurse asked for a retry.',
      requestId: old,
    });
    return { request: startRequest(ctx, task) };
  });
}

export function assignTask(ctx, taskId, body) {
  const nurseId = body?.nurseId;
  if (!Number.isInteger(nurseId)) throw badRequest('Choose a nurse to assign.');
  return act(ctx, { taskId, actor: 'head_nurse', nurseId }, () => {
    const { db } = ctx;
    const task = requireTask(db, taskId);
    const nurse = getNurse(db, nurseId);
    if (!nurse) throw notFound('That nurse does not exist.');
    requireStatus(task, ['new', 'finding', 'offered', 'accepted', 'needs_attention'], 'assign a nurse');

    if (task.status === 'accepted' && task.nurse_id === nurseId) {
      throw new Conflict(`${nurse.name} already holds this task.`);
    }
    if (!nurse.onShift) throw new Conflict(`${nurse.name} is not on shift.`);
    if (!nurse.specialties.includes(task.specialty)) {
      throw new Conflict(`${nurse.name} does not have the ${specialtyLabel(task.specialty)} specialty.`);
    }
    // If she already holds this task (offered to her), its acuity is already in her workload.
    const holdsIt = task.nurse_id === nurseId && ['offered', 'accepted'].includes(task.status);
    const before = workloadOf(db, nurseId) - (holdsIt ? task.acuity : 0);
    if (!isEligible(nurse, task, before)) {
      throw new Conflict(
        `Assigning this task would put ${nurse.name} at workload ${before + task.acuity}, over the limit of ${WORKLOAD_LIMIT}.`,
      );
    }

    const replacedRequest = task.current_request_id;
    const replacedNurse = task.nurse_id && task.nurse_id !== nurseId ? nurseName(db, task.nurse_id) : null;
    const now = ctx.now();
    const res = db
      .prepare(
        `UPDATE tasks SET status = 'accepted', nurse_id = ?, current_request_id = NULL, request_started_at = NULL,
           attention_reason = NULL, offered_at = NULL, updated_at = ?
         WHERE id = ? AND status = ?`,
      )
      .run(nurseId, now, taskId, task.status);
    assertOneRow(res);

    let message = `Head nurse assigned the task to ${nurse.name} by hand (workload ${before} → ${before + task.acuity}).`;
    if (replacedNurse) message += ` ${replacedNurse} was replaced.`;
    if (replacedRequest) message += ` Auto-assign request ${short(replacedRequest)} was still pending; its answer will be ignored.`;
    addEvent(ctx, { taskId, actor: 'head_nurse', kind: 'assigned_by_hand', message, requestId: replacedRequest, nurseId });
    return {};
  });
}

export function cancelTask(ctx, taskId) {
  return act(ctx, { taskId, actor: 'head_nurse' }, () => {
    const { db } = ctx;
    const task = requireTask(db, taskId);
    requireStatus(task, ['new', 'finding', 'offered', 'accepted', 'needs_attention'], 'cancel');
    const holder = task.nurse_id ? nurseName(db, task.nurse_id) : null;
    db.prepare(
      `UPDATE tasks SET status = 'cancelled', nurse_id = NULL, current_request_id = NULL, request_started_at = NULL,
         attention_reason = NULL, offered_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(ctx.now(), taskId);

    let message = 'Head nurse cancelled the task.';
    if (holder) message += ` ${holder} no longer holds it.`;
    if (task.current_request_id) message += ` Auto-assign request ${short(task.current_request_id)} was still pending; its answer will be ignored.`;
    addEvent(ctx, { taskId, actor: 'head_nurse', kind: 'cancelled', message, requestId: task.current_request_id });
    return {};
  });
}

// ---------------------------------------------------------------- simulated nurse responses

// Each action is a guarded UPDATE: it only changes the task if it is still in
// the expected state AND still belongs to this nurse.
const NURSE_ACTIONS = {
  accept: {
    label: 'Accept',
    from: 'offered',
    set: `status = 'accepted'`,
    kind: 'accepted',
    message: (n) => `${n} accepted the task.`,
  },
  decline: {
    label: 'Decline',
    from: 'offered',
    set: `status = 'needs_attention', attention_reason = 'declined', nurse_id = NULL, offered_at = NULL`,
    kind: 'declined',
    message: (n) => `${n} declined the offer. The task needs the head nurse's attention.`,
  },
  fail: {
    label: 'Called-away',
    from: 'accepted',
    set: `status = 'needs_attention', attention_reason = 'failed', nurse_id = NULL`,
    kind: 'failed',
    message: (n) => `${n} was called away before reaching the patient. The task needs the head nurse's attention.`,
  },
  done: {
    label: 'Done',
    from: 'accepted',
    set: `status = 'done'`,
    kind: 'done',
    message: (n) => `${n} finished the task.`,
  },
};

export function nurseAction(ctx, taskId, body) {
  const nurseId = body?.nurseId;
  const def = NURSE_ACTIONS[body?.action];
  if (!Number.isInteger(nurseId)) throw badRequest('Say which nurse is responding.');
  if (!def) throw badRequest('Action must be accept, decline, fail or done.');

  return act(ctx, { taskId, actor: 'nurse', nurseId }, () => {
    const { db } = ctx;
    const task = requireTask(db, taskId);
    const nurse = getNurse(db, nurseId);
    if (!nurse) throw notFound('That nurse does not exist.');

    const res = db
      .prepare(`UPDATE tasks SET ${def.set}, updated_at = ? WHERE id = ? AND status = ? AND nurse_id = ?`)
      .run(ctx.now(), taskId, def.from, nurseId);

    if (res.changes !== 1) {
      const holder = task.nurse_id && task.nurse_id !== nurseId ? nurseName(db, task.nurse_id) : null;
      const why =
        holder && ['offered', 'accepted', 'done'].includes(task.status)
          ? `the task is now assigned to ${holder}.`
          : `the task is now ${statusLabel(task.status).toLowerCase()}.`;
      throw new Conflict(`${def.label} from ${nurse.name} ignored: ${why}`);
    }
    addEvent(ctx, { taskId, actor: 'nurse', kind: def.kind, message: def.message(nurse.name), nurseId });
    return {};
  });
}

export function setNurseShift(ctx, nurseId, body) {
  if (typeof body?.onShift !== 'boolean') throw badRequest('onShift must be true or false.');
  const res = ctx.db.prepare('UPDATE nurses SET on_shift = ? WHERE id = ?').run(body.onShift ? 1 : 0, nurseId);
  if (res.changes !== 1) throw notFound('That nurse does not exist.');
  return { nurse: viewNurse(ctx.db, nurseId) };
}

// ---------------------------------------------------------------- demo controls

export function setDemoMode(ctx, body) {
  const mode = body?.mode ?? null;
  if (mode !== null && !DEMO_MODES.includes(mode)) {
    throw badRequest(`Mode must be one of: ${DEMO_MODES.join(', ')}, or null.`);
  }
  ctx.engine.setNextMode(mode);
  return { nextMode: ctx.engine.getNextMode() };
}

// ---------------------------------------------------------------- restart recovery

// On boot: requests that were pending are gone (their timers lived in memory).
// Flag those tasks for the head nurse. Offered tasks are left alone.
export function recoverFromRestart(ctx) {
  const { db } = ctx;
  return tx(db, () => {
    const lost = db.prepare('SELECT * FROM tasks WHERE current_request_id IS NOT NULL').all();
    for (const task of lost) {
      db.prepare(
        `UPDATE tasks SET status = 'needs_attention', attention_reason = 'restart',
           current_request_id = NULL, request_started_at = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(ctx.now(), task.id);
      addEvent(ctx, {
        taskId: task.id,
        actor: 'server',
        kind: 'restart_interrupted',
        message: `Server restarted. Auto-assign request ${short(task.current_request_id)} was lost.`,
        requestId: task.current_request_id,
      });
    }
    return lost.length;
  });
}

// ---------------------------------------------------------------- queries

function viewNurse(db, id) {
  const row = db.prepare('SELECT * FROM nurses WHERE id = ?').get(id);
  const n = toNurse(row);
  const active = db
    .prepare(`SELECT COUNT(*) AS c FROM tasks WHERE nurse_id = ? AND status IN ('offered', 'accepted')`)
    .get(id).c;
  return { ...n, workload: workloadOf(db, id), activeTaskCount: active };
}

function viewTask(db, id) {
  const row = getTask(db, id);
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(row.patient_id);
  return buildTask(db, row, patient);
}

function buildTask(db, row, patient) {
  return {
    id: row.id,
    patient: { id: patient.id, name: patient.name, bed: patient.bed },
    careNeeded: row.care_needed,
    specialty: row.specialty,
    acuity: row.acuity,
    priority: row.priority,
    status: row.status,
    attentionReason: row.attention_reason,
    nurse: row.nurse_id ? { id: row.nurse_id, name: nurseName(db, row.nurse_id) } : null,
    requestId: row.current_request_id,
    requestStartedAt: row.request_started_at,
    offeredAt: row.offered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    excludedNurseIds: excludedNurseIds(db, row.id),
  };
}

export function getBoard(ctx) {
  const { db } = ctx;
  const patientRows = db.prepare('SELECT * FROM patients ORDER BY id').all();
  const patients = patientRows.map((p) => ({ id: p.id, name: p.name, bed: p.bed }));
  const patientById = new Map(patientRows.map((p) => [p.id, p]));

  const nurses = db
    .prepare('SELECT id FROM nurses ORDER BY id')
    .all()
    .map((r) => viewNurse(db, r.id));

  const tasks = db
    .prepare(
      `SELECT * FROM tasks ORDER BY
         CASE status WHEN 'needs_attention' THEN 0 WHEN 'finding' THEN 1 WHEN 'offered' THEN 2
                     WHEN 'new' THEN 3 WHEN 'accepted' THEN 4 WHEN 'done' THEN 5 ELSE 6 END,
         CASE priority WHEN 'urgent' THEN 0 ELSE 1 END,
         created_at, id`,
    )
    .all()
    .map((row) => buildTask(db, row, patientById.get(row.patient_id)));

  return {
    serverNow: ctx.now(),
    config: { workloadLimit: WORKLOAD_LIMIT, warnAfterMs: WARN_AFTER_MS, offerTimeoutMs: OFFER_TIMEOUT_MS },
    demo: { nextMode: ctx.engine.getNextMode() },
    specialties: SPECIALTIES,
    patients,
    nurses,
    tasks,
  };
}

export function getEvents(ctx, taskId) {
  requireTask(ctx.db, taskId);
  return ctx.db
    .prepare('SELECT * FROM events WHERE task_id = ? ORDER BY at, id')
    .all(taskId)
    .map((e) => ({
      id: e.id,
      at: e.at,
      actor: e.actor,
      kind: e.kind,
      message: e.message,
      requestId: e.request_id,
      nurseId: e.nurse_id,
    }));
}

