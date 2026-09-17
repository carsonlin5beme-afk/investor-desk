import { afterEach, beforeEach, expect, it, vi } from "vitest";
const factory = vi.hoisted(() => vi.fn((options) => options));
vi.mock("better-auth/minimal", () => ({ betterAuth: factory }));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: () => ({}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
beforeEach(() => {
  vi.resetModules();
  factory.mockClear();
  vi.stubEnv("BETTER_AUTH_URL", undefined);
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", undefined);
});
afterEach(() => vi.unstubAllEnvs());

it("wires one public origin into auth without trusting proxy headers", async () => {
  vi.stubEnv("BETTER_AUTH_URL", "https://desk.example.com/");
  await import("@/lib/auth");
  expect(factory).toHaveBeenCalledWith(
    expect.objectContaining({
      baseURL: "https://desk.example.com",
      trustedOrigins: ["https://desk.example.com"],
      advanced: { trustedProxyHeaders: false },
    }),
  );
});

it("retains default local auth and derives aliases for another local port", async () => {
  await import("@/lib/auth");
  expect(factory.mock.calls[0][0].trustedOrigins).toEqual([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
  ]);
  vi.resetModules();
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3108");
  await import("@/lib/auth");
  expect(factory.mock.calls[1][0].trustedOrigins).toEqual([
    "http://localhost:3108",
    "http://127.0.0.1:3108",
  ]);
});

it("rejects invalid origins before constructing auth", async () => {
  vi.stubEnv("BETTER_AUTH_URL", "http://desk.example.com");
  await expect(import("@/lib/auth")).rejects.toThrow("Invalid BETTER_AUTH_URL");
  expect(factory).not.toHaveBeenCalled();
});

it("prevents the library's alternate environment allowlist from expanding trust", async () => {
  vi.stubEnv("BETTER_AUTH_URL", "https://desk.example.com");
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "https://*.example.com");
  await expect(import("@/lib/auth")).rejects.toThrow(
    "Configure trusted origins only through BETTER_AUTH_URL",
  );
  expect(factory).not.toHaveBeenCalled();
});
