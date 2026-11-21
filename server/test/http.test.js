import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { makeEnv } from './helpers.js';

let env;
let server;
let base;

before(async () => {
  env = makeEnv();
  seed(env.db, env.clock.t);
  server = createApp(env.ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
  env.cleanup();
});

const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

test('GET /api/board has the documented shape', async () => {
  const res = await fetch(`${base}/api/board`);
  assert.equal(res.status, 200);
  const board = await res.json();

  assert.equal(board.serverNow, env.clock.t);
  assert.deepEqual(board.config, {
    workloadLimit: 12,
    warnAfterMs: { urgent: 25000, routine: 30000 },
    offerTimeoutMs: 60000,
  });
  assert.deepEqual(board.demo, { nextMode: null });
  assert.equal(board.specialties.length, 5);
  assert.equal(board.patients.length, 8);
  assert.equal(board.nurses.length, 8);
  assert.equal(board.tasks.length, 6);

  const asha = board.nurses.find((n) => n.name === 'Asha Menon');
  assert.deepEqual(Object.keys(asha).sort(), ['activeTaskCount', 'id', 'name', 'onShift', 'specialties', 'workload']);
  assert.equal(asha.workload, 4);
  assert.equal(asha.activeTaskCount, 1);

  const keys = ['id', 'patient', 'careNeeded', 'specialty', 'acuity', 'priority', 'status', 'attentionReason', 'nurse',
    'requestId', 'requestStartedAt', 'offeredAt', 'createdAt', 'updatedAt', 'excludedNurseIds'];
  for (const t of board.tasks) assert.deepEqual(Object.keys(t).sort(), [...keys].sort());

  // Display order: needs attention first, then new (urgent before routine), accepted, done.
  assert.deepEqual(
    board.tasks.map((t) => t.status),
    ['needs_attention', 'new', 'new', 'accepted', 'accepted', 'done'],
  );
  assert.equal(board.tasks[0].attentionReason, 'declined');
  assert.deepEqual(board.tasks[0].excludedNurseIds, [5]);
  assert.equal(board.tasks[1].priority, 'urgent');
});

test('a disallowed action returns 409 with { error } and is written to the history', async () => {
  const board = await (await fetch(`${base}/api/board`)).json();
  const newTask = board.tasks.find((t) => t.status === 'new');

  const res = await post(`/api/tasks/${newTask.id}/retry`);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 10);

  const events = await (await fetch(`${base}/api/tasks/${newTask.id}/events`)).json();
  const rejected = events.find((e) => e.kind === 'action_rejected');
  assert.ok(rejected);
  assert.equal(rejected.message, body.error);
  assert.equal(rejected.actor, 'head_nurse');
});

test('bad input is 400 and a missing task is 404', async () => {
  assert.equal((await post('/api/tasks', { patientId: 1 })).status, 400);
  assert.equal((await post('/api/tasks/9999/cancel')).status, 404);
  assert.equal((await fetch(`${base}/api/tasks/9999/events`)).status, 404);
});

test('create sends the task for auto-assign; reset restores the starting data', async () => {
  const res = await post('/api/tasks', {
    patientId: 3,
    careNeeded: 'Cardiac rhythm check',
    specialty: 'cardiac',
    acuity: 2,
    priority: 'routine',
  });
  assert.equal(res.status, 201);
  const { task } = await res.json();
  assert.equal(task.status, 'finding');
  assert.ok(task.requestId);
  assert.equal(env.scheduled.length, 1);

  assert.equal((await post('/api/demo/next', { mode: 'fast' })).status, 200);
  assert.equal((await (await fetch(`${base}/api/board`)).json()).demo.nextMode, 'fast');

  assert.deepEqual(await (await post('/api/demo/reset')).json(), { ok: true });
  assert.ok(env.scheduled.every((h) => h.cancelled), 'pending requests were cleared');
  const board = await (await fetch(`${base}/api/board`)).json();
  assert.equal(board.tasks.length, 6);
  assert.equal(board.demo.nextMode, null);
});
