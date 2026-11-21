import { tx } from './db.js';
import { OFFER_TIMEOUT_MS, WARN_AFTER_MS } from './constants.js';
import { addEvent, nurseName } from './service.js';

// One pass of the background check. It reads timestamps from the database
// (not from memory), so it keeps working across a server restart.
export function sweep(ctx) {
  const { db } = ctx;
  return tx(db, () => {
    const now = ctx.now();
    let flagged = 0;
    let timedOut = 0;

    // Requests that have been waiting too long. The request stays live: an
    // answer that arrives later can still apply until the head nurse acts.
    const finding = db
      .prepare(`SELECT * FROM tasks WHERE status = 'finding' AND request_started_at IS NOT NULL`)
      .all();
    for (const task of finding) {
      const limit = WARN_AFTER_MS[task.priority];
      if (now - task.request_started_at < limit) continue;
      const res = db
        .prepare(
          `UPDATE tasks SET status = 'needs_attention', attention_reason = 'taking_too_long', updated_at = ?
           WHERE id = ? AND status = 'finding' AND current_request_id = ?`,
        )
        .run(now, task.id, task.current_request_id);
      if (res.changes !== 1) continue;
      flagged++;
      addEvent(ctx, {
        taskId: task.id,
        actor: 'system',
        kind: 'taking_too_long',
        message: `No answer after ${limit / 1000} s. Flagged as taking too long; the request is still pending.`,
        requestId: task.current_request_id,
      });
    }

    // Offers nobody answered count as a decline.
    const offered = db.prepare(`SELECT * FROM tasks WHERE status = 'offered' AND offered_at IS NOT NULL`).all();
    for (const task of offered) {
      if (now - task.offered_at < OFFER_TIMEOUT_MS) continue;
      const name = nurseName(db, task.nurse_id);
      const res = db
        .prepare(
          `UPDATE tasks SET status = 'needs_attention', attention_reason = 'declined',
             nurse_id = NULL, offered_at = NULL, updated_at = ?
           WHERE id = ? AND status = 'offered' AND nurse_id = ?`,
        )
        .run(now, task.id, task.nurse_id);
      if (res.changes !== 1) continue;
      timedOut++;
      addEvent(ctx, {
        taskId: task.id,
        actor: 'system',
        kind: 'offer_timeout',
        message: `${name} did not answer the offer within ${OFFER_TIMEOUT_MS / 1000} s. Counted as a decline.`,
        nurseId: task.nurse_id,
      });
    }

    return { flagged, timedOut };
  });
}

// Runs sweep every second. Returns a function that stops it.
export function startSweeper(ctx, intervalMs = 1000) {
  const timer = setInterval(() => {
    try {
      sweep(ctx);
    } catch (err) {
      console.error('Sweep failed:', err);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
