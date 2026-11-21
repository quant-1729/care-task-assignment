import { useState } from "react";
import { ApiError, createTask, type Patient, type Priority, type Specialty } from "../api";
import { ACUITY_LABEL } from "../labels";
import { Button } from "./ui/button";

interface Props {
  patients: Patient[];
  specialties: Specialty[];
  onClose: () => void;
  onCreated: () => void;
}

const field =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400";

export function NewTaskForm({ patients, specialties, onClose, onCreated }: Props) {
  const [patientId, setPatientId] = useState<number>(patients[0]?.id ?? 0);
  const [careNeeded, setCareNeeded] = useState("");
  const [specialty, setSpecialty] = useState(specialties[0]?.key ?? "");
  const [acuity, setAcuity] = useState(2);
  const [priority, setPriority] = useState<Priority>("routine");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!careNeeded.trim()) {
      setError("Please describe the care needed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createTask({ patientId, careNeeded: careNeeded.trim(), specialty, acuity, priority });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the task.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-24"
      onClick={onClose}
      role="presentation"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="New care task"
        className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 className="text-base font-semibold text-slate-900">New care task</h2>

        <label className="block space-y-1">
          <span className="text-xs text-slate-500">Patient</span>
          <select className={field} value={patientId} onChange={(e) => setPatientId(Number(e.target.value))}>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                Bed {p.bed} · {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-slate-500">Care needed</span>
          <input
            className={field}
            value={careNeeded}
            onChange={(e) => setCareNeeded(e.target.value)}
            placeholder="e.g. Post-surgery wound dressing"
            autoFocus
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs text-slate-500">Specialty</span>
            <select className={field} value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
              {specialties.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-slate-500">Acuity</span>
            <select className={field} value={acuity} onChange={(e) => setAcuity(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} · {ACUITY_LABEL[n].toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="space-y-1">
          <legend className="text-xs text-slate-500">Priority</legend>
          <div className="flex gap-2">
            {(["routine", "urgent"] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={priority === p}
                onClick={() => setPriority(p)}
                className={`h-9 flex-1 rounded-lg border text-sm capitalize ${
                  priority === p
                    ? p === "urgent"
                      ? "border-red-300 bg-red-50 text-red-700"
                      : "border-slate-400 bg-slate-100 text-slate-900"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </fieldset>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" isLoading={busy}>
            Create and send for auto-assign
          </Button>
        </div>
      </form>
    </div>
  );
}
