import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  guest: vi.fn(),
  profile: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/server/guest/http", () => ({ guestResponse: mocks.guest }));
vi.mock("@/server/auth/access", () => ({
  currentProfile: mocks.profile,
  signInRequired: () => new Response(null, { status: 401 }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { portfolio: { findFirst: mocks.find, updateMany: mocks.update } },
}));

import { GET, PATCH } from "@/app/api/portfolios/[id]/margin/route";
import { middleware } from "@/middleware";
import type { MarginSettings } from "@/lib/margin";

const terms: MarginSettings = {
  debt: 10000.01,
  aprPercent: 12.75,
  maintenancePercent: 30,
  dayCountBasis: 365,
};
const params = { params: Promise.resolve({ id: "p1" }) };
const request = (method: "GET" | "PATCH", raw?: string) =>
  new Request("http://127.0.0.1:3000/api/portfolios/p1/margin", {
    method,
    headers: {
      Origin: "http://127.0.0.1:3000",
      "Content-Type": "application/json",
    },
    ...(method === "PATCH" ? { body: raw ?? JSON.stringify(terms) } : {}),
  });
const get = () => GET(request("GET"), params);
const patch = (body: unknown = terms) =>
  PATCH(request("PATCH", JSON.stringify(body)), params);
const rawPatch = (raw: string) => PATCH(request("PATCH", raw), params);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guest.mockResolvedValue(null);
  mocks.profile.mockResolvedValue({ id: "owner" });
  mocks.find.mockResolvedValue({
    id: "p1",
    marginDebt: new Prisma.Decimal(terms.debt),
    marginAprPercent: terms.aprPercent,
    marginMaintenancePercent: terms.maintenancePercent,
    marginDayCountBasis: terms.dayCountBasis,
  });
  mocks.update.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());

describe("saved portfolio margin ownership and settings", () => {
  it.each(["GET", "PATCH"] as const)(
    "delegates %s to the guest handler without touching profile storage",
    async (method) => {
      const input = request(method);
      const temporary = new Response("guest response", {
        status: 200,
        headers: { "x-guest-contract": "preserved" },
      });
      mocks.guest.mockResolvedValue(temporary);
      const response = await (method === "GET" ? GET : PATCH)(input, params);
      expect(response).toBe(temporary);
      expect(mocks.guest).toHaveBeenCalledWith(input);
      expect(mocks.profile).not.toHaveBeenCalled();
      expect(mocks.find).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "PATCH"] as const)(
    "requires sign-in for %s without an active guest",
    async (method) => {
      mocks.profile.mockResolvedValue(null);
      const response = await (method === "GET" ? get() : patch());
      expect(response.status).toBe(401);
      expect(mocks.find).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("loads all four terms using only the owning profile and margin select", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ portfolioId: "p1", margin: terms });
    expect(mocks.find).toHaveBeenCalledWith({
      where: { id: "p1", userId: "owner" },
      select: {
        id: true,
        marginDebt: true,
        marginAprPercent: true,
        marginMaintenancePercent: true,
        marginDayCountBasis: true,
      },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not expose another owner's terms through GET", async () => {
    mocks.find.mockResolvedValue(null);
    const response = await get();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Portfolio not found." });
    expect(mocks.find.mock.calls[0][0].where).toEqual({
      id: "p1",
      userId: "owner",
    });
  });

  it("checks ownership atomically and writes only liability assumptions", async () => {
    const response = await patch();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ portfolioId: "p1", margin: terms });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "p1", userId: "owner" },
      data: {
        marginDebt: new Prisma.Decimal("10000.01"),
        marginAprPercent: 12.75,
        marginMaintenancePercent: 30,
        marginDayCountBasis: 365,
      },
    });
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it("returns 404 when the atomic write finds no owned portfolio", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    const response = await patch();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Portfolio not found." });
    expect(mocks.update.mock.calls[0][0].where).toEqual({
      id: "p1",
      userId: "owner",
    });
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it.each([360, 365] as const)(
    "saves explicit zero debt and zero APR with a %s-day basis",
    async (dayCountBasis) => {
      const zero = {
        debt: 0,
        aprPercent: 0,
        maintenancePercent: 100,
        dayCountBasis,
      };
      const response = await patch(zero);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        portfolioId: "p1",
        margin: zero,
      });
      expect(mocks.update.mock.calls[0][0].data.marginDebt.toNumber()).toBe(0);
      expect(mocks.update.mock.calls[0][0].data.marginAprPercent).toBe(0);
    },
  );

  it("round-trips entered principal without silently accruing interest on reads", async () => {
    let stored = mocks.find.getMockImplementation();
    mocks.update.mockImplementation(async ({ data }) => {
      stored = async () => ({ id: "p1", ...data });
      return { count: 1 };
    });
    mocks.find.mockImplementation(() => stored?.());
    const entered = {
      ...terms,
      debt: 123456.78,
      aprPercent: 99.5,
      dayCountBasis: 360,
    };
    expect((await patch(entered)).status).toBe(200);
    for (let read = 0; read < 2; read++) {
      expect(await (await get()).json()).toEqual({
        portfolioId: "p1",
        margin: entered,
      });
    }
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});

