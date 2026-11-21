import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { createEngine } from '../src/engine.js';
import { pickNurse } from '../src/matching.js';
import {
  assignTask,
  cancelTask,
  createTask,
  getBoard,
  getEvents,
  nurseAction,
  recoverFromRestart,
  resolveRequest,
  retryTask,
} from '../src/service.js';
import { sweep } from '../src/sweeper.js';
import {
  addNurse,
  addPatient,
  addTaskRow,
  eventKinds,
  eventsOfKind,
  makeEnv,
  mulberry32,
  newTaskBody,
  taskRow,
} from './helpers.js';

const envs = [];
function setup(options) {
  const env = makeEnv(options);
  envs.push(env);
  return env;
}
afterEach(() => {
  while (envs.length) envs.pop().cleanup();
});

// Two ICU nurses and one patient: the common starting point.
function icuWard(env) {
  addPatient(env.db, 1, 'Test Patient');
  addNurse(env.db, 1, 'Asha Menon', ['icu', 'cardiac']);
  addNurse(env.db, 2, 'Ben Carter', ['icu']);
}

const requestOf = (env, taskId) => taskRow(env.db, taskId).current_request_id;
const workloadOf = (env, nurseId) => getBoard(env.ctx).nurses.find((n) => n.id === nurseId).workload;

describe('late answers', () => {
  test('an answer that arrives after the head nurse assigned someone is ignored', () => {
    const env = setup();
    icuWard(env);
    const { task } = createTask(env.ctx, newTaskBody());
    const r1 = requestOf(env, task.id);

    assignTask(env.ctx, task.id, { nurseId: 2 }); // Ben, by hand
    env.fire(); // R1 answers; it would have picked Asha

    const row = taskRow(env.db, task.id);
    assert.equal(row.status, 'accepted');
    assert.equal(row.nurse_id, 2);
    assert.equal(workloadOf(env, 1), 0);
    assert.equal(workloadOf(env, 2), 2);

    const [late] = eventsOfKind(env.db, task.id, 'late_answer_ignored');
    assert.ok(late, 'a late_answer_ignored event was written');
    assert.equal(late.request_id, r1);
    assert.match(late.message, new RegExp(`request ${r1.slice(0, 6)}`));
    assert.match(late.message, /already assigned by head nurse to Ben Carter/);
  });

  test('retry makes the old request stale; only the new one applies', () => {
    const env = setup();
    icuWard(env);
    const { task } = createTask(env.ctx, newTaskBody());
    const r1 = requestOf(env, task.id);

    retryTask(env.ctx, task.id);
    const r2 = requestOf(env, task.id);
    assert.notEqual(r1, r2);

    env.fire(0); // R1 answers: ignored
    assert.equal(taskRow(env.db, task.id).status, 'finding');
    const [late] = eventsOfKind(env.db, task.id, 'late_answer_ignored');
    assert.match(late.message, /replaced by a newer request/);
    assert.ok(late.message.includes(r2.slice(0, 6)));

    env.fire(1); // R2 answers: applies
    const row = taskRow(env.db, task.id);
    assert.equal(row.status, 'offered');
    assert.equal(row.nurse_id, 1);
  });

  test('an answer after the task was cancelled is ignored', () => {
    const env = setup();
    icuWard(env);
    const { task } = createTask(env.ctx, newTaskBody());
    cancelTask(env.ctx, task.id);
    env.fire();
    assert.equal(taskRow(env.db, task.id).status, 'cancelled');
    const [late] = eventsOfKind(env.db, task.id, 'late_answer_ignored');
    assert.match(late.message, /the task was cancelled/);
  });
});

