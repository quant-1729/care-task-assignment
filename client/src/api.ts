// Types and fetch helpers matching docs/api.md.

export type TaskStatus =
  | "new"
  | "finding"
  | "offered"
  | "accepted"
  | "done"
  | "needs_attention"
  | "cancelled";
export type AttentionReason = "no_nurse" | "declined" | "failed" | "taking_too_long" | "restart";
export type Priority = "urgent" | "routine";
export type DemoMode = "never" | "no_nurse" | "fast" | "slow";
export type NurseAction = "accept" | "decline" | "fail" | "done";

export interface Specialty {
  key: string;
  label: string;
}
export interface Patient {
  id: number;
  name: string;
  bed: string;
}
export interface Nurse {
  id: number;
  name: string;
  specialties: string[];
  onShift: boolean;
  workload: number;
  activeTaskCount: number;
}
export interface Task {
  id: number;
  patient: Patient;
  careNeeded: string;
  specialty: string;
  acuity: number;
  priority: Priority;
  status: TaskStatus;
  attentionReason: AttentionReason | null;
  /** The contract only shows `null`; accept a bare id or an { id, name } object when a nurse is set. */
  nurse: number | { id: number; name?: string } | null;
  requestId: string | null;
  requestStartedAt: number | null;
  offeredAt: number | null;
  createdAt: number;
  updatedAt: number;
  excludedNurseIds: number[];
}
export interface Board {
  serverNow: number;
  config: {
    workloadLimit: number;
    warnAfterMs: Record<Priority, number>;
    offerTimeoutMs: number;
  };
  demo: { nextMode: DemoMode | null };
  specialties: Specialty[];
  patients: Patient[];
  nurses: Nurse[];
  tasks: Task[];
}
export interface TaskEvent {
  id: number;
  at: number;
  actor: "system" | "head_nurse" | "nurse" | "server";
  kind: string;
  message: string;
  requestId: string | null;
  nurseId: number | null;
}
export interface NewTaskInput {
  patientId: number;
  careNeeded: string;
  specialty: string;
  acuity: number;
  priority: Priority;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Cannot reach the server.", 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new ApiError("Cannot reach the server.", res.status);
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status}).`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

const FIXTURE = new URLSearchParams(window.location.search).has("fixture");
export const usingFixture = FIXTURE;

export async function getBoard(): Promise<Board> {
  if (FIXTURE) {
    const mod = await import("./dev/board.fixture.json");
    const b = structuredClone(mod.default) as unknown as Board;
    b.serverNow = Date.now();
    // shift fixture times (written relative to "now") so timers look alive
    const shift = (t: number | null) => (t === null ? null : b.serverNow + t);
    for (const t of b.tasks) {
      t.createdAt = b.serverNow + t.createdAt;
      t.updatedAt = b.serverNow + t.updatedAt;
      t.requestStartedAt = shift(t.requestStartedAt);
      t.offeredAt = shift(t.offeredAt);
    }
    return b;
  }
  return request<Board>("GET", "/api/board");
}

export async function getEvents(taskId: number): Promise<TaskEvent[]> {
  if (FIXTURE) {
    const mod = await import("./dev/board.fixture.json");
    const now = Date.now();
    const events = (mod.default as unknown as { events: TaskEvent[] }).events;
    return events.map((e) => ({ ...e, at: now + e.at }));
  }
  return request<TaskEvent[]>("GET", `/api/tasks/${taskId}/events`);
}

export const createTask = (input: NewTaskInput) => request<{ task: Task }>("POST", "/api/tasks", input);
export const submitTask = (id: number) => request<{ task: Task }>("POST", `/api/tasks/${id}/submit`);
export const retryTask = (id: number) => request<{ task: Task }>("POST", `/api/tasks/${id}/retry`);
export const assignTask = (id: number, nurseId: number) =>
  request<{ task: Task }>("POST", `/api/tasks/${id}/assign`, { nurseId });
export const cancelTask = (id: number) => request<{ task: Task }>("POST", `/api/tasks/${id}/cancel`);
export const nurseAction = (id: number, nurseId: number, action: NurseAction) =>
  request<{ task: Task }>("POST", `/api/tasks/${id}/nurse`, { nurseId, action });
export const setOnShift = (id: number, onShift: boolean) =>
  request<{ nurse: Nurse }>("PATCH", `/api/nurses/${id}`, { onShift });
export const setDemoMode = (mode: DemoMode | null) =>
  request<{ nextMode: DemoMode | null }>("POST", "/api/demo/next", { mode });
export const resetDemo = () => request<{ ok: true }>("POST", "/api/demo/reset");

/** Resolve the task's nurse (whatever shape the server sends) to an id and a display name. */
export function taskNurse(task: Task, nurses: Nurse[]): { id: number; name: string } | null {
  if (task.nurse === null || task.nurse === undefined) return null;
  const id = typeof task.nurse === "number" ? task.nurse : task.nurse.id;
  const name =
    (typeof task.nurse === "object" && task.nurse.name) || nurses.find((n) => n.id === id)?.name || `Nurse #${id}`;
  return { id, name };
}
