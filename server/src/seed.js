import { randomUUID } from 'node:crypto';
import { tx } from './db.js';

const PATIENTS = [
  [1, 'Odo Fenwick', '1'],
  [2, 'Lina Harrow', '2'],
  [3, 'Pip Alderman', '3'],
  [4, 'Mara Quill', '4'],
  [5, 'Wren Castellan', '5'],
  [6, 'Jory Blackwood', '6'],
  [7, 'Tamsin Rook', '7'],
  [8, 'Edda Moonfield', '8'],
];

// Every specialty is covered by at least two on-shift nurses. Hana is off shift.
const NURSES = [
  [1, 'Asha Menon', ['icu', 'cardiac'], 1],
  [2, 'Ben Carter', ['wound_care', 'iv_medication'], 1],
  [3, 'Chloe Okafor', ['paediatrics', 'iv_medication'], 1],
  [4, 'Dev Rao', ['icu'], 1],
  [5, 'Elena Marsh', ['cardiac', 'wound_care'], 1],
  [6, 'Farid Haddad', ['paediatrics'], 1],
  [7, 'Grace Lindgren', ['iv_medication', 'wound_care'], 1],
  [8, 'Hana Doyle', ['icu', 'paediatrics'], 0],
];

// Deletes everything and loads the starting data. Used on first boot and by reset.
// Times are placed relative to `now` so the board looks lived in.
export function seed(db, now) {
  tx(db, () => {
    db.exec('DELETE FROM events; DELETE FROM tasks; DELETE FROM nurses; DELETE FROM patients;');
    db.exec('DELETE FROM sqlite_sequence');

    const addPatient = db.prepare('INSERT INTO patients (id, name, bed) VALUES (?, ?, ?)');
    for (const p of PATIENTS) addPatient.run(...p);
    const addNurse = db.prepare('INSERT INTO nurses (id, name, specialties, on_shift) VALUES (?, ?, ?, ?)');
    for (const [id, name, specs, onShift] of NURSES) addNurse.run(id, name, JSON.stringify(specs), onShift);

    const ago = (seconds) => now - seconds * 1000;
    const insertTask = db.prepare(
      `INSERT INTO tasks (id, patient_id, care_needed, specialty, acuity, priority, status, attention_reason,
         nurse_id, current_request_id, request_started_at, offered_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
    );
    const insertEvent = db.prepare(
      `INSERT INTO events (task_id, at, actor, kind, message, request_id, nurse_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const ev = (taskId, secondsAgo, actor, kind, message, requestId = null, nurseId = null) =>
      insertEvent.run(taskId, ago(secondsAgo), actor, kind, message, requestId, nurseId);

    // Shared story for tasks that went through auto-assign.
    const created = (id, patient, text, label, acuity, priority, s) =>
      ev(id, s, 'head_nurse', 'created', `Care task created for ${patient[1]} (Bed ${patient[2]}): ${text}. ${label}, acuity ${acuity}, ${priority}.`);
    const sent = (id, label, s) => {
      const r = randomUUID();
      ev(id, s, 'system', 'request_sent', `Auto-assign request ${r.slice(0, 6)} sent to find a nurse for ${label}.`, r);
      return r;
    };
    const offeredTo = (id, r, name, nurseId, before, acuity, s) =>
      ev(id, s, 'system', 'offered', `Auto-assign request ${r.slice(0, 6)} offered the task to ${name} (workload ${before} → ${before + acuity}). Waiting for her to accept.`, r, nurseId);

    // 1. Wound care, accepted by Ben.
    insertTask.run(1, 4, 'Post-surgery wound dressing', 'wound_care', 2, 'routine', 'accepted', null, 2, ago(532), ago(540), ago(520));
    created(1, PATIENTS[3], 'Post-surgery wound dressing', 'Wound care', 2, 'routine', 540);
    let r = sent(1, 'Wound care', 539);
    offeredTo(1, r, 'Ben Carter', 2, 0, 2, 532);
    ev(1, 520, 'nurse', 'accepted', 'Ben Carter accepted the task.', null, 2);

    // 2. ICU, urgent, accepted by Asha.
    insertTask.run(2, 1, 'Ventilated patient, hourly checks', 'icu', 4, 'urgent', 'accepted', null, 1, ago(472), ago(480), ago(465));
    created(2, PATIENTS[0], 'Ventilated patient, hourly checks', 'Critical care (ICU)', 4, 'urgent', 480);
    r = sent(2, 'Critical care (ICU)', 479);
    offeredTo(2, r, 'Asha Menon', 1, 0, 4, 472);
    ev(2, 465, 'nurse', 'accepted', 'Asha Menon accepted the task.', null, 1);

    // 3. IV medication, done by Grace.
    insertTask.run(3, 2, 'IV antibiotic dose', 'iv_medication', 1, 'routine', 'done', null, 7, ago(411), ago(420), ago(240));
    created(3, PATIENTS[1], 'IV antibiotic dose', 'IV and medication', 1, 'routine', 420);
    r = sent(3, 'IV and medication', 419);
    offeredTo(3, r, 'Grace Lindgren', 7, 0, 1, 411);
    ev(3, 400, 'nurse', 'accepted', 'Grace Lindgren accepted the task.', null, 7);
    ev(3, 240, 'nurse', 'done', 'Grace Lindgren finished the task.', null, 7);

    // 4. Cardiac, urgent, offered to Elena who declined: needs attention.
    insertTask.run(4, 3, 'Post-procedure heart monitoring', 'cardiac', 3, 'urgent', 'needs_attention', 'declined', null, null, ago(300), ago(270));
    created(4, PATIENTS[2], 'Post-procedure heart monitoring', 'Cardiac', 3, 'urgent', 300);
    r = sent(4, 'Cardiac', 299);
    offeredTo(4, r, 'Elena Marsh', 5, 0, 3, 291);
    ev(4, 270, 'nurse', 'declined', "Elena Marsh declined the offer. The task needs the head nurse's attention.", null, 5);

    // 5 and 6. New tasks, not yet sent.
    insertTask.run(5, 5, 'Fever check and fluids', 'paediatrics', 2, 'urgent', 'new', null, null, null, ago(100), ago(100));
    created(5, PATIENTS[4], 'Fever check and fluids', 'Paediatrics', 2, 'urgent', 100);
    insertTask.run(6, 6, 'Scheduled pain medication round', 'iv_medication', 1, 'routine', 'new', null, null, null, ago(50), ago(50));
    created(6, PATIENTS[5], 'Scheduled pain medication round', 'IV and medication', 1, 'routine', 50);
  });
}

export function isEmpty(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM nurses').get().c === 0;
}
