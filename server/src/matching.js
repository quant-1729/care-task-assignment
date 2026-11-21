import { WORKLOAD_LIMIT } from './constants.js';

// Can this nurse take the task right now?
// nurse: { id, onShift, specialties }, task: { specialty, acuity }.
export function isEligible(nurse, task, workload, excludedIds = [], limit = WORKLOAD_LIMIT) {
  return (
    nurse.onShift &&
    nurse.specialties.includes(task.specialty) &&
    !excludedIds.includes(nurse.id) &&
    workload + task.acuity <= limit
  );
}

// The matching rule: among eligible nurses, the lowest workload wins;
// a tie goes to the lowest id. Returns the nurse, or null if nobody fits.
// workloadById: Map or plain object of nurseId -> current workload.
export function pickNurse({ nurses, task, workloadById, excludedIds = [], limit = WORKLOAD_LIMIT }) {
  const load = (n) => (workloadById instanceof Map ? workloadById.get(n.id) : workloadById[n.id]) ?? 0;
  const eligible = nurses.filter((n) => isEligible(n, task, load(n), excludedIds, limit));
  eligible.sort((a, b) => load(a) - load(b) || a.id - b.id);
  return eligible[0] ?? null;
}
