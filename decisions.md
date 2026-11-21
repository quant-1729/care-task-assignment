# Decisions

Nurse task assignment, MVP. Confirmed November 21, 2026.

Every decision below is confirmed. Sections 3 and 4 started as research-based drafts and were accepted as written.

---

## 1. Product and scope

**What it does:** assigns patient care tasks to nurses with the right specialty, and lets the head nurse watch, step in and fix problems.

**Why:** hospitals are short of nurses, so one nurse looks after several patients at once. The head nurse has little visibility into who is doing what.

**What the head nurse can do:**
1. See every care task, how long it has waited, which nurse has it and its current status.
2. Create a care task and send it for automatic assignment.
3. Step in at any time, for example by assigning a nurse by hand, retrying or cancelling.
4. Recover a task when a nurse declines or the assignment fails.
5. Read each task's history to understand what happened.

**Left out on purpose:**

| Left out | Why |
|---|---|
| The wider hospital system: discharge, surgery status, links to hospital software | Integrations take a long time and need industry partners. This is an MVP. |
| Shift handovers | Not part of the brief; planned for later. |
| Supplies used, financial counselling, patient condition and feedback | Not part of the brief. |
| Tracking care quality, nurse evaluation, analytics | Not part of the brief; the history makes these possible later. |
| WhatsApp or other notifications | A separate integration; planned for later. |
| Login and multiple head nurses | One head nurse is enough to show the product. |
| A real app for nurses | Nurses' accept, decline and fail actions are simulated with buttons. |

The main reason for all of these: the build is limited to 5 hours, so it focuses on the core problem, which is assignment, stuck requests and recovery.

**Data:** all fake. The app starts with fake nurses, patients and a few care tasks, and the head nurse can add new care tasks while using it. No real patient information is used anywhere.

---

## 2. Users and terms

- **Operator:** the head nurse / cluster manager who manages the nurses. She is the only user of the screens.
- **Contributors:** the nurses who are assigned tasks. In the MVP they are simulated.

| Term in the brief | Term in this product |
|---|---|
| Task | Care task, e.g. "Bed 4: post-surgery wound dressing" |
| Area of expertise | Nursing specialty |
| Contributor | Nurse |
| Operator | Head nurse |
| Routing engine | Auto-assign system |
| Priority | Urgent or routine |
| Declined | The nurse says no, e.g. because she is at full workload |
| Failed before work begins | The nurse is called away before reaching the patient |

---

## 3. Care tasks and nurses

**Specialties:**
- Critical care (ICU)
- Cardiac
- Paediatrics
- Wound care
- IV and medication

**Example tasks:**
- "Bed 4: post-surgery wound dressing" (wound care, acuity 2)
- "Bed 1: ventilated patient, hourly checks" (ICU, acuity 4)

**Each care task records:**
- fake patient and bed number
- care needed
- specialty
- acuity, 1–4
- priority: urgent or routine
- time created
- status
- assigned nurse

**Each nurse records:**
- fake name
- one or more specialties
- on shift or not
- current workload

**Acuity score** (what we first called the "K score" or "case score") rates how much care a patient needs, from 1 to 4: stable, moderate risk, complex, high risk. Charge nurses commonly use this scale.

**Workload** is the total acuity of a nurse's active tasks. One nurse can hold several tasks, up to a limit of 12. On a typical ward, a nurse looks after about 5 patients per shift.

---

## 4. Task steps

**Normal path:**
1. **New**
2. **Finding a nurse:** the auto-assign system is working on it.
3. **Offered:** waiting for the nurse to accept.
4. **Accepted:** routing ends here.
5. **Done:** the nurse has finished the task, which frees her workload. Simulated with a button.

**Problem path: Needs attention**, always with a reason:
- No nurse available
- Nurse declined
- Failed before starting
- Taking too long
- Interrupted by restart

The head nurse can also **cancel** a task.

---

## 5. Auto-assign

**Matching rule:** among nurses who are on shift and have the right specialty, pick the one with the lowest workload. Skip anyone whose workload would go over the limit.

**Simulation, as the brief requires:**
- Each request takes 5–20 seconds to answer.
- It returns either a nurse or "no nurse available".
- 20% of requests never answer, and give no error or warning.

