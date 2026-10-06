import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  guestIdentity: vi.fn(),
  guestCookie: vi.fn(),
  db: {
    workspaceEntry: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      deleteMany: vi.fn(),
    },
    guestImport: { findUnique: vi.fn(), create: vi.fn() },
    portfolio: { create: vi.fn() },
    position: { create: vi.fn() },
    optionPositionDetails: { create: vi.fn() },
    targetScenario: { create: vi.fn() },
    cashLedgerEntry: { createMany: vi.fn() },
    order: { create: vi.fn() },
    fill: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/server/auth/access", () => ({ currentProfile: mocks.profile }));
vi.mock("@/server/guest/http", () => ({
  guestIdentity: mocks.guestIdentity,
  guestCookie: mocks.guestCookie,
}));
vi.mock("@/server/services/order-service", () => ({
  resolveTicket: vi.fn(),
  assertExecutionCurrent: vi.fn(),
}));
vi.mock("@/server/services/quote-service", () => ({
  getLiveQuote: vi.fn(async () => null),
  quoteMark: () => null,
}));
vi.mock("@/server/providers/factory", () => ({
  isDemo: true,
  equitiesConfigured: () => true,
  equityFeedConfigured: () => "demo",
  optionsConfigured: () => true,
  providers: {
    fundamentals: { getSharesOutstanding: vi.fn(async () => null) },
  },
}));

import { GET, PUT, DELETE } from "@/app/api/workspace/route";
import {
  createGuest,
  discardGuest,
  getGuest,
  type GuestWorkspace,
} from "@/server/guest/store";
import { createPortfolio } from "@/server/guest/portfolio";
import { importGuest } from "@/server/guest/import";
import type { SavedScenario } from "@/lib/studio";
import { monthlyFixture } from "../fixtures/monthly-scenario";

type ProfileEntry = {
  userId: string;
  key: string;
  value: SavedScenario;
  version: number;
  updatedAt: Date;
};
const records = new Map<string, ProfileEntry>();
const rowKey = (userId: string, key: string) => `${userId}\0${key}`;
const keys: string[] = [];
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const schemaSelect = { key: true, value: true, version: true, updatedAt: true };

function taxScenario(portfolioId = "fixture-portfolio"): SavedScenario {
  const scenario = monthlyFixture();
  scenario.assets.forEach((asset) => {
    asset.portfolioId = portfolioId;
  });
  scenario.portfolioSnapshots = [
    {
      id: portfolioId,
      name: "Captured tax account",
      cash: 1000,
      margin: {
        debt: 5000.01,
        aprPercent: 8.125,
        maintenancePercent: 37.5,
        dayCountBasis: 365,
      },
    },
  ];
  scenario.tax = {
    rulesYear: 2025,
    filingStatus: "marriedSeparate",
    otherOrdinaryIncome: 12345.67,
    assumptions: [
      {
        assetId: scenario.assets[0].id,
        included: true,
        treatment: "standard",
        acquiredDate: "2025-01-01",
        totalBasis: 456.78,
      },
      {
        assetId: scenario.assets[1].id,
        included: false,
        treatment: "unsupported",
        acquiredDate: null,
        totalBasis: null,
      },
    ],
  };
  return scenario;
}
const request = (
  scenario: SavedScenario,
  version = 0,
  method = "PUT",
  extra: Record<string, unknown> = {},
) =>
  new Request("http://127.0.0.1:3000/api/workspace", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: `scenario:${scenario.id}`,
      version,
      value: scenario,
      ...extra,
    }),
  });