describe('never two nurses', () => {
  test('a nurse whose offer was replaced cannot accept it', () => {
    const env = setup();
    icuWard(env);
    const { task } = createTask(env.ctx, newTaskBody());
    env.fire(); // offered to Asha
    assert.equal(taskRow(env.db, task.id).nurse_id, 1);

    assignTask(env.ctx, task.id, { nurseId: 2 }); // head nurse picks Ben

    assert.throws(() => nurseAction(env.ctx, task.id, { nurseId: 1, action: 'accept' }), {
      status: 409,
      message: 'Accept from Asha Menon ignored: the task is now assigned to Ben Carter.',
    });
    const row = taskRow(env.db, task.id);
    assert.equal(row.nurse_id, 2);
    assert.equal(row.status, 'accepted');
    const [rejected] = eventsOfKind(env.db, task.id, 'action_rejected');
    assert.equal(rejected.actor, 'nurse');
    assert.equal(rejected.nurse_id, 1);
    assert.match(rejected.message, /Accept from Asha Menon ignored/);
  });

  test('the database itself refuses a nurse on a task that is not offered, accepted or done', () => {
    const env = setup();
    icuWard(env);
    const id = addTaskRow(env.db, { status: 'new' });
    assert.throws(() => env.db.prepare('UPDATE tasks SET nurse_id = 1 WHERE id = ?').run(id), /CHECK constraint/);
    assert.throws(
      () => env.db.prepare("UPDATE tasks SET status = 'needs_attention' WHERE id = ?").run(id),
      /CHECK constraint/,
    );
  });

  test('two answers back to back cannot push a nurse over 12', () => {
    const env = setup();
    addPatient(env.db, 1);
    addNurse(env.db, 1, 'Asha Menon', ['icu']);
    addTaskRow(env.db, { acuity: 4, nurseId: 1 });
    addTaskRow(env.db, { acuity: 4, nurseId: 1 });
    addTaskRow(env.db, { acuity: 2, nurseId: 1, status: 'offered' }); // workload 10

    const a = createTask(env.ctx, newTaskBody({ acuity: 2 })).task;
    const b = createTask(env.ctx, newTaskBody({ acuity: 2 })).task;
    env.fire(0);
    env.fire(1);

    assert.equal(taskRow(env.db, a.id).status, 'offered');
    const second = taskRow(env.db, b.id);
    assert.equal(second.status, 'needs_attention');
    assert.equal(second.attention_reason, 'no_nurse');
    assert.equal(workloadOf(env, 1), 12);
  });
});

describe('restart', () => {
  test('pending requests are flagged; offered tasks are left alone; old answers are ignored', () => {
    const first = setup();
    icuWard(first);
    const stuck = createTask(first.ctx, newTaskBody()).task;
    const offered = createTask(first.ctx, newTaskBody()).task;
    first.fire(1); // second task is offered to Asha
    const oldRequest = requestOf(first, stuck.id);
    assert.equal(taskRow(first.db, offered.id).status, 'offered');
    first.close(); // the server "stops" without the first request ever answering

    const second = setup({ file: first.file, start: first.clock.t + 5000 });
    assert.equal(recoverFromRestart(second.ctx), 1);

    const row = taskRow(second.db, stuck.id);
    assert.equal(row.status, 'needs_attention');
    assert.equal(row.attention_reason, 'restart');
    assert.equal(row.current_request_id, null);
    const [ev] = eventsOfKind(second.db, stuck.id, 'restart_interrupted');
    assert.equal(ev.actor, 'server');
    assert.match(ev.message, new RegExp(`request ${oldRequest.slice(0, 6)} was lost`));

    const untouched = taskRow(second.db, offered.id);
    assert.equal(untouched.status, 'offered');
    assert.equal(untouched.nurse_id, 1);

    // The old request's answer (it could only come from a timer that no longer exists) changes nothing.
    resolveRequest(second.ctx, stuck.id, oldRequest, { candidateIds: [1, 2] });
    assert.equal(taskRow(second.db, stuck.id).status, 'needs_attention');
    const [late] = eventsOfKind(second.db, stuck.id, 'late_answer_ignored');
    assert.match(late.message, /lost when the server restarted/);
  });
});

