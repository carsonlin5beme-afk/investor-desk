import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { deploymentOrigin, validPort } from "../src/lib/deployment-origin.mjs";

export function hostedStartConfig(env) {
  if (!env.BETTER_AUTH_URL || deploymentOrigin(env.BETTER_AUTH_URL).local)
    throw new Error(
      "Hosted start requires an explicit public HTTPS BETTER_AUTH_URL.",
    );
  if (env.BETTER_AUTH_TRUSTED_ORIGINS)
    throw new Error("Configure trusted origins only through BETTER_AUTH_URL.");
  if (!validPort(env.PORT))
    throw new Error("Hosted start requires PORT between 1 and 65535.");
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.trim().length < 32)
    throw new Error(
      "Hosted start requires a private BETTER_AUTH_SECRET of at least 32 characters.",
    );
  let database;
  try {
    database = new URL(env.DATABASE_URL);
  } catch {}
  if (
    !database ||
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !database.hostname ||
    database.pathname.length < 2
  )
    throw new Error(
      "Hosted start requires an explicit PostgreSQL DATABASE_URL.",
    );
  return { hostname: "0.0.0.0", port: String(Number(env.PORT)) };
}

export function startHosted(env = process.env) {
  // Required values must be supplied by the platform. This launcher never
  // creates/loads .env, generates secrets, starts Postgres or runs migrations.
  const { hostname, port } = hostedStartConfig(env);
  const require = createRequire(import.meta.url);
  const child = spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      "start",
      "--hostname",
      hostname,
      "--port",
      port,
    ],
    { stdio: "inherit", env },
  );
  const forward = (signal) => child.kill(signal);
  const sigint = () => forward("SIGINT");
  const sigterm = () => forward("SIGTERM");
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  child.once("error", () => {
    console.error("Hosted server could not start.");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
    process.exitCode =
      code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  });
  return child;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    startHosted();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Invalid hosted configuration.",
    );
    process.exitCode = 1;
  }
}
