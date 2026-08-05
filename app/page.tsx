"use client";

import { useEffect, useMemo, useState } from "react";

type Task = {
  id: string;
  label: string;
  detail: string;
  command?: string;
  status: "done" | "ready" | "blocked";
};

const steps = [
  { number: "01", name: "Get access", meta: "4 / 4 complete" },
  { number: "02", name: "Run locally", meta: "2 / 4 complete" },
  { number: "03", name: "Know the system", meta: "Up next" },
  { number: "04", name: "Make a change", meta: "Locked" },
  { number: "05", name: "Ship first MR", meta: "Locked" },
];

const initialTasks: Task[] = [
  {
    id: "runtime",
    label: "Runtime is ready",
    detail: "Node 22.13.0 detected — matches .nvmrc",
    status: "done",
  },
  {
    id: "dependencies",
    label: "Dependencies installed",
    detail: "1,284 packages verified, no critical issues",
    command: "pnpm install",
    status: "done",
  },
  {
    id: "secrets",
    label: "Development secrets",
    detail: "Connect 3 missing values from 1Password",
    command: "dayone secrets pull",
    status: "ready",
  },
  {
    id: "database",
    label: "Local database",
    detail: "Docker daemon is not responding",
    command: "open -a Docker",
    status: "blocked",
  },
];

