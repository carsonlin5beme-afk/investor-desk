import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
import { hostedStartConfig, startHosted } from "../../scripts/hosted-start.mjs";

const environment = () => ({
  NODE_ENV: "production" as const,
  BETTER_AUTH_URL: "https://desk.example.com",
  BETTER_AUTH_SECRET: "test-only-hosted-secret-with-at-least-32-characters",
  DATABASE_URL: "postgresql://fixture:fixture@db.example.com/fresh_demo",
  PORT: "10000",
});
afterEach(() => vi.clearAllMocks());

it("uses the platform PORT and the explicit hosted listener", () => {
  expect(hostedStartConfig(environment())).toEqual({
    hostname: "0.0.0.0",
    port: "10000",
  });
});

it.each([
  ["BETTER_AUTH_URL", undefined],
  ["BETTER_AUTH_URL", "http://127.0.0.1:3000"],
  ["BETTER_AUTH_URL", "http://desk.example.com"],
  ["BETTER_AUTH_URL", "https://*.example.com"],
  ["PORT", undefined],
  ["PORT", "0"],
  ["PORT", "65536"],
  ["PORT", "10000;echo unsafe"],
  ["BETTER_AUTH_SECRET", undefined],
  ["BETTER_AUTH_SECRET", "short"],
  ["DATABASE_URL", undefined],
  ["DATABASE_URL", "file:local.sqlite"],
  ["DATABASE_URL", "postgresql://"],
  ["DATABASE_URL", "postgresql://db.example.com"],
  ["BETTER_AUTH_TRUSTED_ORIGINS", "https://*.example.com"],
])("fails before spawning when %s is invalid", (key, value) => {
  expect(() => startHosted({ ...environment(), [key]: value })).toThrow();
  expect(spawn).not.toHaveBeenCalled();
});

it("starts one Next process without a shell and forwards shutdown", () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  spawn.mockReturnValue(child);
  const oldListeners = process.listeners("SIGTERM");
  const previousExitCode = process.exitCode;
  try {
    const env = environment();
    startHosted(env);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      process.execPath,
      [
        expect.stringContaining("next/dist/bin/next"),
        "start",
        "--hostname",
        "0.0.0.0",
        "--port",
        "10000",
      ],
      { stdio: "inherit", env },
    );
    const listener = process
      .listeners("SIGTERM")
      .find((item) => !oldListeners.includes(item));
    expect(listener).toBeDefined();
    listener?.("SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("exit", 7, null);
    expect(process.exitCode).toBe(7);
    expect(process.listeners("SIGTERM")).toEqual(oldListeners);
  } finally {
    child.emit("exit", 0, null);
    process.exitCode = previousExitCode;
  }
});