function activate(mode: "guest" | "profile") {
  const guest = createGuest();
  keys.push(guest.state.key);
  const portfolio = createPortfolio(guest.state, {
    name: "Account records unchanged",
    startingCash: 1000,
  });
  mocks.guestIdentity.mockResolvedValue({ ...guest, key: guest.state.key });
  mocks.profile.mockResolvedValue(
    mode === "profile" ? { id: "profile-a" } : null,
  );
  return { ...guest, portfolio };
}
function acceptedValue(
  mode: "guest" | "profile",
  state: GuestWorkspace,
  key: string,
) {
  return mode === "guest"
    ? state.entries?.[key]
    : records.get(rowKey("profile-a", key));
}
function noFinancialWrites() {
  for (const method of [
    mocks.db.portfolio.create,
    mocks.db.position.create,
    mocks.db.optionPositionDetails.create,
    mocks.db.targetScenario.create,
    mocks.db.cashLedgerEntry.createMany,
    mocks.db.order.create,
    mocks.db.fill.createMany,
  ])
    expect(method).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  records.clear();
  mocks.profile.mockResolvedValue(null);
  mocks.guestIdentity.mockResolvedValue({ state: null });
  mocks.guestCookie.mockImplementation((response) => response);
  mocks.db.guestImport.findUnique.mockResolvedValue(null);
  mocks.db.$transaction.mockImplementation(async (callback) =>
    callback(mocks.db),
  );
  mocks.db.workspaceEntry.findMany.mockImplementation(
    async ({ where, select }) =>
      [...records.values()]
        .filter((entry) => entry.userId === where.userId)
        .map((entry) =>
          select && !select.value
            ? { key: entry.key }
            : {
                key: entry.key,
                value: json(entry.value),
                version: entry.version,
                updatedAt: entry.updatedAt,
              },
        ),
  );
  mocks.db.workspaceEntry.count.mockImplementation(
    async ({ where }) =>
      [...records.values()].filter((entry) => entry.userId === where.userId)
        .length,
  );
  mocks.db.workspaceEntry.create.mockImplementation(async ({ data }) => {
    const key = rowKey(data.userId, data.key);
    if (records.has(key))
      throw new Prisma.PrismaClientKnownRequestError(
        "fixture unique constraint",
        { code: "P2002", clientVersion: "5.20.0" },
      );
    const entry: ProfileEntry = {
      userId: data.userId,
      key: data.key,
      value: json(data.value),
      version: data.version ?? 1,
      updatedAt: data.updatedAt ?? new Date(),
    };
    records.set(key, entry);
    return {
      key: entry.key,
      value: entry.value,
      version: entry.version,
      updatedAt: entry.updatedAt,
    };
  });
  mocks.db.workspaceEntry.updateMany.mockImplementation(
    async ({ where, data }) => {
      const entry = records.get(rowKey(where.userId, where.key));
      if (!entry || entry.version !== where.version) return { count: 0 };
      entry.value = json(data.value);
      entry.version += data.version.increment;
      return { count: 1 };
    },
  );
  mocks.db.workspaceEntry.findUniqueOrThrow.mockImplementation(
    async ({ where }) => {
      const entry = records.get(
        rowKey(where.userId_key.userId, where.userId_key.key),
      );
      if (!entry) throw new Error("fixture missing entry");
      return {
        key: entry.key,
        value: json(entry.value),
        version: entry.version,
        updatedAt: entry.updatedAt,
      };
    },
  );
  mocks.db.workspaceEntry.deleteMany.mockImplementation(async ({ where }) => {
    const key = rowKey(where.userId, where.key);
    const entry = records.get(key);
    if (!entry || entry.version !== where.version) return { count: 0 };
    records.delete(key);
    return { count: 1 };
  });
});
afterEach(() => {
  keys.splice(0).forEach(discardGuest);
  vi.restoreAllMocks();
});

