import { useState } from "react";
import { ApiError, resetDemo, setDemoMode, type DemoMode } from "../api";
import { DEMO_MODES, DEMO_MODE_LABEL } from "../labels";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { UnfoldAccordion } from "./ui/unfold-accordion";

interface Props {
  nextMode: DemoMode | null;
  onChanged: () => void;
}

function HowItWorks() {
  return (
    <ul className="list-disc space-y-1.5 pl-4 text-slate-600">
      <li>
        Auto-assign picks the on-shift nurse with the right specialty and the lowest workload, skipping anyone who
        would go over 12.
      </li>
      <li>
        A request normally answers in 5–20 seconds. Some never answer, and there is no way to tell which. A task is
        flagged &ldquo;Taking too long&rdquo; after 25 s if urgent, 30 s if routine.
      </li>
      <li>
        Each request has its own ID. If you retry, assign by hand or cancel, the old request&rsquo;s answer is ignored
        when it arrives, and the history says so.
      </li>
      <li>A task has at most one nurse. Hand assignment goes straight to Accepted.</li>
      <li>
        If a nurse declines, doesn&rsquo;t answer an offer within 60 s, or is called away, the task waits in Needs
        attention for you to decide.
      </li>
      <li>
        If the server restarts, requests in flight are lost; those tasks show &ldquo;Interrupted by restart&rdquo;.
      </li>
    </ul>
  );
}

export function DemoControls({ nextMode, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function reset() {
    if (!window.confirm("Reset the demo? All care tasks and history will be replaced with the starting data.")) return;
    void run(resetDemo);
  }

  const demo = (
    <div className="space-y-3">
      <p className="text-slate-500">
        Shape what the auto-assign system does with the next request, to rehearse the stuck and late-answer cases.
      </p>
      <div className="flex flex-wrap gap-2">
        {DEMO_MODES.map((m) => (
          <Button
            key={m.mode}
            size="sm"
            variant={nextMode === m.mode ? "primary" : "outline"}
            disabled={busy}
            onClick={() => run(() => setDemoMode(m.mode))}
          >
            {m.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-500">Armed for the next request:</span>
        <Badge tone={nextMode ? "warning" : "neutral"} variant={nextMode ? "soft" : "outline"}>
          {nextMode ? DEMO_MODE_LABEL[nextMode] : "Nothing armed"}
        </Badge>
        <Button size="sm" variant="ghost" disabled={busy || !nextMode} onClick={() => run(() => setDemoMode(null))}>
          Clear
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="outline" disabled={busy} onClick={reset}>
          Reset demo data
        </Button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );

  return (
    <UnfoldAccordion
      allowMultiple
      items={[
        {
          id: "demo",
          title: "Demo controls",
          subtitle: nextMode ? `Armed: ${DEMO_MODE_LABEL[nextMode]}` : "Force what the next auto-assign request does",
          content: demo,
        },
        { id: "how", title: "How assignment works", content: <HowItWorks /> },
      ]}
    />
  );
}
