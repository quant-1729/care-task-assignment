# API contract

The server and the screens are built against this file. Change it here first, then in code.

- Server: Node 24, Express, SQLite (`node:sqlite`). Port `3001` (env `PORT`). Database file `server/data/app.db` (env `DB_FILE`).
- Screens: Vite dev server proxies `/api` to `http://localhost:3001`.
- All times are integers in milliseconds since the epoch, from the server clock.
- Errors: `{ "error": "plain sentence for the head nurse" }` with status `400` (bad input), `404` (not found) or `409` (the action is no longer valid). Every `409` is also written to the task's history.

## Fixed values

**Specialties** (`key` → label)

| key | label |
|---|---|
| `icu` | Critical care (ICU) |
| `cardiac` | Cardiac |
| `paediatrics` | Paediatrics |
| `wound_care` | Wound care |
| `iv_medication` | IV and medication |

**Task status** (`key` → label)

| key | label | nurse set? |
|---|---|---|
| `new` | New | no |
| `finding` | Finding a nurse | no |
| `offered` | Offered | yes |
| `accepted` | Accepted | yes |
| `done` | Done | yes |
| `needs_attention` | Needs attention | no |
| `cancelled` | Cancelled | no |

**Attention reason** (only when status is `needs_attention`)

| key | label |
|---|---|
| `no_nurse` | No nurse available |
| `declined` | Nurse declined |
| `failed` | Failed before starting |
| `taking_too_long` | Taking too long |
| `restart` | Interrupted by restart |

A nurse who doesn't answer an offer within 60 s counts as a decline: reason `declined`, history kind `offer_timeout`.

**Priority:** `urgent` | `routine`. **Acuity:** integer 1–4. **Workload limit:** 12.

**Workload** of a nurse = sum of acuity of her tasks with status `offered` or `accepted`.

## Which actions are allowed

| Action | Allowed when status is |
|---|---|
| submit | `new` |
| retry | `finding`, `needs_attention` |
| assign by hand | `new`, `finding`, `offered`, `accepted`, `needs_attention` |
| cancel | `new`, `finding`, `offered`, `accepted`, `needs_attention` |
| nurse accept / decline | `offered`, and only by the offered nurse |
| nurse fail ("called away") / done | `accepted`, and only by the assigned nurse |

Anything else returns `409`.

## Endpoints

### `GET /api/board`

Everything the main screen needs. The screen polls it every 1.5 s.

```json
{
  "serverNow": 1763700000000,
  "config": {
    "workloadLimit": 12,
    "warnAfterMs": { "urgent": 25000, "routine": 30000 },
    "offerTimeoutMs": 60000
  },
  "demo": { "nextMode": null },
  "specialties": [{ "key": "icu", "label": "Critical care (ICU)" }],
  "patients": [{ "id": 1, "name": "Mara Quill", "bed": "4" }],
  "nurses": [
    {
      "id": 1,
      "name": "Asha Menon",
      "specialties": ["icu", "cardiac"],
      "onShift": true,
      "workload": 6,
      "activeTaskCount": 2
    }
  ],
  "tasks": [
    {
      "id": 7,
      "patient": { "id": 1, "name": "Mara Quill", "bed": "4" },
      "careNeeded": "Post-surgery wound dressing",
      "specialty": "wound_care",
      "acuity": 2,
      "priority": "routine",
      "status": "needs_attention",
      "attentionReason": "taking_too_long",
      "nurse": null,
      "requestId": "3f2a9c1e-…",
      "requestStartedAt": 1763699960000,
      "offeredAt": null,
      "createdAt": 1763699950000,
      "updatedAt": 1763699990000,
      "excludedNurseIds": [3]
    }
  ]
}
```

- `demo.nextMode`: `null` | `"never"` | `"no_nurse"` | `"fast"` | `"slow"`. It applies to the next request only, then goes back to `null`.
- `nurse` is `{ "id": 2, "name": "Ben Carter" }` while the status is `offered`, `accepted` or `done`, otherwise `null`.
- `requestId` is non-null only while an auto-assign request is live (status `finding`, or `needs_attention` with reason `taking_too_long`).
- `excludedNurseIds`: nurses who declined, timed out or failed on this task. Retry skips them.
- Tasks are returned in display order: `needs_attention` first, then `finding`, `offered`, `new`, `accepted`, `done`, `cancelled`; within each, `urgent` before `routine`, then oldest first.

### `GET /api/tasks/:id/events`

The task's history, oldest first.

```json
[
  {
    "id": 31,
    "at": 1763700020000,
    "actor": "system",
    "kind": "late_answer_ignored",
    "message": "Late answer ignored (request 3f2a9c): already assigned by head nurse to Ben Carter.",
    "requestId": "3f2a9c1e-…",
    "nurseId": 2
  }
]
```

- `actor`: `system` | `head_nurse` | `nurse` | `server`.
- `kind`: `created`, `request_sent`, `offered`, `no_nurse`, `taking_too_long`, `accepted`, `declined`, `offer_timeout`, `failed`, `done`, `retry`, `assigned_by_hand`, `cancelled`, `late_answer_ignored`, `action_rejected`, `restart_interrupted`.
- `message` is a full sentence the head nurse can read without knowing the kinds.

### `POST /api/tasks`

Create a care task and send it for auto-assign straight away.

Body: `{ "patientId": 1, "careNeeded": "Post-surgery wound dressing", "specialty": "wound_care", "acuity": 2, "priority": "routine" }`

Returns `201 { "task": Task }`.

### `POST /api/tasks/:id/submit`

Send a `new` task for auto-assign. Returns `{ "task": Task }`.

### `POST /api/tasks/:id/retry`

Start a new auto-assign request. Any live request becomes stale and its answer will be ignored. Returns `{ "task": Task }`.

### `POST /api/tasks/:id/assign`

Body: `{ "nurseId": 2 }`. The task goes straight to `accepted` with that nurse. Any live request becomes stale. The nurse must be on shift, have the specialty, and stay within the workload limit, otherwise `409`. Returns `{ "task": Task }`.

### `POST /api/tasks/:id/cancel`

Returns `{ "task": Task }`.

### `POST /api/tasks/:id/nurse`

Simulated nurse response. Body: `{ "nurseId": 2, "action": "accept" | "decline" | "fail" | "done" }`.

- `accept`: `offered` → `accepted`.
- `decline`: `offered` → `needs_attention` / `declined`.
- `fail`: `accepted` → `needs_attention` / `failed` (called away before reaching the patient).
- `done`: `accepted` → `done`.

Returns `{ "task": Task }`.

### `PATCH /api/nurses/:id`

Body: `{ "onShift": false }`. Returns `{ "nurse": Nurse }`. Tasks she already holds are not changed.

### `POST /api/demo/next`

Body: `{ "mode": "never" | "no_nurse" | "fast" | "slow" | null }`. Returns `{ "nextMode": ... }`.

| mode | what the next request does |
|---|---|
| `never` | never answers |
| `no_nurse` | answers "no nurse available" after 3 s |
| `fast` | answers after 2 s |
| `slow` | answers after 60 s |

### `POST /api/demo/reset`

Deletes all data, reloads the seed, clears pending requests and the demo mode. Returns `{ "ok": true }`.
