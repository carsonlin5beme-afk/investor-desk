import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  guestImport: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { createGuest, discardGuest, getGuest } from "@/server/guest/store";
import { createPortfolio } from "@/server/guest/portfolio";
import { importGuest } from "@/server/guest/import";
import {
  defaultPreferences,
  type JournalNote,
  type WorkspaceEntry,
} from "@/lib/studio";
const keys: string[] = [];
const tx = {
  portfolio: { create: vi.fn() },
  position: { create: vi.fn() },
  optionPositionDetails: { create: vi.fn() },
  targetScenario: { create: vi.fn() },
  cashLedgerEntry: { createMany: vi.fn() },
  order: { create: vi.fn() },
  fill: { createMany: vi.fn() },
  guestImport: { create: vi.fn() },
  workspaceEntry: { findMany: vi.fn(), create: vi.fn() },
};
beforeEach(() => {
  vi.resetAllMocks();
  db.guestImport.findUnique.mockResolvedValue(null);
  tx.workspaceEntry.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (callback) => callback(tx));
});
afterEach(() => {
  for (const key of keys.splice(0)) discardGuest(key);
});
function prepare() {
  const { state } = createGuest();
  keys.push(state.key);
  createPortfolio(state, { name: "First", startingCash: 250000 });
  createPortfolio(state, { name: "Second", startingCash: 1000 });
  return state;
}
describe("authenticated guest transfer", () => {
  it("saves every portfolio under the authenticated user with stable IDs and one receipt", async () => {
    const state = prepare(),
      ids = state.portfolios.map((p) => p.id);
    const result = await importGuest(state.key, "profile-a");
    expect(result.portfolioIds).toEqual(ids);
    expect(tx.portfolio.create).toHaveBeenCalledTimes(2);
    expect(
      tx.portfolio.create.mock.calls.every(
        ([arg]) => arg.data.userId === "profile-a",
      ),
    ).toBe(true);
    expect(tx.guestImport.create).toHaveBeenCalledWith({
      data: { tokenHash: state.key, userId: "profile-a", portfolioIds: ids },
    });
    expect(state.portfolios).toEqual([]);
    expect(state.imported).toBe(true);
    expect(getGuest(state.key)).toBeNull();
  });
  it("keeps the whole workspace available if the database transaction fails, and permits retry", async () => {
    const state = prepare(),
      ids = state.portfolios.map((p) => p.id);
    db.$transaction.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(importGuest(state.key, "profile-a")).rejects.toThrow(
      "database unavailable",
    );
    expect(getGuest(state.key)?.portfolios.map((p) => p.id)).toEqual(ids);
    expect(state.imported).toBe(false);
    expect((await importGuest(state.key, "profile-a")).portfolioIds).toEqual(
      ids,
    );
  });
  it("returns the durable receipt after a lost response, without creating duplicates", async () => {
    const state = prepare();
    db.guestImport.findUnique.mockResolvedValue({
      userId: "profile-a",
      portfolioIds: ["already-saved"],
    });
    expect(await importGuest(state.key, "profile-a")).toEqual({
      portfolioIds: ["already-saved"],
      alreadySaved: true,
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("refuses a different profile's receipt and never accepts arbitrary portfolio IDs", async () => {
    const state = prepare();
    db.guestImport.findUnique.mockResolvedValue({
      userId: "profile-a",
      portfolioIds: ["private"],
    });
    await expect(importGuest(state.key, "profile-b")).rejects.toThrow(
      "different profile",
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("reports expired or lost guest data instead of silently claiming a successful save", async () => {
    await expect(importGuest("missing-session", "profile-a")).rejects.toThrow(
      "expired",
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

function withResearch(state: ReturnType<typeof prepare>) {
  const id = crypto.randomUUID();
  const note: JournalNote = {
    id,
    holdingId: "",
    symbol: "TSLA",
    title: "Investment thesis",
    body: "Evidence retained",
    source: "https://example.com/research",
    reviewDate: "",
    revisions: [],
  };
  const entry: WorkspaceEntry = {
    key: `note:${id}`,
    value: note,
    version: 3,
    updatedAt: new Date().toISOString(),
  };
  state.entries = {
    [entry.key]: entry,
    preferences: {
      key: "preferences",
      value: { ...defaultPreferences, theme: "dark" },
      version: 2,
      updatedAt: new Date().toISOString(),
    },
  };
  return entry;
}
describe("research and preferences transfer", () => {
  it("commits guest notes with their version in the same transaction as portfolios and receipt", async () => {
    const state = prepare(),
      entry = withResearch(state);
    await importGuest(state.key, "profile-a");
    expect(tx.workspaceEntry.create).toHaveBeenCalledWith({
      data: {
        userId: "profile-a",
        key: entry.key,
        value: entry.value,
        version: 3,
        updatedAt: new Date(entry.updatedAt),
      },
    });
    expect(tx.workspaceEntry.create).toHaveBeenCalledTimes(2);
    expect(tx.guestImport.create.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.workspaceEntry.create.mock.invocationCallOrder[1],
    );
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
  });
  it("keeps existing profile preferences and copies a colliding note without losing either", async () => {
    const state = prepare(),
      entry = withResearch(state);
    tx.workspaceEntry.findMany.mockResolvedValue([
      { key: "preferences" },
      { key: entry.key },
    ]);
    await importGuest(state.key, "profile-a");
    expect(tx.workspaceEntry.create).toHaveBeenCalledTimes(1);
    const { data } = tx.workspaceEntry.create.mock.calls[0][0];
    expect(data.key).not.toBe(entry.key);
    expect(data.key).toBe(`note:${data.value.id}`);
    expect(data.value).toEqual({ ...entry.value, id: data.value.id });
    expect(entry.key).toBe(`note:${(entry.value as JournalNote).id}`);
  });
  it("retains notes, portfolios and retry state when a research write aborts import", async () => {
    const state = prepare(),
      entry = withResearch(state);
    tx.workspaceEntry.create.mockRejectedValueOnce(new Error("write failed"));
    await expect(importGuest(state.key, "profile-a")).rejects.toThrow(
      "write failed",
    );
    expect(tx.guestImport.create).not.toHaveBeenCalled();
    expect(getGuest(state.key)?.entries?.[entry.key]).toEqual(entry);
    expect(state.imported).toBe(false);
    expect(state.portfolios).toHaveLength(2);
    expect((await importGuest(state.key, "profile-a")).alreadySaved).toBe(
      false,
    );
  });
  it("checks the combined profile storage cap before importing any portfolios or notes", async () => {
    const state = prepare();
    withResearch(state);
    tx.workspaceEntry.findMany.mockResolvedValue(
      Array.from({ length: 300 }, (_, i) => ({ key: `fixture:${i}` })),
    );
    await expect(importGuest(state.key, "profile-a")).rejects.toThrow(
      "saved workspace is full",
    );
    expect(tx.portfolio.create).not.toHaveBeenCalled();
    expect(tx.workspaceEntry.create).not.toHaveBeenCalled();
    expect(state.entries).toBeDefined();
    expect(state.imported).toBe(false);
  });
  it("saves a research-only guest workspace with no portfolios", async () => {
    const state = prepare();
    withResearch(state);
    state.portfolios = [];
    const result = await importGuest(state.key, "profile-a");
    expect(result.portfolioIds).toEqual([]);
    expect(tx.portfolio.create).not.toHaveBeenCalled();
    expect(tx.workspaceEntry.create).toHaveBeenCalledTimes(2);
    expect(tx.guestImport.create).toHaveBeenCalledOnce();
  });
});