describe("Tax scenario workspace transport (mocked auth and database)", () => {
  it.each(["guest", "profile"] as const)(
    "round-trips every tax field and captures only scenario JSON for a %s",
    async (mode) => {
      const { state, portfolio } = activate(mode);
      const before = json(portfolio);
      const scenario = taxScenario(portfolio.id);
      const original = structuredClone(scenario);
      const key = `scenario:${scenario.id}`;
      const response = await PUT(request(scenario));
      expect(response.status).toBe(200);
      expect((await response.json()).entry).toMatchObject({
        key,
        value: original,
        version: 1,
      });
      const reloaded = await GET();
      expect(reloaded.status).toBe(200);
      expect((await reloaded.json()).entries[0].value).toEqual(original);
      expect(acceptedValue(mode, state, key)?.value).toEqual(original);
      expect(json(portfolio)).toEqual(before);
      expect(scenario).toEqual(original);
      noFinancialWrites();
      if (mode === "profile") {
        expect(mocks.db.workspaceEntry.create.mock.calls[0][0].data).toEqual({
          userId: "profile-a",
          key,
          value: original,
        });
        expect(mocks.db.workspaceEntry.findMany).toHaveBeenCalledWith({
          where: { userId: "profile-a" },
          select: schemaSelect,
        });
        expect(mocks.guestIdentity).not.toHaveBeenCalled();
      } else {
        expect(mocks.db.$transaction).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["guest", "profile"] as const)(
    "keeps nullable unknown inputs and explicit exclusions saveable for a %s",
    async (mode) => {
      const { state, portfolio } = activate(mode);
      const scenario = taxScenario(portfolio.id);
      scenario.tax!.otherOrdinaryIncome = null;
      scenario.tax!.assumptions[0] = {
        assetId: scenario.assets[0].id,
        included: true,
        treatment: "unknown",
        acquiredDate: null,
        totalBasis: null,
      };
      const response = await PUT(request(scenario));
      expect(response.status).toBe(200);
      const value = (await (await GET()).json()).entries[0].value;
      expect(value.tax).toEqual(scenario.tax);
      expect(
        acceptedValue(mode, state, `scenario:${scenario.id}`)?.version,
      ).toBe(1);
      noFinancialWrites();
    },
  );

  it.each(["guest", "profile"] as const)(
    "retains accepted %s settings after stale update and delete attempts",
    async (mode) => {
      const { state, portfolio } = activate(mode);
      const scenario = taxScenario(portfolio.id);
      const key = `scenario:${scenario.id}`;
      expect((await PUT(request(scenario))).status).toBe(200);
      const changed = structuredClone(scenario);
      changed.tax!.rulesYear = 2026;
      changed.tax!.otherOrdinaryIncome = 0;
      changed.tax!.assumptions[0].acquiredDate = null;
      expect((await PUT(request(changed, 1))).status).toBe(200);
      expect((await PUT(request(scenario, 1))).status).toBe(409);
      expect((await DELETE(request(scenario, 1, "DELETE"))).status).toBe(409);
      expect(acceptedValue(mode, state, key)).toMatchObject({
        version: 2,
        value: changed,
      });
      expect((await (await GET()).json()).entries[0].value.tax).toEqual(
        changed.tax,
      );
      noFinancialWrites();
      if (mode === "profile") {
        expect(
          mocks.db.workspaceEntry.updateMany.mock.calls[0][0].where,
        ).toEqual({ userId: "profile-a", key, version: 1 });
        expect(
          mocks.db.workspaceEntry.deleteMany.mock.calls[0][0].where,
        ).toEqual({ userId: "profile-a", key, version: 1 });
      }
    },
  );

  it("does not expose or change another profile's tax scenario through forged owner fields", async () => {
    activate("profile");
    const scenario = taxScenario();
    const key = `scenario:${scenario.id}`;
    expect((await PUT(request(scenario))).status).toBe(200);
    const original = json(records.get(rowKey("profile-a", key))!);
    mocks.profile.mockResolvedValue({ id: "profile-b" });
    expect((await (await GET()).json()).entries).toEqual([]);
    expect(
      (
        await PUT(
          request(
            { ...scenario, tax: { ...scenario.tax!, otherOrdinaryIncome: 0 } },
            1,
            "PUT",
            { userId: "profile-a" },
          ),
        )
      ).status,
    ).toBe(409);
    expect(
      (await DELETE(request(scenario, 1, "DELETE", { userId: "profile-a" })))
        .status,
    ).toBe(409);
    expect(json(records.get(rowKey("profile-a", key))!)).toEqual(original);
    expect(mocks.db.workspaceEntry.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: "profile-b", key, version: 1 },
      }),
    );
    expect(mocks.db.workspaceEntry.deleteMany).toHaveBeenLastCalledWith({
      where: { userId: "profile-b", key, version: 1 },
    });
    noFinancialWrites();
  });

  it("isolates guest tax records and refuses an old version in a different workspace", async () => {
    const a = activate("guest");
    const scenario = taxScenario(a.portfolio.id);
    const key = `scenario:${scenario.id}`;
    expect((await PUT(request(scenario))).status).toBe(200);
    const original = structuredClone(a.state.entries![key]);
    const b = activate("guest");
    expect((await (await GET()).json()).entries).toEqual([]);
    expect((await PUT(request(scenario, 1))).status).toBe(409);
    expect((await DELETE(request(scenario, 1, "DELETE"))).status).toBe(409);
    expect(b.state.entries?.[key]).toBeUndefined();
    expect(a.state.entries![key]).toEqual(original);
    noFinancialWrites();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it.each(["missing", "duplicate", "foreign", "duplicate captured"])(
    "rejects %s tax scope before any authenticated storage operation",
    async (kind) => {
      activate("profile");
      const scenario = taxScenario();
      delete scenario.monthly;
      if (kind === "missing") scenario.tax!.assumptions.pop();
      if (kind === "duplicate")
        scenario.tax!.assumptions.push({ ...scenario.tax!.assumptions[0] });
      if (kind === "foreign")
        scenario.tax!.assumptions[0].assetId = "foreign-asset";
      if (kind === "duplicate captured")
        scenario.assets[1].id = scenario.assets[0].id;
      const original = structuredClone(scenario);
      expect((await PUT(request(scenario))).status).toBe(400);
      expect(mocks.profile).not.toHaveBeenCalled();
      expect(mocks.db.$transaction).not.toHaveBeenCalled();
      expect(mocks.db.workspaceEntry.create).not.toHaveBeenCalled();
      expect(scenario).toEqual(original);
      noFinancialWrites();
    },
  );

  it.each(["guest", "profile"] as const)(
    "leaves legacy tax omission intact in the %s transport",
    async (mode) => {
      activate(mode);
      const legacy = monthlyFixture();
      expect((await PUT(request(legacy))).status).toBe(200);
      const restored = (await (await GET()).json()).entries[0].value;
      expect(restored).toEqual(legacy);
      expect(Object.hasOwn(restored, "tax")).toBe(false);
      noFinancialWrites();
    },
  );

  it.each(["income", "basis"])(
    "rejects a nonfinite JSON tax %s instead of converting it to a saveable unknown",
    async (field) => {
      activate("profile");
      const scenario = taxScenario();
      let raw = JSON.stringify({
        key: `scenario:${scenario.id}`,
        version: 0,
        value: scenario,
      });
      raw = raw.replace(
        field === "income"
          ? '"otherOrdinaryIncome":12345.67'
          : '"totalBasis":456.78',
        field === "income"
          ? '"otherOrdinaryIncome":1e309'
          : '"totalBasis":1e309',
      );
      expect(raw).toContain("1e309");
      const response = await PUT(
        new Request("http://127.0.0.1:3000/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: raw,
        }),
      );
      expect(response.status).toBe(400);
      expect(records.size).toBe(0);
      expect(mocks.db.$transaction).not.toHaveBeenCalled();
      noFinancialWrites();
    },
  );

  it("retains the accepted tax record and caller draft after a profile write fails, then permits retry", async () => {
    activate("profile");
    const scenario = taxScenario();
    const key = `scenario:${scenario.id}`;
    expect((await PUT(request(scenario))).status).toBe(200);
    const changed = structuredClone(scenario);
    changed.tax!.assumptions[0].totalBasis = 0;
    mocks.db.$transaction.mockRejectedValueOnce(
      new Error("SECRET_DATABASE_URL"),
    );
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await PUT(request(changed, 1));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("SECRET_DATABASE_URL");
    expect(records.get(rowKey("profile-a", key))).toMatchObject({
      version: 1,
      value: scenario,
    });
    expect(changed.tax!.assumptions[0].totalBasis).toBe(0);
    expect(logger.mock.calls.flat().join(" ")).not.toContain(
      "SECRET_DATABASE_URL",
    );
    expect((await PUT(request(changed, 1))).status).toBe(200);
    expect(records.get(rowKey("profile-a", key))).toMatchObject({
      version: 2,
      value: changed,
    });
    noFinancialWrites();
  });
});

