import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: mocks.token }) }),
}));
vi.mock("@/server/auth/access", () => ({ currentProfile: async () => null }));
vi.mock("@/server/services/quote-service", () => ({
  getLiveQuote: vi.fn(async () => null),
  quoteMark: () => null,
}));
import { createGuest, discardGuest } from "@/server/guest/store";
import { createPortfolio } from "@/server/guest/portfolio";
import { guestResponse } from "@/server/guest/http";
import { monthlyFixture } from "../fixtures/monthly-scenario";
const keys: string[] = [];
function guest() {
  const g = createGuest();
  keys.push(g.state.key);
  return g;
}
const call = (id: string, name: unknown) =>
  guestResponse(
    new Request(`http://localhost/api/portfolios/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ name }),
    }),
  );
beforeEach(() => {
  mocks.token = "";
});
afterEach(() => {
  keys.splice(0).forEach(discardGuest);
  vi.useRealTimers();
});
describe("temporary portfolio deletion", () => {
  it("closes an existing quote stream after deletion instead of keeping the guest alive", async () => {
    vi.useFakeTimers();
    const g = guest();
    mocks.token = g.token;
    const p = createPortfolio(g.state, {
      name: "Streaming",
      startingCash: 1000,
    });
    const stream = await guestResponse(
      new Request(`http://localhost/api/quotes/stream?portfolioId=${p.id}`),
    );
    const reader = stream!.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "event: ready",
    );
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "event: keepalive",
    );
    expect((await call(p.id, p.name))?.status).toBe(200);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    const expires = g.state.expiresAt;
    await vi.advanceTimersByTimeAsync(45000);
    expect(g.state.expiresAt).toBe(expires);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("removes only the selected portfolio and keeps saved scenarios", async () => {
    const g = guest();
    mocks.token = g.token;
    const a = createPortfolio(g.state, {
        name: "Delete me",
        startingCash: 1000,
      }),
      b = createPortfolio(g.state, { name: "Keep me", startingCash: 2000 });
    g.state.entries = {
      snapshot: {
        key: "snapshot",
        version: 1,
        value: monthlyFixture(),
        updatedAt: new Date().toISOString(),
      },
    };
    const entries = structuredClone(g.state.entries);
    const r = await call(a.id, a.name);
    expect(r?.status).toBe(200);
    expect(g.state.portfolios).toEqual([b]);
    expect(g.state.entries).toEqual(entries);
    expect((await call(a.id, a.name))?.status).toBe(404);
  });
  it("cannot delete another guest's portfolio", async () => {
    const a = guest(),
      b = guest(),
      p = createPortfolio(a.state, { name: "Private", startingCash: 1000 });
    mocks.token = b.token;
    expect((await call(p.id, p.name))?.status).toBe(404);
    expect(a.state.portfolios).toHaveLength(1);
  });
  it("preserves holdings and cash when confirmation is missing or outdated", async () => {
    const g = guest();
    mocks.token = g.token;
    const p = createPortfolio(g.state, {
      name: "Current name",
      startingCash: 1234,
    });
    expect((await call(p.id, undefined))?.status).toBe(400);
    expect((await call(p.id, "Old name"))?.status).toBe(409);
    expect(g.state.portfolios[0]).toBe(p);
    expect(p.cashBalance.toNumber()).toBe(1234);
  });
  it("serializes concurrent deletes; only one succeeds", async () => {
    const g = guest();
    mocks.token = g.token;
    const p = createPortfolio(g.state, {
      name: "Personal",
      startingCash: 1000,
    });
    const responses = await Promise.all([
      call(p.id, p.name),
      call(p.id, p.name),
    ]);
    expect(responses.map((r) => r?.status).sort()).toEqual([200, 404]);
    expect(g.state.portfolios).toEqual([]);
  });
});
