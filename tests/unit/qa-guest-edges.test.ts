import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  guestImport: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock("@/server/auth/access", () => ({
  currentProfile: vi.fn(async () => null),
}));
vi.mock("@/server/services/order-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/services/order-service")>();
  const { decideFill } = await import("@/server/domain/fill-engine");
  return {
    ...actual,
    resolveTicket: vi.fn(async (ticket) => {
      const quote = {
        symbol: ticket.symbol,
        assetClass: ticket.assetClass,
        bid: 319.95,
        ask: 320.05,
        mark: 320,
        last: null,
        source: "demo",
        asOf: new Date(),
      };
      return {
        symbol: ticket.symbol,
        quote,
        decision: decideFill(ticket, quote),
      };
    }),
  };
});
vi.mock("@/server/services/quote-service", () => ({
  getLiveQuote: vi.fn(async () => null),
  quoteMark: () => null,
}));
import { createGuest, discardGuest, getGuest } from "@/server/guest/store";
import { createPortfolio, guestOrder } from "@/server/guest/portfolio";
import { guestResponse } from "@/server/guest/http";
import { importGuest } from "@/server/guest/import";
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
};
const size = () =>
  (
    globalThis as typeof globalThis & {
      investorGuestWorkspacesV1?: Map<string, unknown>;
    }
  ).investorGuestWorkspacesV1?.size ?? 0;
beforeEach(() => {
  vi.resetAllMocks();
  db.guestImport.findUnique.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (fn) => fn(tx));
});
afterEach(() => {
  keys.splice(0).forEach(discardGuest);
});
function fixture() {
  const { state } = createGuest();
  keys.push(state.key);
  const p = createPortfolio(state, {
    name: "QA isolated guest edge",
    startingCash: 10000,
  });
  return { state, p };
}
const ticket = (id: string, quantity: number, side = "BUY") => ({
  portfolioId: id,
  symbol: "TSLA",
  assetClass: "EQUITY",
  orderType: "MARKET",
  side,
  quantity,
  clientOrderId: randomUUID(),
});
describe("QA guest resource and fractional-accounting regressions (isolated, no real DB/network)", () => {
  it.each([
    "{",
    JSON.stringify({ name: "bad", startingCash: -1 }),
    JSON.stringify({ name: "", startingCash: 100 }),
  ])(
    "invalid first create does not allocate unreachable RAM: %s",
    async (body) => {
      const before = size();
      const response = await guestResponse(
        new Request("http://127.0.0.1:3000/api/portfolios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
      );
      expect(response?.status).toBe(400);
      expect(response?.headers.get("set-cookie")).toBeNull();
      expect(size()).toBe(before);
    },
  );
  it("committed imports release their RAM capacity while durable receipts allow replay", async () => {
    const { state, p } = fixture();
    await importGuest(state.key, "qa-profile");
    expect(state.imported).toBe(true);
    expect(getGuest(state.key)).toBeNull();
    db.guestImport.findUnique.mockResolvedValue({
      userId: "qa-profile",
      portfolioIds: [p.id],
    });
    expect(await importGuest(state.key, "qa-profile")).toEqual({
      portfolioIds: [p.id],
      alreadySaved: true,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it.each([
    { side: "BUY", quantity: 9.7 },
    { side: "SELL", quantity: 0.7 },
  ])(
    "fractional $side notional agrees with preview, cash and ledger",
    async ({ side, quantity }) => {
      const { state, p } = fixture();
      if (side === "SELL") await guestOrder(state, ticket(p.id, 1), true);
      const t = ticket(p.id, quantity, side);
      const preview = await guestOrder(state, t, false);
      const before = p.cashBalance;
      const result = await guestOrder(state, t, true);
      expect("execution" in result).toBe(true);
      expect("preview" in preview).toBe(true);
      if (!("execution" in result) || !("preview" in preview))
        throw new Error("Expected fill and preview");
      const ledgerAmount = p.cashLedgerEntries.at(-1)!.amount.abs().toNumber();
      expect(result.execution.notional).toBe(ledgerAmount);
      expect(result.execution.notional).toBe(
        before.minus(p.cashBalance).abs().toNumber(),
      );
      expect(result.execution.notional).toBe(
        (preview.preview as { estimatedNotional: number }).estimatedNotional,
      );
    },
  );
});
