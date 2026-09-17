import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const publicOrigin = "https://desk.example.com";
function request(method = "GET", headers: Record<string, string> = {}) {
  // A reverse proxy may pass an internal HTTP URL. It is never an authority.
  return new NextRequest("http://127.0.0.1:10000/api/portfolios", {
    method,
    headers,
  });
}
beforeEach(() => vi.stubEnv("BETTER_AUTH_URL", undefined));
afterEach(() => vi.unstubAllEnvs());

describe("API host and mutation boundary", () => {
  it.each(["localhost:3000", "127.0.0.1:3108", "[::1]:3000"])(
    "keeps loopback requests working: %s",
    (host) => {
      const response = middleware(
        request("POST", {
          host,
          origin: `http://${host}`,
          "content-type": "application/json; charset=utf-8",
        }),
      );
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("does not implicitly enable public access from platform or forwarded headers", () => {
    vi.stubEnv("VERCEL_URL", "desk.example.com");
    vi.stubEnv("NEXT_PUBLIC_BETTER_AUTH_URL", publicOrigin);
    const response = middleware(
      request("GET", {
        host: "desk.example.com",
        "x-forwarded-host": "localhost:3000",
        "x-forwarded-proto": "https",
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("allows the exact public host and HTTPS mutation origin behind internal HTTP", () => {
    vi.stubEnv("BETTER_AUTH_URL", `${publicOrigin}/`);
    const response = middleware(
      request("POST", {
        host: "DESK.example.com",
        origin: publicOrigin,
        "content-type": "application/json",
        "x-forwarded-host": "untrusted.example.com",
        "x-forwarded-proto": "http",
      }),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    "",
    "localhost:10000",
    "evil.example.com",
    "desk.example.com.evil.test",
    "desk.example.com:8443",
    "desk.example.com,evil.example.com",
    "desk.example.com.",
  ])("rejects an unconfigured public Host: %s", (host) => {
    vi.stubEnv("BETTER_AUTH_URL", publicOrigin);
    expect(
      middleware(
        request("GET", {
          host,
          "x-forwarded-host": "desk.example.com",
          forwarded: "host=desk.example.com;proto=https",
        }),
      ).status,
    ).toBe(403);
  });

  it.each([
    "",
    "null",
    "http://desk.example.com",
    "https://evil.example.com",
    "https://desk.example.com:8443",
    `${publicOrigin}/`,
    `${publicOrigin},https://evil.example.com`,
  ])("rejects a foreign/missing mutation Origin: %s", (origin) => {
    vi.stubEnv("BETTER_AUTH_URL", publicOrigin);
    const headers = {
      host: "desk.example.com",
      origin,
      "content-type": "application/json",
    };
    expect(middleware(request("POST", headers)).status).toBe(403);
    expect(middleware(request("DELETE", headers)).status).toBe(403);
  });

  it("preserves local same-host enforcement and configured public ports", () => {
    expect(
      middleware(
        request("POST", {
          host: "127.0.0.1:3000",
          origin: "http://localhost:3000",
          "content-type": "application/json",
        }),
      ).status,
    ).toBe(403);
    vi.stubEnv("BETTER_AUTH_URL", "https://desk.example.com:8443");
    expect(
      middleware(
        request("PATCH", {
          host: "desk.example.com:8443",
          origin: "https://desk.example.com:8443",
          "content-type": "Application/JSON; charset=utf-8",
        }),
      ).headers.get("x-middleware-next"),
    ).toBe("1");
  });

  it.each([
    "",
    "text/plain",
    "application/jsonp",
    "application/json-anything",
    "application/x-www-form-urlencoded",
  ])("requires a JSON media type for body mutations: %s", (type) => {
    vi.stubEnv("BETTER_AUTH_URL", publicOrigin);
    expect(
      middleware(
        request("PATCH", {
          host: "desk.example.com",
          origin: publicOrigin,
          "content-type": type,
        }),
      ).status,
    ).toBe(415);
  });

  it("allows bodyless same-origin DELETE and safe reads without adding CORS", () => {
    vi.stubEnv("BETTER_AUTH_URL", publicOrigin);
    for (const method of ["GET", "HEAD", "OPTIONS", "DELETE"]) {
      const response = middleware(
        request(method, {
          host: "desk.example.com",
          ...(method === "DELETE" ? { origin: publicOrigin } : {}),
        }),
      );
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("fails closed without echoing unsafe configured values", async () => {
    vi.stubEnv(
      "BETTER_AUTH_URL",
      "https://private-user:private-password@desk.example.com",
    );
    for (const host of ["localhost:3000", "desk.example.com"]) {
      const response = middleware(request("GET", { host }));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain("private-password");
    }
  });
});