describe("strict margin mutation input", () => {
  it.each([
    "debt",
    "aprPercent",
    "maintenancePercent",
    "dayCountBasis",
  ] as const)(
    "rejects omitted %s instead of defaulting an entered assumption",
    async (field) => {
      const incomplete: Partial<MarginSettings> = { ...terms };
      delete incomplete[field];
      expect((await patch(incomplete)).status).toBe(400);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["null", null],
    ["array", []],
    ["empty object", {}],
    ["blank debt", { ...terms, debt: "" }],
    ["blank APR", { ...terms, aprPercent: " " }],
    ["blank maintenance", { ...terms, maintenancePercent: "" }],
    ["blank day basis", { ...terms, dayCountBasis: "" }],
    ["numeric text", { ...terms, debt: "10000.01" }],
    ["negative debt", { ...terms, debt: -0.01 }],
    ["negative APR", { ...terms, aprPercent: -0.01 }],
    ["subcent debt", { ...terms, debt: 10000.001 }],
    ["overflow debt", { ...terms, debt: 1e12 + 0.01 }],
    ["maintenance below 25", { ...terms, maintenancePercent: 24.99 }],
    ["maintenance above 100", { ...terms, maintenancePercent: 100.01 }],
    ["unsupported day basis", { ...terms, dayCountBasis: 366 }],
    ["string day basis", { ...terms, dayCountBasis: "360" }],
    ["null APR", { ...terms, aprPercent: null }],
    ["unknown cash field", { ...terms, cashBalance: 999999 }],
    ["unknown owner field", { ...terms, userId: "other-owner" }],
  ])("rejects %s without writing anything", async (_name, body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(["debt", "aprPercent", "maintenancePercent", "dayCountBasis"])(
    "rejects a nonfinite JSON number for %s",
    async (field) => {
      const body = JSON.stringify({ ...terms, [field]: 0 }).replace(
        `"${field}":0`,
        `"${field}":1e309`,
      );
      expect((await rawPatch(body)).status).toBe(400);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it.each(["", "{", "null", "NaN"])(
    "returns 400 for empty or malformed JSON: %j",
    async (body) => {
      expect((await rawPatch(body)).status).toBe(400);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
});

describe("recoverable margin storage failures", () => {
  it.each(["GET", "PATCH"] as const)(
    "sanitizes a failed %s and permits a subsequent retry",
    async (method) => {
      const storage = method === "GET" ? mocks.find : mocks.update;
      storage.mockRejectedValueOnce(
        new Error("SECRET_DATABASE_URL private portfolio details"),
      );
      const invoke = method === "GET" ? get : patch;
      const failed = await invoke();
      expect(failed.status).toBe(500);
      const body = await failed.json();
      expect(body.error).toContain("Please try again");
      expect(JSON.stringify(body)).not.toMatch(
        /SECRET_DATABASE_URL|private portfolio|10000\.01/,
      );
      expect(body.margin).toBeUndefined();
      const retry = await invoke();
      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual({ portfolioId: "p1", margin: terms });
      expect(storage).toHaveBeenCalledTimes(2);
    },
  );

  it("fails safely when persisted terms are malformed", async () => {
    mocks.find.mockResolvedValue({
      id: "p1",
      marginDebt: new Prisma.Decimal(1),
      marginAprPercent: -1,
    });
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Unable to load margin settings. Please try again.",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

// Direct route calls do not run Next middleware. These checks establish the
// existing middleware contract for this path, not a browser/server E2E flow.
describe("margin PATCH matching-Origin middleware boundary", () => {
  it.each([
    undefined,
    "null",
    "https://foreign.example",
    "http://localhost:3000",
    "http://127.0.0.1:3001",
  ])("rejects missing or foreign local Origin: %s", (origin) => {
    vi.stubEnv("BETTER_AUTH_URL", undefined);
    const response = middleware(
      new NextRequest("http://127.0.0.1:3000/api/portfolios/p1/margin", {
        method: "PATCH",
        headers: {
          host: "127.0.0.1:3000",
          "content-type": "application/json",
          ...(origin ? { origin } : {}),
        },
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("allows the matching local Origin only with JSON", () => {
    vi.stubEnv("BETTER_AUTH_URL", undefined);
    for (const contentType of ["application/json", "text/plain"]) {
      const response = middleware(
        new NextRequest("http://127.0.0.1:3000/api/portfolios/p1/margin", {
          method: "PATCH",
          headers: {
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
            "content-type": contentType,
          },
        }),
      );
      expect(response.status).toBe(
        contentType === "application/json" ? 200 : 415,
      );
      expect(response.headers.get("x-middleware-next")).toBe(
        contentType === "application/json" ? "1" : null,
      );
    }
  });

  it("requires the configured public HTTPS Origin for a margin mutation", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://desk.example.com");
    for (const origin of [
      "https://desk.example.com",
      "http://desk.example.com",
    ]) {
      const response = middleware(
        new NextRequest("http://127.0.0.1:10000/api/portfolios/p1/margin", {
          method: "PATCH",
          headers: {
            host: "desk.example.com",
            origin,
            "content-type": "application/json",
          },
        }),
      );
      expect(response.status).toBe(origin.startsWith("https:") ? 200 : 403);
    }
  });
});
