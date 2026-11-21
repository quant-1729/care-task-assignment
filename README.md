# Care task assignment

A small full-stack app for a head nurse. Care tasks are sent to a fake auto-assign system that picks a nurse with the right specialty. The system is deliberately unreliable: it is slow, and sometimes never answers. The head nurse watches every task, steps in when something is stuck, and recovers tasks when a nurse declines or is called away.

All data is fake. There is no real patient information anywhere.

## Run it

Needs Node 24 (it uses the built-in `node:sqlite`).

```
cd server
npm install
npm start          # API on http://localhost:3001, database in server/data/app.db
```

```
cd client
npm install
npm run dev        # screens on http://localhost:5173
```

Tests:

```
cd server
npm test
```

The tests run against a temporary SQLite file with a fake clock and fixed random numbers, so they are fast and repeatable. They cover:

- a late answer is ignored after the head nurse assigns by hand, retries or cancels
- a task never gets two nurses: a replaced nurse can't accept, the database refuses a nurse on the wrong status, and two answers in a row can't push a nurse over the limit
- a restart flags tasks whose request was in flight, leaves offers alone, and ignores the old request if it ever answers
- the matching rule, the 25 s / 30 s warning, the 60 s offer timeout, and that about 20% of requests never answer

The screens were checked by hand against the real server: the four use cases (routine assignment, a stuck urgent request, a hand assignment with the late answer ignored, recovery after declines), a page refresh, and killing and restarting the server while a request was pending.

The **Demo controls** panel on the Tasks screen sets what the next request does (never answers, no nurse, 2 s, 60 s) and can reset the data to the starting state.

## How it works

**Task steps.** New → Finding a nurse → Offered → Accepted → Done. Anything that goes wrong moves the task to **Needs attention**, always with a reason: no nurse available, nurse declined, failed before starting, taking too long, or interrupted by restart. The head nurse can also cancel a task.

**Auto-assign (simulated).** Among nurses who are on shift and have the specialty, it picks the one with the lowest workload, skipping anyone who would go over the limit of 12. Workload is the total acuity (1–4) of a nurse's offered and accepted tasks. A request answers after 5–20 seconds, and 20% of requests never answer, with no error. The demo controls force the next request to never answer, find no nurse, answer in 2 s, or answer in 60 s.

**Simulated nurses.** There is no nurse app. Buttons in each task stand in for the nurse's phone: accept, decline, called away, done.

## Key decisions

- **Each request has its own ID, and only the current one can change the task.** Retry, assign by hand, cancel and a server restart all replace or clear the task's request ID in the same database write. When an old request answers later, the guarded update changes nothing, and the history records "Late answer ignored" with the reason. The head nurse's choice always stands.
- **A task never has two nurses.** A task has a single nurse column, so two nurses cannot be stored, and a database CHECK allows a nurse only on offered, accepted or done tasks. Every write that sets a nurse is conditional (current request ID, or "still offered to this nurse"), and the workload check happens in the same transaction as the offer.
- **Stuck requests are flagged, not cancelled.** The head nurse can't tell a slow request from one that will never answer, so the screen shows how long each request has been waiting. After 25 s (urgent) or 30 s (routine) the task is flagged "Taking too long". Normal requests take at most 20 s. The request stays live; if it answers before she acts, the answer is used.
- **Recovery waits for the head nurse.** When a nurse declines, doesn't answer an offer within 60 s, or is called away, the task moves to Needs attention with the reason. She decides: retry (which skips nurses who already declined or failed on it), assign by hand, or cancel. Nothing is re-assigned or cancelled behind her back.
- **Hand assignment goes straight to Accepted.** She has spoken to the nurse, and routing ends at acceptance.
- **Restart.** All state is in SQLite. Requests in flight live only in server memory, so on startup every task with a live request moves to "Interrupted by restart". Offers survive, because their 60 s timeout and the "taking too long" warning are computed from timestamps in the database, not from in-memory timers.
- **Refresh.** The screen keeps no state of its own. It re-reads the board from the server every 1.5 s, so a refresh just shows the current state.
- **History records everything**, including events that changed nothing, such as an ignored late answer or a rejected action, with who acted: system, head nurse, nurse or server.

## Assumptions

- One head nurse, no login.
- "Failed before work begins" means a nurse who accepted is called away before reaching the patient.
- A nurse who doesn't answer an offer within 60 s has declined. 60 s is a demo setting; a ward would use minutes.
- Going off shift doesn't take tasks away from a nurse; it only stops new ones.

## Left out on purpose

| Left out | Why |
|---|---|
| The wider hospital system: discharge, surgery status, links to hospital software | Integrations take long and need partners. |
| Shift handovers | Planned for later. |
| Supplies, financial counselling, patient condition and feedback | Outside the core problem. |
| Care quality tracking, nurse evaluation, analytics | The history makes these possible later. |
| WhatsApp or other alerts to nurses | A separate integration. |
| Login and multiple head nurses | One head nurse is enough to show the product. |
| A real nurse app | Nurse responses are simulated with buttons. |

The build was limited to a few hours, so it focuses on the core problem: assignment, stuck requests and recovery.

## What's next

- Shift handovers
- WhatsApp or app alerts to nurses
- Nurse evaluation and workload analytics from the history
- Integration with hospital software (discharge, surgery status)
- Care-quality tracking

## Project layout

- `server/`: Node, Express, SQLite. Task logic and rules in `src/service.js`, the fake auto-assign system in `src/engine.js`, tests in `test/`.
- `client/`: React, TypeScript, Tailwind CSS, EasyUI components.
- `docs/api.md`: the API contract.
- `decisions.md`: product decisions.
- `notes/session-log.md`: corrections and changes of direction during the build.
