import { afterEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/server/api/schemas", () => ({ createPortfolioSchema: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/server/auth/access", () => ({ currentProfile: vi.fn() }));
vi.mock("@/server/providers/factory", () => ({}));
vi.mock("@/server/services/quote-service", () => ({}));
vi.mock("@/server/guest/portfolio", () => ({}));
import { guestCookie } from "@/server/guest/http";
import { GUEST_COOKIE } from "@/server/guest/store";
afterEach(() => vi.unstubAllEnvs());

it("keeps local HTTP session cookies usable without trusting forwarded HTTPS", () => {
  vi.stubEnv("BETTER_AUTH_URL", undefined);
  const response = guestCookie(
    NextResponse.json({}),
    "test-session",
    new Request("http://127.0.0.1:3000/api/portfolios", {
      headers: { "x-forwarded-proto": "https" },
    }),
  );
  expect(response.cookies.get(GUEST_COOKIE)).toMatchObject({
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  expect(response.headers.get("set-cookie")).not.toMatch(/; Secure/i);
  expect(response.headers.get("set-cookie")).not.toMatch(
    /Max-Age|Expires|Domain/i,
  );
});

it.each([false, true])(
  "sets Secure for hosted creation and clearing despite internal HTTP (clear=%s)",
  (clear) => {
    vi.stubEnv("BETTER_AUTH_URL", "https://desk.example.com");
    const response = guestCookie(
      NextResponse.json({}),
      clear ? "" : "test-session",
      new Request("http://127.0.0.1:10000/api/portfolios", {
        headers: { "x-forwarded-proto": "http" },
      }),
      clear,
    );
    expect(response.cookies.get(GUEST_COOKIE)).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      ...(clear ? { maxAge: 0 } : {}),
    });
    expect(response.headers.get("set-cookie")).toContain("Secure");
  },
);

it("retains secure cookies for a local HTTPS request", () => {
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  const response = guestCookie(
    NextResponse.json({}),
    "test-session",
    new Request("https://localhost:3000/api/portfolios"),
  );
  expect(response.cookies.get(GUEST_COOKIE)?.secure).toBe(true);
});

it("rejects invalid deployment configuration before setting a cookie", () => {
  vi.stubEnv("BETTER_AUTH_URL", "http://desk.example.com");
  const response = NextResponse.json({});
  expect(() =>
    guestCookie(
      response,
      "test-session",
      new Request("http://localhost/api/portfolios"),
    ),
  ).toThrow("Invalid BETTER_AUTH_URL");
  expect(response.headers.get("set-cookie")).toBeNull();
});