const guideMessages: Record<string, string> = {
  Docker:
    "Docker Desktop is installed, but its daemon is asleep. Open Docker, wait for the whale icon to settle, then rerun the check. Your local database will be created automatically.",
  architecture:
    "This request enters through Gateway, gets authorized by Identity, then reaches Projects API. Jobs that take longer than 500ms move to the Worker queue.",
  mentor:
    "Ask Maya Chen in #team-platform. She owns local infrastructure and usually responds within the team's core hours.",
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [checking, setChecking] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const [message, setMessage] = useState(guideMessages.Docker);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("dayone-tasks");
    const restore = window.setTimeout(() => {
      if (saved) setTasks(JSON.parse(saved));
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("dayone-tasks", JSON.stringify(tasks));
  }, [tasks]);

  const complete = useMemo(
    () => tasks.filter((task) => task.status === "done").length,
    [tasks],
  );

  function runCheck() {
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      setToast("System check complete — 1 blocker needs attention");
      setTimeout(() => setToast(""), 3200);
    }, 1200);
  }

  function resolveTask(id: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, status: "done" as const } : task,
      ),
    );
    setToast("Nice — your journey has been updated");
    setTimeout(() => setToast(""), 2800);
  }

  function askGuide(topic: keyof typeof guideMessages) {
    setGuideOpen(true);
    setMessage(guideMessages[topic]);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="DayOne home">
          <span className="brand-mark">D1</span>
          <span>DayOne</span>
        </a>

        <div className="person-card">
          <div className="avatar" aria-hidden="true">IK</div>
          <div>
            <strong>Ian Kim</strong>
            <span>Frontend Engineer</span>
          </div>
          <button aria-label="Open account menu">•••</button>
        </div>

        <nav className="journey" aria-label="Your onboarding journey">
          <p className="eyebrow">YOUR JOURNEY</p>
          {steps.map((step, index) => (
            <button
              key={step.number}
              className={`journey-step ${index === 1 ? "active" : ""} ${index === 0 ? "complete" : ""}`}
              onClick={() => index === 2 && askGuide("architecture")}
            >
              <span className="step-number">{index === 0 ? "✓" : step.number}</span>
              <span className="step-copy">
                <strong>{step.name}</strong>
                <small>{index === 1 ? `${complete} / 4 complete` : step.meta}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="help-link" onClick={() => askGuide("mentor")}>
            <span>?</span> Get human help
          </button>
          <p>DAY 1 · 9:42 AM</p>
        </div>
      </aside>

      <section className="workspace" id="top">
        <header className="topbar">
          <div className="breadcrumb"><span>Orbit</span> / Platform / dayone-web</div>
          <div className="top-actions">
            <span className="synced"><i /> All systems synced</span>
            <button className="icon-button" aria-label="Notifications">●</button>
            <button className="guide-toggle" onClick={() => setGuideOpen((open) => !open)}>
              <span>✦</span> Guide
            </button>
          </div>
        </header>

        <div className="content">
          <div className="welcome-row">
            <div>
              <p className="eyebrow accent">STEP 02 · RUN LOCALLY</p>
              <h1>Let&apos;s bring the repo to life.</h1>
              <p>DayOne checked your machine against what this project actually needs.</p>
            </div>
            <div className="progress-ring" style={{ "--progress": `${complete * 25 * 3.6}deg` } as React.CSSProperties}>
              <div><strong>{complete}/4</strong><span>ready</span></div>
            </div>
          </div>

          <section className="doctor-card">
            <div className="card-heading">
              <div className={`pulse-icon ${checking ? "checking" : ""}`}><span>⌁</span></div>
              <div>
                <h2>Environment doctor</h2>
                <p>Verified against <code>dayone-web</code> · main</p>
              </div>
              <button className="secondary-button" onClick={runCheck} disabled={checking}>
                {checking ? "Checking…" : "↻ Run check"}
              </button>
            </div>

            <div className="task-list">
              {tasks.map((task) => (
                <article className={`task-row ${task.status}`} key={task.id}>
                  <div className="status-icon" aria-label={task.status}>
                    {task.status === "done" ? "✓" : task.status === "blocked" ? "!" : "→"}
                  </div>
                  <div className="task-copy">
                    <strong>{task.label}</strong>
                    <span>{task.detail}</span>
                  </div>
                  {task.command && <code className="command">{task.command}</code>}
                  {task.status !== "done" && (
                    <button
                      className={task.status === "blocked" ? "fix-button" : "text-button"}
                      onClick={() => task.status === "blocked" ? askGuide("Docker") : resolveTask(task.id)}
                    >
                      {task.status === "blocked" ? "Fix with guide" : "Mark ready"}
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>

          <div className="lower-grid">
            <section className="next-card">
              <div className="eyebrow">WHEN YOU&apos;RE READY</div>
              <h2>See your first request flow</h2>
              <p>Follow one user action through the services you&apos;ll work with.</p>
              <div className="service-map" aria-label="Request flow architecture diagram">
                <div><span>WEB</span><strong>↗</strong></div>
                <i>→</i>
                <div><span>GATEWAY</span><strong>⌘</strong></div>
                <i>→</i>
                <div><span>PROJECTS API</span><strong>◇</strong></div>
              </div>
              <button className="primary-button" onClick={() => askGuide("architecture")}>Explore architecture <span>→</span></button>
            </section>

            <aside className="context-card">
              <div className="eyebrow">YOUR CONTEXT</div>
              <dl>
                <div><dt>Team</dt><dd>Platform</dd></div>
                <div><dt>Buddy</dt><dd><span className="tiny-avatar">MC</span> Maya Chen</dd></div>
                <div><dt>Target</dt><dd>First MR by Friday</dd></div>
              </dl>
              <button onClick={() => askGuide("mentor")}>View onboarding plan ↗</button>
            </aside>
          </div>
        </div>
      </section>

      {guideOpen && (
        <aside className="guide-panel">
          <div className="guide-header">
            <div><span className="guide-star">✦</span><strong>DayOne Guide</strong></div>
            <button onClick={() => setGuideOpen(false)} aria-label="Close guide">×</button>
          </div>
          <div className="guide-body">
            <div className="guide-intro">
              <span className="guide-orb">✦</span>
              <div>
                <p>{message}</p>
                <small>Based on this repo&apos;s setup guide and 12 successful local setups.</small>
              </div>
            </div>

            <div className="guide-command">
              <div><i /><i /><i /></div>
              <code>open -a Docker</code>
              <button onClick={() => { navigator.clipboard?.writeText("open -a Docker"); setToast("Command copied"); }}>Copy</button>
            </div>

            <button className="resolved-button" onClick={() => resolveTask("database")}>I&apos;ve opened Docker <span>→</span></button>

            <div className="guide-divider"><span>OR ASK ABOUT</span></div>
            <div className="suggestions">
              <button onClick={() => askGuide("architecture")}>How does this repo fit the system?</button>
              <button onClick={() => askGuide("mentor")}>Who can help if I&apos;m still stuck?</button>
              <button onClick={() => setMessage("Your first safe change is a copy update in the empty state. It touches one component, has an existing test, and ships behind a flag.")}>What will my first MR be?</button>
            </div>
          </div>
          <form className="ask-box" onSubmit={(event) => { event.preventDefault(); setMessage("I found the most relevant answer in this repository's runbook. Try the suggested command first; I’ll keep your buddy in the loop if it fails again."); }}>
            <input aria-label="Ask the DayOne guide" placeholder="Ask about this step…" />
            <button aria-label="Send question">↑</button>
          </form>
          <p className="guide-note">Answers include their source · DayOne never runs commands without you.</p>
        </aside>
      )}

      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}
