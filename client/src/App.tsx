import { useCallback, useEffect, useRef, useState } from "react";
import { getBoard, usingFixture, type Board } from "./api";
import { DemoControls } from "./components/DemoControls";
import { NewTaskForm } from "./components/NewTaskForm";
import { NursesTable } from "./components/NursesTable";
import { TaskTable } from "./components/TaskTable";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";

type Tab = "tasks" | "nurses";

export default function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("tasks");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // serverNow - Date.now(), refreshed on every fetch; live timers use Date.now() + offset.
  const offset = useRef(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const b = await getBoard();
      offset.current = b.serverNow - Date.now();
      setBoard(b);
      setNow(Date.now() + offset.current);
      setConnError(null);
    } catch (e) {
      setConnError(e instanceof Error ? e.message : "Cannot reach the server.");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 1500);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset.current), 500);
    return () => clearInterval(id);
  }, []);

  const count = (s: string) => board?.tasks.filter((t) => t.status === s).length ?? 0;
  const counts = [
    { label: "Needs attention", n: count("needs_attention"), cls: "bg-red-50 text-red-700" },
    { label: "Finding a nurse", n: count("finding"), cls: "bg-sky-50 text-sky-700" },
    { label: "Offered", n: count("offered"), cls: "bg-indigo-50 text-indigo-700" },
    { label: "Accepted", n: count("accepted"), cls: "bg-emerald-50 text-emerald-700" },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-base font-semibold text-slate-900">Care task board</h1>
            <p className="text-xs text-slate-500">Head nurse view &middot; all data is fake</p>
          </div>
          {usingFixture && <Badge variant="outline">Fixture data</Badge>}
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
        {connError && (
          <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {connError} Retrying…
          </p>
        )}

        <nav className="flex gap-1 border-b border-slate-200" aria-label="Sections">
          {(["tasks", "nurses"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 pb-2 text-sm focus-ring ${
                tab === t
                  ? "border-slate-900 font-medium text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t === "tasks" ? "Tasks" : "Nurses"}
            </button>
          ))}
        </nav>

        {!board ? (
          <p className="py-16 text-center text-sm text-slate-400">{connError ? "Waiting for the server…" : "Loading…"}</p>
        ) : tab === "tasks" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {counts.map((c) => (
                  <div
                    key={c.label}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-2"
                  >
                    <span className="text-xs text-slate-600">{c.label}</span>
                    <Badge className={c.cls}>{c.n}</Badge>
                  </div>
                ))}
              </div>
              <Button size="sm" onClick={() => setShowForm(true)}>
                New care task
              </Button>
            </div>

            <TaskTable
              board={board}
              now={now}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
              onChanged={() => void refresh()}
            />

            <DemoControls nextMode={board.demo.nextMode} onChanged={() => void refresh()} />
          </>
        ) : (
          <NursesTable board={board} onChanged={() => void refresh()} />
        )}
      </main>

      {showForm && board && (
        <NewTaskForm
          patients={board.patients}
          specialties={board.specialties}
          onClose={() => setShowForm(false)}
          onCreated={() => void refresh()}
        />
      )}
    </div>
  );
}
