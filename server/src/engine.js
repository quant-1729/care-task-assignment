import { DEMO_MODES } from './constants.js';

const NEVER_ANSWERS_CHANCE = 0.2;

// Fixed delays for the demo modes (ms). `never` schedules nothing.
const MODE_DELAY = { no_nurse: 3000, fast: 2000, slow: 60000 };

// The fake auto-assign system. It never touches the database: it only decides
// whether and when to answer, then calls back into the service.
// random / schedule / cancel can be replaced in tests.
export function createEngine({
  random = Math.random,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (handle) => clearTimeout(handle),
} = {}) {
  const pending = new Map(); // requestId -> timer handle
  let nextMode = null;

  return {
    getNextMode: () => nextMode,

    setNextMode(mode) {
      if (mode !== null && !DEMO_MODES.includes(mode)) throw new Error(`Unknown demo mode: ${mode}`);
      nextMode = mode;
    },

    // request: { taskId, requestId, candidateIds }
    // onAnswer({ candidateIds, forceNoNurse }) is called when the answer arrives.
    // Returns what was decided, which is handy in tests.
    start(request, onAnswer) {
      const mode = nextMode;
      nextMode = null; // a demo mode applies to one request only

      let delayMs;
      if (mode === 'never') {
        delayMs = null;
      } else if (mode) {
        delayMs = MODE_DELAY[mode];
      } else if (random() < NEVER_ANSWERS_CHANCE) {
        delayMs = null; // silently never answers: no error, no sign
      } else {
        delayMs = 5000 + random() * 15000;
      }
      if (delayMs === null) return { answers: false };

      const forceNoNurse = mode === 'no_nurse';
      const handle = schedule(() => {
        pending.delete(request.requestId);
        try {
          onAnswer({ candidateIds: request.candidateIds, forceNoNurse });
        } catch (err) {
          console.error('Auto-assign answer failed:', err);
        }
      }, delayMs);
      pending.set(request.requestId, handle);
      return { answers: true, delayMs };
    },

    pendingCount: () => pending.size,

    // Drop every timer that has not fired yet (used on reset and shutdown).
    clear() {
      for (const handle of pending.values()) cancel(handle);
      pending.clear();
      nextMode = null;
    },
  };
}
