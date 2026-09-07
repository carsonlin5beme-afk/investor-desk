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
    console.log("Investor Desk is already running. http://localhost:3000");
    process.exit(0);
  }
  mkdirSync(dir, { recursive: true });
  const log = openSync(path.join(dir, "stack.log"), "a");
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
  closeSync(log);
  console.log("Starting Investor Desk in the background.");
  console.log("URL: http://localhost:3000");
  console.log("Logs: .local/stack.log");
  console.log("Check readiness: npm run local:status");
} else if (action === "stop") {
  if (!record) {
    console.log("No Investor Desk managed process is running.");
    process.exit(0);
  }
  process.kill(record.pid, "SIGTERM");
  console.log("Graceful shutdown requested. Portfolio data is preserved.");
} else if (action === "status") {
  console.log(
    record
      ? `Managed stack: running (PID ${record.pid})`
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