describe('matching', () => {
  const nurse = (id, specialties, onShift = true) => ({ id, specialties, onShift });
  const task = { specialty: 'icu', acuity: 2 };

  test('requires the specialty and being on shift', () => {
    const nurses = [nurse(1, ['cardiac']), nurse(2, ['icu'], false), nurse(3, ['icu'])];
    assert.equal(pickNurse({ nurses, task, workloadById: {} }).id, 3);
    assert.equal(pickNurse({ nurses: nurses.slice(0, 2), task, workloadById: {} }), null);
  });

  test('lowest workload wins; ties go to the lowest id', () => {
    const nurses = [nurse(1, ['icu']), nurse(2, ['icu']), nurse(3, ['icu'])];
    assert.equal(pickNurse({ nurses, task, workloadById: { 1: 5, 2: 3, 3: 3 } }).id, 2);
    assert.equal(pickNurse({ nurses, task, workloadById: {} }).id, 1);
  });

  test('skips nurses who would go over 12, but allows exactly 12', () => {
    const nurses = [nurse(1, ['icu']), nurse(2, ['icu'])];
    assert.equal(pickNurse({ nurses, task, workloadById: { 1: 11, 2: 10 } }).id, 2); // 10 + 2 = 12
    assert.equal(pickNurse({ nurses, task, workloadById: { 1: 11, 2: 11 } }), null);
  });

  test('skips excluded nurses', () => {
    const nurses = [nurse(1, ['icu']), nurse(2, ['icu'])];
    assert.equal(pickNurse({ nurses, task, workloadById: {}, excludedIds: [1] }).id, 2);
    assert.equal(pickNurse({ nurses, task, workloadById: {}, excludedIds: [1, 2] }), null);
  });

  test('the service chooses at answer time, using the workload at that moment', () => {
    const env = setup();
    icuWard(env);
    const { task: t } = createTask(env.ctx, newTaskBody({ acuity: 2 }));
    // After the request was sent, Asha picks up other work.
    addTaskRow(env.db, { acuity: 4, nurseId: 1 });
    env.fire();
    assert.equal(taskRow(env.db, t.id).nurse_id, 2); // Ben has the lowest workload
    const [offeredEvent] = eventsOfKind(env.db, t.id, 'offered');
    assert.match(offeredEvent.message, /Ben Carter \(workload 0 → 2\)/);
  });
});

