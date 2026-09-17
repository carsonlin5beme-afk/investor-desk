import { spawn } from "node:child_process";
import {
  existsSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--dev"))
  throw new Error(
    "Use --dev for hot reload, or no flags for the optimized site.",
  );
const development = args.includes("--dev");
const runtime = development ? "development" : "production";
process.chdir(root);
if (!existsSync(".env")) copyFileSync(".env.example", ".env");
await import("./auth-secret.mjs");
process.loadEnvFile(".env");
const url = new URL(
  process.env.DATABASE_URL ??
    "postgresql://investor:investor@localhost:5432/investor_desk",
);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/investor_desk" ||
  url.username !== "investor" ||
  url.password !== "investor" ||
  Number(url.port || 5432) !== 5432
)
  throw new Error(
    "The embedded launcher only manages the default local investor_desk database. For a custom DATABASE_URL, start your own Postgres, run migrations, then npm run dev.",
  );
const pidFile = path.join(root, ".local", "stack.json");
mkdirSync(path.dirname(pidFile), { recursive: true });
const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
    s.setTimeout(1500, () => {
      s.destroy();
      resolve(false);
    });
  });
let web,
  databaseStartup,
  started = false,
  stopping = false;
const pg = new EmbeddedPostgres({
  databaseDir: path.join(root, ".local", "postgres"),
  user: "investor",
  password: "investor",
  port: 5432,
  persistent: true,
  postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
  onLog: (m) => {
    if (/ready to accept|shutdown|FATAL/i.test(String(m)))
      console.log("[postgres]", m);
  },
  onError: (m) => console.error("[postgres]", m),
});
const run = (entry, args, environment = process.env) =>
  new Promise((resolve, reject) => {
    if (stopping) return reject(new Error("Startup canceled during shutdown."));
    const p = spawn(process.execPath, [path.join(root, entry), ...args], {
      cwd: root,
      stdio: "inherit",
      env: environment,
    });
    web = p;
    p.once("error", reject);
    p.once("exit", (code) => {
      if (stopping) reject(new Error("Startup canceled during shutdown."));
      else if (code === 0) resolve();
      else reject(new Error(`${entry} exited ${code}`));
    });
  });
const running = (child) =>
  child &&
  child.pid != null &&
  child.exitCode === null &&
  child.signalCode === null;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  const child = web;
  if (running(child)) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const force = setTimeout(() => {
      if (running(child)) child.kill("SIGKILL");
    }, 5000);
    await exited;
    clearTimeout(force);
  }
  await databaseStartup?.catch(() => {});
  if (started) await pg.stop().catch(console.error);
  try {
    const record = JSON.parse(readFileSync(pidFile, "utf8"));
    if (record.pid === process.pid) unlinkSync(pidFile);
  } catch {}
  process.exit(code);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
try {
  if ((await portOpen(3000)) || (await portOpen(5432)))
    throw new Error(
      "Port 3000 or 5432 is already in use. No existing process was stopped. Check npm run local:status, or use Docker Postgres with npm run dev.",
    );
  writeFileSync(
    pidFile,
    JSON.stringify({
      pid: process.pid,
      root,
      runtime,
      startedAt: new Date().toISOString(),
    }),
  );
  databaseStartup = (async () => {
    const version = path.join(root, ".local", "postgres", "PG_VERSION");
    if (existsSync(version)) {
      if (readFileSync(version, "utf8").trim() !== "18")
        throw new Error(
          "Existing database is not Postgres 18. Back up and migrate it before using this launcher.",
        );
    } else await pg.initialise();
    if (stopping) throw new Error("Startup canceled during shutdown.");
    await pg.start();
    started = true;
  })();
  await databaseStartup;
  if (stopping) throw new Error("Startup canceled during shutdown.");
  const client = pg.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  const check = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = 'investor_desk'",
  );
  if (!check.rows.length) await client.query("CREATE DATABASE investor_desk");
  await client.end();
  await run("node_modules/prisma/build/index.js", ["generate"]);
  await run("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
  if (!development) {
    console.log(
      "Preparing the optimized website. Pages will be compiled before visitors open them.",
    );
    await run("node_modules/next/dist/bin/next", ["build"], {
      ...process.env,
      NODE_ENV: "production",
    });
  }
  if (stopping) throw new Error("Startup canceled during shutdown.");
  console.log(`Starting Investor Desk (${runtime}) at http://127.0.0.1:3000`);
  web = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/next/dist/bin/next"),
      development ? "dev" : "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: runtime },
    },
  );
  web.once("error", (e) => {
    console.error(e);
    void shutdown(1);
  });
  web.once("exit", (code) => {
    if (!stopping) void shutdown(code ?? 1);
  });
} catch (e) {
  console.error(e);
  await shutdown(1);
}