**Demo controls:** buttons to force the next request to never answer, return "no nurse available", answer fast (2s), or answer slowly (60s). The slow option is for showing a late answer. A **Reset demo** button reloads the starting data.

---

## 6. Stuck assignment

- The head nurse cannot tell whether a pending request is slow or will never answer, so the screen shows how long each request has been waiting.
- **Warning:** a task is flagged "Taking too long" after **25 seconds if urgent, 30 seconds if routine**. Normal requests take at most 20 seconds.
- **Her options:** retry, assign a nurse by hand (the task goes straight to Accepted, since she has spoken to the nurse), or cancel.
- **Nothing is cancelled silently.** Every action is the head nurse's choice and is recorded in the history.
- **A nurse who doesn't respond to an offer** is a separate case. If she hasn't accepted or declined within **60 seconds**, it counts as a decline and is handled under recovery (section 10). 60 seconds is a demo setting; a real ward would use minutes.

---

## 7. Late answers

- Every auto-assign request has its own ID, and only the task's current request can change the task.
- If the system answers after the head nurse has already acted, **the answer is ignored and her choice stays.**
- The history records it, e.g. "Late answer ignored: already assigned by head nurse".
- Alerting nurses on WhatsApp or other apps is planned for later.

---

## 8. No double-assignment

- The database allows at most one active nurse per task, so the rule is enforced by the database and not only by the screen.
- A late system answer can't overwrite a manual assignment, because of the request-ID check in section 7.

---

## 9. Refresh and restart

- **Where data lives:** all data is stored in a SQLite database on the server, not in a cache, so nothing is lost on a restart.
- **Page refresh:** the screen simply re-reads the current state from the server and stays up to date by checking every 1–2 seconds.
- **Server restart:** requests that were still "finding a nurse" are lost. Those tasks move to **Needs attention: interrupted by restart**, and the head nurse decides what to do.

---

## 10. Recovery

- **What triggers it:**
  - the nurse declines
  - she doesn't answer the offer within 60 seconds
  - she is called away before reaching the patient (failed before starting)
- **What happens:** in all three cases, the task moves to Needs attention with the reason. Nothing is re-assigned automatically.
- **The head nurse's part:** she reads what happened in the task's history and decides what to do next: retry auto-assign (it skips anyone who already declined or failed on this task), assign a nurse by hand, or cancel. This meets the brief's requirement that the operator decides what happens next.
- **No one left:** if a retry finds no nurse, the task moves to Needs attention: no nurse available.

---

## 11. History

- Every event on a task is recorded with the time, who acted (system, head nurse, nurse or server), and what happened.
- This includes events that changed nothing, such as an ignored late answer.
- The history should let anyone understand exactly what happened to a task.
- Using it for nurse evaluation and analytics is planned for later.

---

## 12. Stack and testing

**Stack:**
- **Screens:** React with Tailwind CSS and EasyUI components (easyui.site, MIT licence). Use the calm components such as the data table, badges, toggles and accordion, and skip the flashy ones.
- **Backend:** Node.js.
- **Database:** SQLite.

**Testing:**
1. **Automated tests first.** At minimum:
   - a late answer is ignored
   - a task never gets two nurses
   - a restart flags pending tasks
2. **Then a manual check** of the four use cases, a page refresh and a server restart.

---

## 13. Working with AI agents

- **Lead and reviewer:** Claude Opus 5.5. Plans, reviews and checks the code.
- **Coding agents:** Claude Sonnet 5.5. Write the code.
- **Sessions:** planning (where these decisions were made), building and testing.
- Keep notes of where each major correction happens, for the session map.

---

## 14. Walkthrough (Loom, 10 minutes max)

1. **Happy path:** create a care task, it's assigned, the nurse accepts.
2. **Key decisions:** acuity-based matching, request IDs and late answers, the "taking too long" warning, restart behaviour.
3. **Non-happy path:** an urgent task gets stuck, the head nurse assigns a nurse by hand, and the late answer arrives and is ignored in the history.
4. **What's next:** see below.

---

## What's next (after the MVP)

- Shift handovers
- WhatsApp or app alerts to nurses
- Nurse evaluation and workload analytics from the history
- Integration with hospital software (discharge, surgery status)
- Care-quality tracking

