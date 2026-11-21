import type { ReactNode } from "react";
import { taskNurse, type Board, type Task, type TaskStatus } from "../api";
import { ACUITY_LABEL, PRIORITY_LABEL, REASON_LABEL, STATUS_LABEL, fmtAge, fmtSeconds } from "../labels";
import { Badge } from "./ui/badge";
import { DataTable, type DataTableColumn } from "./ui/data-table";
import { TaskDetail } from "./TaskDetail";

interface Props {
  board: Board;
  now: number;
  expandedId: number | null;
  onToggle: (id: number) => void;
  onChanged: () => void;
}

const STATUS_CLASS: Record<TaskStatus, string> = {
  new: "",
  finding: "bg-sky-50 text-sky-700",
  offered: "bg-indigo-50 text-indigo-700",
  accepted: "bg-emerald-50 text-emerald-700",
  done: "bg-slate-100 text-slate-500",
  needs_attention: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-400 line-through",
};

export function StatusBadge({ task }: { task: Task }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge
        variant={task.status === "new" ? "outline" : "soft"}
        dot={task.status === "finding" || task.status === "needs_attention"}
        pulse={task.status === "finding"}
        className={STATUS_CLASS[task.status]}
      >
        {STATUS_LABEL[task.status]}
      </Badge>
      {task.status === "needs_attention" && task.attentionReason && (
        <span className="text-xs text-red-700">{REASON_LABEL[task.attentionReason]}</span>
      )}
    </div>
  );
}

function waiting(task: Task, board: Board, now: number): ReactNode {
  if (task.requestId && task.requestStartedAt !== null) {
    const elapsed = now - task.requestStartedAt;
    const late = elapsed > board.config.warnAfterMs[task.priority];
    const stillPending = task.attentionReason === "taking_too_long";
    return (
      <span className={`tabular-nums ${late ? "font-medium text-amber-600" : "text-slate-600"}`}>
        {fmtSeconds(elapsed)}
        {stillPending && <span className="ml-1.5 text-xs font-normal">still pending</span>}
      </span>
    );
  }
  if (task.status === "offered" && task.offeredAt !== null) {
    return <span className="tabular-nums text-slate-600">offer open {fmtSeconds(now - task.offeredAt)}</span>;
  }
  return <span className="text-slate-300">—</span>;
}

export function TaskTable({ board, now, expandedId, onToggle, onChanged }: Props) {
  const specLabel = Object.fromEntries(board.specialties.map((s) => [s.key, s.label]));

  const columns: DataTableColumn<Task>[] = [
    {
      key: "patient",
      header: "Bed / patient",
      sortable: false,
      primary: true,
      width: "minmax(130px,1.1fr)",
      cell: (t) => (
        <div className="leading-tight">
          <div className="font-medium text-slate-900">Bed {t.patient.bed}</div>
          <div className="text-xs text-slate-500">{t.patient.name}</div>
        </div>
      ),
    },
    {
      key: "careNeeded",
      header: "Care needed",
      sortable: false,
      width: "minmax(150px,1.6fr)",
      cell: (t) => <span className="text-slate-800">{t.careNeeded}</span>,
    },
    {
      key: "specialty",
      header: "Specialty",
      sortable: false,
      width: "minmax(110px,1fr)",
      cell: (t) => <span className="text-slate-600">{specLabel[t.specialty] ?? t.specialty}</span>,
    },
    {
      key: "acuity",
      header: "Acuity",
      sortable: false,
      width: "minmax(130px,0.9fr)",
      cell: (t) => (
        <span className="text-slate-600">
          {t.acuity} · {ACUITY_LABEL[t.acuity]?.toLowerCase()}
        </span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      sortable: false,
      width: "90px",
      cell: (t) =>
        t.priority === "urgent" ? (
          <Badge variant="solid" tone="danger">
            {PRIORITY_LABEL.urgent}
          </Badge>
        ) : (
          <Badge variant="outline">{PRIORITY_LABEL.routine}</Badge>
        ),
    },
    {
      key: "status",
      header: "Status",
      sortable: false,
      width: "minmax(140px,1.1fr)",
      cell: (t) => <StatusBadge task={t} />,
    },
    {
      key: "nurse",
      header: "Nurse",
      sortable: false,
      width: "minmax(100px,0.9fr)",
      cell: (t) => {
        const n = taskNurse(t, board.nurses);
        return n ? <span className="text-slate-800">{n.name}</span> : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: "createdAt",
      header: "Since created",
      sortable: false,
      width: "100px",
      cell: (t) => <span className="tabular-nums text-slate-600">{fmtAge(now - t.createdAt)}</span>,
    },
    {
      key: "waiting",
      header: "Waiting",
      sortable: false,
      width: "minmax(120px,1fr)",
      cell: (t) => waiting(t, board, now),
    },
  ];

  return (
    <DataTable
      rows={board.tasks}
      columns={columns}
      selectable={false}
      searchable
      searchPlaceholder="Search patient, bed or care…"
      searchText={(t) => `${t.patient.name} bed ${t.patient.bed} ${t.careNeeded} ${taskNurse(t, board.nurses)?.name ?? ""}`}
      pageSize={Infinity}
      maxHeight={100000}
      minWidth={1100}
      ariaLabel="Care tasks"
      getRowLabel={(t) => `Bed ${t.patient.bed}, ${t.careNeeded}`}
      onRowClick={(t) => onToggle(t.id)}
      expandedId={expandedId}
      renderExpanded={(t) => <TaskDetail task={t} board={board} onChanged={onChanged} />}
      emptyState={<p className="text-sm text-slate-500">No care tasks yet.</p>}
    />
  );
}