describe('timers', () => {
  test('taking too long: 25 s urgent, 30 s routine, and a late answer still applies', () => {
    const env = setup();
    icuWard(env);
    const urgent = createTask(env.ctx, newTaskBody({ priority: 'urgent' })).task;
    const routine = createTask(env.ctx, newTaskBody({ priority: 'routine' })).task;

    env.advance(24_999);
    sweep(env.ctx);
    assert.equal(taskRow(env.db, urgent.id).status, 'finding');

    env.advance(1); // 25 s
    sweep(env.ctx);
    const u = taskRow(env.db, urgent.id);
    assert.equal(u.status, 'needs_attention');
    assert.equal(u.attention_reason, 'taking_too_long');
    assert.ok(u.current_request_id, 'the request is still live');
    assert.equal(taskRow(env.db, routine.id).status, 'finding');
    const [warn] = eventsOfKind(env.db, urgent.id, 'taking_too_long');
    assert.equal(warn.actor, 'system');
    assert.match(warn.message, /No answer after 25 s/);

    env.advance(4_999); // 29.999 s
    sweep(env.ctx);
    assert.equal(taskRow(env.db, routine.id).status, 'finding');
    env.advance(1); // 30 s
    sweep(env.ctx);
    assert.equal(taskRow(env.db, routine.id).attention_reason, 'taking_too_long');

    // The answer arrives after the warning but before the head nurse acted: it applies.
    env.fire(0);
    const after = taskRow(env.db, urgent.id);
    assert.equal(after.status, 'offered');
    assert.equal(after.nurse_id, 1);
    assert.equal(after.attention_reason, null);
    assert.equal(eventsOfKind(env.db, urgent.id, 'late_answer_ignored').length, 0);
  });

  test('an unanswered offer counts as a decline after 60 s, and that nurse is skipped on retry', () => {
    const env = setup();
    icuWard(env);
    const { task } = createTask(env.ctx, newTaskBody());
    env.fire(); // offered to Asha
    assert.equal(taskRow(env.db, task.id).nurse_id, 1);

    env.advance(59_999);
    sweep(env.ctx);
    assert.equal(taskRow(env.db, task.id).status, 'offered');

    env.advance(1);
    sweep(env.ctx);
    const row = taskRow(env.db, task.id);
    assert.equal(row.status, 'needs_attention');
    assert.equal(row.attention_reason, 'declined');
    assert.equal(row.nurse_id, null);
    const [timeout] = eventsOfKind(env.db, task.id, 'offer_timeout');
    assert.equal(timeout.actor, 'system');
    assert.equal(timeout.nurse_id, 1);
    assert.match(timeout.message, /Asha Menon did not answer the offer within 60 s/);
    assert.deepEqual(getBoard(env.ctx).tasks.find((t) => t.id === task.id).excludedNurseIds, [1]);

    retryTask(env.ctx, task.id);
    env.fire(); // the new request's answer
    assert.equal(taskRow(env.db, task.id).nurse_id, 2); // Ben, not Asha
  });

  test('a decline then a retry with nobody left ends in no nurse available', () => {
    const env = setup();
    addPatient(env.db, 1);
    addNurse(env.db, 1, 'Asha Menon', ['icu']);
    const { task } = createTask(env.ctx, newTaskBody());
    env.fire();
    nurseAction(env.ctx, task.id, { nurseId: 1, action: 'decline' });
    assert.equal(taskRow(env.db, task.id).attention_reason, 'declined');
    retryTask(env.ctx, task.id);
    env.fire();
    const row = taskRow(env.db, task.id);
    assert.equal(row.status, 'needs_attention');
    assert.equal(row.attention_reason, 'no_nurse');
    assert.deepEqual(eventKinds(env.db, task.id).slice(-2), ['request_sent', 'no_nurse']);
    assert.ok(getEvents(env.ctx, task.id).every((e) => e.message.length > 10));
  });
});

describe('the fake auto-assign system', () => {
  test('about 20% of requests never answer', () => {
    const calls = [];
    const engine = createEngine({
      random: mulberry32(2026),
      schedule: (fn, ms) => calls.push(ms),
      cancel: () => {},
    });
    for (let i = 0; i < 1000; i++) engine.start({ taskId: i, requestId: `r${i}`, candidateIds: [] }, () => {});
    const silent = 1000 - calls.length;
    assert.ok(silent >= 150 && silent <= 250, `${silent} of 1000 never answered`);
    assert.ok(calls.every((ms) => ms >= 5000 && ms <= 20000));
  });

  test('demo modes apply to one request only', () => {
    const calls = [];
    const engine = createEngine({ random: () => 0.9, schedule: (fn, ms) => calls.push(ms), cancel: () => {} });
    const start = () => engine.start({ taskId: 1, requestId: 'r', candidateIds: [] }, () => {});
    for (const [mode, expected] of [['fast', 2000], ['slow', 60000], ['no_nurse', 3000]]) {
      calls.length = 0;
      engine.setNextMode(mode);
      start();
      assert.deepEqual(calls, [expected]);
      assert.equal(engine.getNextMode(), null);
    }
    calls.length = 0;
    engine.setNextMode('never');
    start();
    assert.deepEqual(calls, []);
    start(); // back to normal
    assert.equal(calls.length, 1);
  });
});
