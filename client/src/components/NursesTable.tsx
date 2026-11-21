import { useState } from "react";
import { ApiError, setOnShift, type Board, type Nurse } from "../api";
import { Badge } from "./ui/badge";
import { DataTable, type DataTableColumn } from "./ui/data-table";
import { StretchSwitch } from "./ui/stretch-switch";

interface Props {
  board: Board;
  onChanged: () => void;
}

export function NursesTable({ board, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const limit = board.config.workloadLimit;
  const specLabel = Object.fromEntries(board.specialties.map((s) => [s.key, s.label]));

  async function toggle(n: Nurse, value: boolean) {
    setError(null);
    try {
      await setOnShift(n.id, value);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update the nurse.");
    }
    onChanged();
  }

  const columns: DataTableColumn<Nurse>[] = [
    { key: "name", header: "Nurse", sortable: false, primary: true, width: "minmax(0,1.2fr)" },
    {
      key: "specialties",
      header: "Specialties",
      sortable: false,
      width: "minmax(0,2fr)",
      accessor: (n) => n.specialties.map((s) => specLabel[s] ?? s).join(" "),
      cell: (n) => (
        <div className="flex flex-wrap gap-1">
          {n.specialties.map((s) => (
            <Badge key={s} variant="outline">
              {specLabel[s] ?? s}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "onShift",
      header: "On shift",
      sortable: false,
      width: "110px",
      cell: (n) => <StretchSwitch checked={n.onShift} onChange={(v) => toggle(n, v)} />,
    },
    {
      key: "workload",
      header: "Workload",
      sortable: false,
      width: "minmax(0,1.2fr)",
      cell: (n) => {
        const pct = Math.min(100, (n.workload / limit) * 100);
        return (
          <div className="w-[160px]">
            <div className="mb-1 text-xs tabular-nums text-slate-600">
              {n.workload} / {limit}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${n.workload >= limit ? "bg-amber-500" : "bg-slate-400"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: "activeTaskCount",
      header: "Active tasks",
      sortable: false,
      width: "110px",
    },
  ];

  return (
    <div>
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      <DataTable
        rows={board.nurses}
        columns={columns}
        selectable={false}
        searchable={false}
        pageSize={Infinity}
        maxHeight={4000}
        minWidth={720}
        ariaLabel="Nurses"
        getRowLabel={(n) => n.name}
      />
    </div>
  );
}
