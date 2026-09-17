import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  dir = path.join(root, ".local"),
  pidFile = path.join(dir, "stack.json"),
  entry = path.join(root, "scripts/local-stack.mjs");
const action = process.argv[2] ?? "status";
const flags = process.argv.slice(3);
if (
  flags.some((flag) => flag !== "--dev") ||
  (flags.length && action !== "start")
) {
  console.error("Use start [--dev], stop, or status.");
  process.exit(1);
}
function ownedProcess() {
  try {
    const r = JSON.parse(readFileSync(pidFile, "utf8"));
    if (r.root !== root) return null;
    const command = execFileSync(
      "ps",
      ["-p", String(r.pid), "-o", "command="],
      { encoding: "utf8" },
    );
    return command.includes(entry) ? r : null;
  } catch {
    return null;
  }
}
const record = ownedProcess();
if (action === "start") {
  if (record) {
    console.log(
      `Investor Desk is already running (${record.runtime ?? "development"}). http://127.0.0.1:3000`,
    );
    console.log(
      "The running site was left intact. Save any guest work before stopping to change its runtime.",
    );
    process.exit(0);
  }
  mkdirSync(dir, { recursive: true });
  const log = openSync(path.join(dir, "stack.log"), "a");
  const child = spawn(process.execPath, [entry, ...flags], {
    cwd: root,
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
  closeSync(log);
  console.log(
    `Starting Investor Desk in the background (${flags.includes("--dev") ? "development" : "optimized production build"}).`,
  );
  console.log("URL: http://127.0.0.1:3000");
  console.log("Logs: .local/stack.log");
  console.log("Check readiness: npm run local:status");
} else if (action === "stop") {
  if (!record) {
    console.log("No Investor Desk managed process is running.");
    process.exit(0);
  }
  process.kill(record.pid, "SIGTERM");
  console.log(
    "Graceful shutdown requested. Saved portfolio data is preserved; temporary guest work is not.",
  );
  const deadline = Date.now() + 20000;
  while (ownedProcess()?.pid === record.pid && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 200));
  if (ownedProcess()?.pid === record.pid) {
    console.error(
      "Shutdown is still in progress. Wait before starting again; no process was force-killed.",
    );
    process.exitCode = 1;
  } else console.log("Investor Desk stopped.");
} else if (action === "status") {
  console.log(
    record
      ? `Managed stack: running (PID ${record.pid}, ${record.runtime ?? "development"})`
      : "Managed stack: stopped",
  );
  try {
    const r = await fetch("http://127.0.0.1:3000/api/health", {
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    console.log(
      `Website: ${d.status}; database: ${d.checks?.database}; data mode: ${d.mode}`,
    );
    if (!r.ok) process.exitCode = 1;
  } catch {
    console.log("Website: not ready. Inspect .local/stack.log.");
    process.exitCode = 1;
  }
} else {
  console.error("Use start, stop, or status");
  process.exitCode = 1;
}
