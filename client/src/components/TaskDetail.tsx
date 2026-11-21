import { useEffect, useState } from "react";
import {
  ApiError,
  assignTask,
  cancelTask,
  getEvents,
  nurseAction,
  retryTask,
  submitTask,
  taskNurse,
  type Board,
  type NurseAction,
  type Task,
  type TaskEvent,
} from "../api";
import { ACTOR_LABEL, fmtClock } from "../labels";
import { Button } from "./ui/button";

interface Props {
  task: Task;
  board: Board;
  onChanged: () => void;
}

const ASSIGNABLE = ["new", "finding", "offered", "accepted", "needs_attention"];

const EVENT_STYLE: Record<string, { box: string; tag: string }> = {
  late_answer_ignored: { box: "border-l-2 border-amber-300 bg-amber-50/70", tag: "Ignored" },
  action_rejected: { box: "border-l-2 border-slate-400 bg-slate-100", tag: "Rejected" },
  restart_interrupted: { box: "border-l-2 border-violet-300 bg-violet-50/70", tag: "Restart" },
};

function History({ taskId, updatedAt }: { taskId: number; updatedAt: number }) {
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getEvents(taskId).then(
        (e) => {
          if (!cancelled) {
            setEvents(e);
            setFailed(false);
          }
        },
        () => {
          if (!cancelled) setFailed(true);
        },
      );
    load();
    const id = setInterval(load, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [taskId, updatedAt]);

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">History</h3>
      {events === null ? (
        <p className="text-sm text-slate-400">{failed ? "Could not load the history." : "Loading…"}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-slate-400">No events yet.</p>
      ) : (
        <ol className="space-y-1">
          {events.map((e) => {
            const style = EVENT_STYLE[e.kind];
            return (
              <li
                key={e.id}
                className={`flex gap-3 rounded-md px-2.5 py-1.5 text-[13px] ${style ? style.box : ""}`}
              >
                <span className="w-16 shrink-0 tabular-nums text-slate-500">{fmtClock(e.at)}</span>
                <span className="w-24 shrink-0 text-slate-500">{ACTOR_LABEL[e.actor] ?? e.actor}</span>
                <span className="min-w-0 flex-1 text-slate-800">
                  {style && (
                    <span className="mr-2 rounded bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                      {style.tag}
                    </span>
                  )}
                  {e.message}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function TaskDetail({ task, board, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedNurse, setPickedNurse] = useState("");

  const limit = board.config.workloadLimit;
  const holder = taskNurse(task, board.nurses);
  const canSubmit = task.status === "new";
  const canRetry = task.status === "finding" || task.status === "needs_attention";
  const canAssign = ASSIGNABLE.includes(task.status);
  const canCancel = ASSIGNABLE.includes(task.status);
  const hasExcluded = task.excludedNurseIds.length > 0;

  const candidates = board.nurses.filter(
    (n) => (n.onShift && n.specialties.includes(task.specialty)) || n.id === holder?.id,
  );

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work.");
    }
    setBusy(false);
    onChanged();
  }

  const simulate = (action: NurseAction) => holder && run(() => nurseAction(task.id, holder.id, action));
  const simulateBox = (task.status === "offered" || task.status === "accepted") && holder;
  const nothingToDo = !canSubmit && !canRetry && !canAssign && !canCancel;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <History taskId={task.id} updatedAt={task.updatedAt} />

      <div className="space-y-4">
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Head nurse actions</h3>
          {nothingToDo ? (
            <p className="text-sm text-slate-400">No actions are available for a {task.status} task.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {canSubmit && (
                  <Button size="sm" disabled={busy} onClick={() => run(() => submitTask(task.id))}>
                    Send for auto-assign
                  </Button>
                )}
                {canRetry && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => retryTask(task.id))}>
                    {hasExcluded ? "Retry auto-assign (skips nurses who declined)" : "Retry auto-assign"}
                  </Button>
                )}
                {canCancel && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => cancelTask(task.id))}>
                    Cancel task
                  </Button>
                )}
              </div>

              {canAssign && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={pickedNurse}
                    onChange={(e) => setPickedNurse(e.target.value)}
                    aria-label="Nurse to assign by hand"
                    className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-slate-400"
                  >
                    <option value="">Assign by hand…</option>
                    {candidates.map((n) => {
                      const holds = n.id === holder?.id;
                      const over = !holds && n.workload + task.acuity > limit;
                      const declined = task.excludedNurseIds.includes(n.id);
                      return (
                        <option key={n.id} value={n.id} disabled={over}>
                          {n.name} · workload {n.workload}/{limit}
                          {declined ? " · declined earlier" : ""}
                          {holds ? " · holds this task" : ""}
                          {over ? " · over limit" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !pickedNurse}
                    onClick={() => run(() => assignTask(task.id, Number(pickedNurse)).then(() => setPickedNurse("")))}
                  >
                    Assign
                  </Button>
                </div>
              )}
              {canAssign && candidates.length === 0 && (
                <p className="text-xs text-slate-500">No on-shift nurse has this specialty.</p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
        </div>

        {simulateBox && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-500">Simulation: {holder.name}&rsquo;s phone</p>
            <p className="mb-2 text-xs text-slate-400">
              Stands in for the nurse. Nothing here is a head nurse action.
            </p>
            <div className="flex flex-wrap gap-2">
              {task.status === "offered" ? (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => simulate("accept")}>
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => simulate("decline")}>
                    Decline
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => simulate("fail")}>
                    Called away (failed before starting)
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => simulate("done")}>
                    Mark done
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
