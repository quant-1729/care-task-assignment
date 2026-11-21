import type { AttentionReason, Priority, TaskStatus } from "./api";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: "New",
  finding: "Finding a nurse",
  offered: "Offered",
  accepted: "Accepted",
  done: "Done",
  needs_attention: "Needs attention",
  cancelled: "Cancelled",
};

export const REASON_LABEL: Record<AttentionReason, string> = {
  no_nurse: "No nurse available",
  declined: "Nurse declined",
  failed: "Failed before starting",
  taking_too_long: "Taking too long",
  restart: "Interrupted by restart",
};

export const ACUITY_LABEL: Record<number, string> = {
  1: "Stable",
  2: "Moderate risk",
  3: "Complex",
  4: "High risk",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  routine: "Routine",
};

export const ACTOR_LABEL: Record<string, string> = {
  system: "System",
  head_nurse: "Head nurse",
  nurse: "Nurse",
  server: "Server",
};

export const DEMO_MODES = [
  { mode: "never", label: "Next request never answers" },
  { mode: "no_nurse", label: "Next request finds no nurse" },
  { mode: "fast", label: "Next request answers fast (2 s)" },
  { mode: "slow", label: "Next request answers slowly (60 s)" },
] as const;

export const DEMO_MODE_LABEL: Record<string, string> = Object.fromEntries(
  DEMO_MODES.map((m) => [m.mode, m.label]),
);

/** hh:mm:ss in local time. */
export function fmtClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** "42 s", "4 min", "1 h 5 min". Never negative. */
export function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function fmtSeconds(ms: number): string {
  return `${Math.max(0, Math.floor(ms / 1000))} s`;
}