describe("Tax scenario guest import (mocked transaction, no real database)", () => {
  it("copies a colliding scenario with tax settings, frozen fields and version unchanged", async () => {
    const { state, portfolio } = activate("guest");
    const scenario = taxScenario(portfolio.id);
    const key = `scenario:${scenario.id}`;
    expect((await PUT(request(scenario))).status).toBe(200);
    scenario.tax!.filingStatus = "marriedJoint";
    expect((await PUT(request(scenario, 1))).status).toBe(200);
    const entry = structuredClone(state.entries![key]);
    const beforePortfolio = json(portfolio);
    const existing = {
      ...structuredClone(scenario),
      tax: { ...scenario.tax!, otherOrdinaryIncome: 99999 },
    };
    records.set(rowKey("profile-a", key), {
      userId: "profile-a",
      key,
      value: existing,
      version: 7,
      updatedAt: new Date(scenario.capturedAt),
    });
    const result = await importGuest(state.key, "profile-a");
    expect(result).toEqual({
      portfolioIds: [portfolio.id],
      alreadySaved: false,
    });
    expect(mocks.db.workspaceEntry.findMany).toHaveBeenCalledWith({
      where: { userId: "profile-a" },
      select: { key: true },
    });
    const { data } = mocks.db.workspaceEntry.create.mock.calls[0][0];
    expect(data.userId).toBe("profile-a");
    expect(data.key).toBe(`scenario:${data.value.id}`);
    expect(data.key).not.toBe(key);
    expect(data.value).toEqual({ ...entry.value, id: data.value.id });
    expect(data.value.tax).toEqual(scenario.tax);
    expect(data.value.portfolioSnapshots).toEqual(scenario.portfolioSnapshots);
    expect(data.value.monthly).toEqual(scenario.monthly);
    expect(data.version).toBe(2);
    expect(data.updatedAt).toEqual(new Date(entry.updatedAt));
    expect(records.get(rowKey("profile-a", key))).toMatchObject({
      value: existing,
      version: 7,
    });
    expect(json(portfolio)).toEqual(beforePortfolio);
    expect(mocks.db.portfolio.create.mock.calls[0][0].data).not.toHaveProperty(
      "tax",
    );
    expect(mocks.db.guestImport.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        tokenHash: state.key,
        userId: "profile-a",
        portfolioIds: [portfolio.id],
      },
    });
    expect(
      mocks.db.guestImport.create.mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      mocks.db.workspaceEntry.create.mock.invocationCallOrder[0],
    );
    expect(getGuest(state.key)).toBeNull();
  });

  it("keeps guest tax settings, version and account records available after a failed import", async () => {
    const { state, portfolio } = activate("guest");
    const scenario = taxScenario(portfolio.id);
    const key = `scenario:${scenario.id}`;
    expect((await PUT(request(scenario))).status).toBe(200);
    const entry = structuredClone(state.entries![key]);
    const beforePortfolio = json(portfolio);
    mocks.db.workspaceEntry.create.mockRejectedValueOnce(
      new Error("fixture tax write aborted"),
    );
    await expect(importGuest(state.key, "profile-a")).rejects.toThrow(
      "fixture tax write aborted",
    );
    expect(state.imported).toBe(false);
    expect(getGuest(state.key)?.entries?.[key]).toEqual(entry);
    expect(json(portfolio)).toEqual(beforePortfolio);
    expect(mocks.db.guestImport.create).not.toHaveBeenCalled();
    expect((await (await GET()).json()).entries[0].value.tax).toEqual(
      scenario.tax,
    );
    expect((await importGuest(state.key, "profile-a")).alreadySaved).toBe(
      false,
    );
    expect(mocks.db.workspaceEntry.create.mock.calls[1][0].data).toMatchObject({
      userId: "profile-a",
      key,
      value: entry.value,
      version: entry.version,
    });
    expect(mocks.db.guestImport.create).toHaveBeenCalledTimes(1);
  });

  it("preserves tax assumptions when another profile owns a durable import receipt", async () => {
    const { state, portfolio } = activate("guest");
    const scenario = taxScenario(portfolio.id);
    const key = `scenario:${scenario.id}`;
    expect((await PUT(request(scenario))).status).toBe(200);
    const entry = structuredClone(state.entries![key]);
    mocks.db.guestImport.findUnique.mockResolvedValue({
      userId: "profile-a",
      portfolioIds: [portfolio.id],
    });
    await expect(importGuest(state.key, "profile-b")).rejects.toThrow(
      "different profile",
    );
    expect(state.entries![key]).toEqual(entry);
    expect(state.imported).toBe(false);
    expect(getGuest(state.key)).toBe(state);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect(mocks.db.workspaceEntry.create).not.toHaveBeenCalled();
  });
});
