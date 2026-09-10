import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
try {
  process.loadEnvFile(".env");
} catch {}
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("API tests are local-only.");
const db = new PrismaClient(),
  ids = [],
  prefix = `__verify_${Date.now()}_`;
let passed = 0,
  cookie = "",
  userId;
const staleSymbol =
  "Q" + randomUUID().replaceAll("-", "").slice(0, 9).toUpperCase();
const ok = (label) => {
  console.log(`PASS ${++passed}: ${label}`);
};
async function request(path, method = "GET", body, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
async function portfolio(name, cash) {
  const d = await request(
    "/api/portfolios",
    "POST",
    { name: prefix + name, startingCash: cash },
    201,
  );
  ids.push(d.portfolio.id);
  return d.portfolio;
}
const execute = (ticket) =>
  request("/api/orders/execute", "POST", {
    ...ticket,
    clientOrderId: ticket.clientOrderId ?? randomUUID(),
  });
try {
  const health = await request("/api/health");
  assert.equal(health.mode, "demo", "Tests require explicit demo mode");
  ok("App and database healthy in labeled sample mode");
  const signup = await fetch(base + "/api/auth/sign-up/email", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: prefix + "Profile",
      email: prefix + "@example.test",
      password: randomUUID() + "aA9!",
    }),
  });
  assert.equal(signup.status, 200, "Disposable profile sign-up must succeed");
  userId = (await signup.json()).user.id;
  cookie = signup.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.ok(cookie, "Authenticated cookie required");
  const blank = await request("/api/desk");
  assert.equal(blank.portfolios.length, 0, "New profile starts empty");
  const pl = await request("/api/quotes/snapshot?symbol=PL&assetClass=EQUITY");
  assert.equal(pl.quote, null);
  assert.equal(pl.availability.code, "DEMO_UNAVAILABLE");
  ok("New profile starts blank and unsupported sample ticker is explained");
  const p = await portfolio("Personal", 250000),
    p2 = await portfolio("Second", 1000);
  ok("Independent funded portfolios");
  const ticket = {
    portfolioId: p.id,
    assetClass: "EQUITY",
    symbol: "TSLA",
    side: "BUY",
    quantity: 228,
    orderType: "MARKET",
    clientOrderId: randomUUID(),
  };
  const { preview } = await request("/api/orders/preview", "POST", ticket);
  assert.equal(preview.estimatedFillPrice, 320.05);
  assert.equal(preview.estimatedNotional, 72971.4);
  ok("Market preview uses ask and exact cash impact");
  const a = await execute(ticket),
    again = await execute(ticket);
  assert.equal(a.execution.orderId, again.execution.orderId);
  assert.equal(await db.order.count({ where: { portfolioId: p.id } }), 1);
  assert.equal(a.execution.portfolioCashBalance, 177028.6);
  ok("Atomic equity fill and duplicate-submission protection");
  const equityId = a.execution.position.id;
  let projection = await request(`/api/portfolios/${p.id}/projection`);
  assert.equal(projection.positions[0].projectedValue, 72960);
  ok("Untargeted holdings remain in projected net worth");
  await request(`/api/positions/${equityId}/target`, "PATCH", {
    targetMode: "PRICE",
    targetPrice: 2000,
  });
  projection = await request(`/api/portfolios/${p.id}/projection`);
  assert.equal(projection.positions[0].projectedValue, 456000);
  ok("228 TSLA shares at $2000 equals $456000");
  const exp = await request("/api/options/expirations?symbol=BTG");
  const { contracts } = await request(
    `/api/options/chain?symbol=BTG&expiration=${exp.expirations[2]}&right=CALL`,
  );
  const contract = contracts.find((c) => c.strike === 5);
  assert.ok(contract);
  const option = {
    portfolioId: p.id,
    assetClass: "OPTION",
    symbol: "BTG",
    side: "BUY",
    quantity: 600,
    orderType: "MARKET",
    optionContractSymbol: contract.contractSymbol,
    optionRight: contract.right,
    optionStrike: contract.strike,
    optionExpiration: contract.expiration,
  };
  const b = await execute(option);
  assert.equal(b.execution.notional, 109800);
  assert.equal(b.execution.portfolioCashBalance, 67228.6);
  ok("600 BTG calls at $1.83 debit $109800");
  await request(`/api/positions/${b.execution.position.id}/target`, "PATCH", {
    targetMode: "MARKET_CAP",
    targetMarketCap: 50e9,
    useManualShares: true,
    sharesOutstandingManual: 1.35e9,
  });
  projection = await request(`/api/portfolios/${p.id}/projection`);
  const op = projection.positions.find((x) => x.assetClass === "OPTION");
  assert.ok(Math.abs(op.targetUnderlyingPrice - 50e9 / 1.35e9) < 1e-6);
  assert.equal(op.optionIntrinsicProjectedValue, 1922222.22);
  assert.equal(
    projection.projectedNetWorth,
    Math.round((67228.6 + 456000 + op.optionModelProjectedValue) * 100) / 100,
  );
  ok("Valuation conversion and simultaneous mixed-asset projection");
  await execute({ ...option, portfolioId: p2.id, quantity: 1 });
  ok("Same option contract may be held in multiple portfolios");
  await execute({ ...option, side: "SELL", quantity: 200 });
  let position = await db.position.findUnique({
    where: { id: b.execution.position.id },
    include: { optionDetails: true },
  });
  assert.equal(position.quantity.toNumber(), 400);
  assert.equal(position.optionDetails.contracts, 400);
  assert.equal(position.avgCost.toNumber(), 1.83);
  ok("Partial option sell updates contracts and preserves cost basis");
  await request(
    "/api/orders/execute",
    "POST",
    { ...option, side: "SELL", quantity: 401 },
    400,
  );
  await request(
    "/api/orders/execute",
    "POST",
    { ...option, quantity: 0.5 },
    400,
  );
  ok("Overselling and fractional options are rejected");
  await execute({ ...option, side: "SELL", quantity: 400 });
  assert.equal(
    await db.position.count({ where: { id: b.execution.position.id } }),
    0,
  );
  assert.equal(
    await db.targetScenario.count({
      where: { positionId: b.execution.position.id },
    }),
    0,
  );
  ok("Full option sell closes the position and target atomically");
  const before = (
    await db.portfolio.findUnique({ where: { id: p.id } })
  ).cashBalance.toNumber();
  await request(`/api/portfolios/${p.id}/cash`, "POST", {
    type: "DEPOSIT",
    amount: 5000,
  });
  await request(`/api/portfolios/${p.id}/cash`, "POST", {
    type: "WITHDRAWAL",
    amount: 1000,
  });
  assert.equal(
    (
      await db.portfolio.findUnique({ where: { id: p.id } })
    ).cashBalance.toNumber(),
    before + 4000,
  );
  await request(
    `/api/portfolios/${p.id}/cash`,
    "POST",
    { type: "WITHDRAWAL", amount: 1e9 },
    400,
  );
  ok("Deposits, withdrawals, and insufficient-cash checks");
  const concurrent = await portfolio("Concurrency", 1000);
  const responses = await Promise.all(
    [1, 2].map(() =>
      fetch(base + "/api/orders/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: base,
          Cookie: cookie,
        },
        body: JSON.stringify({
          ...ticket,
          portfolioId: concurrent.id,
          quantity: 2,
          clientOrderId: randomUUID(),
        }),
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
  assert.equal(
    (
      await db.portfolio.findUnique({ where: { id: concurrent.id } })
    ).cashBalance.toNumber(),
    359.9,
  );
  ok("Concurrent orders cannot overspend the same cash");
  const unfilled = await request("/api/orders/preview", "POST", {
    ...ticket,
    orderType: "LIMIT",
    limitPrice: 100,
  });
  assert.equal(unfilled.preview.fillable, false);
  await request(
    "/api/orders/execute",
    "POST",
    {
      ...ticket,
      clientOrderId: randomUUID(),
      orderType: "LIMIT",
      limitPrice: 100,
    },
    400,
  );
  ok("Uncrossed limits do not create resting or filled orders");
  await request(`/api/positions/${equityId}/target`, "PATCH", {
    targetMode: "PRICE",
    targetPrice: 0,
  });
  projection = await request(`/api/portfolios/${p.id}/projection`);
  assert.equal(
    projection.positions.find((x) => x.positionId === equityId).projectedValue,
    0,
  );
  ok("Zero-dollar downside target is supported");
  await db.position.create({
    data: {
      portfolioId: concurrent.id,
      assetClass: "EQUITY",
      symbol: staleSymbol,
      quantity: 1,
      avgCost: 10,
    },
  });
  await db.quoteCache.upsert({
    where: { symbol_assetClass: { symbol: staleSymbol, assetClass: "EQUITY" } },
    create: {
      symbol: staleSymbol,
      assetClass: "EQUITY",
      bid: 7,
      ask: 9,
      last: 8,
      mark: 8,
      asOf: new Date("2020-01-01"),
      source: "demo",
    },
    update: { asOf: new Date("2020-01-01"), source: "demo" },
  });
  const rows = await request(`/api/positions?portfolioId=${concurrent.id}`);
  const stale = rows.positions.find((x) => x.symbol === staleSymbol);
  assert.equal(stale.projection.currentMarketValue, 8);
  assert.equal(stale.projection.quoteStale, true);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(
      `${base}/api/quotes/stream?portfolioId=${concurrent.id}`,
      { headers: { Origin: base, Cookie: cookie }, signal: controller.signal },
    );
    const reader = response.body.getReader();
    let text = "";
    while (!text.includes('"stale":true')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    assert.match(text, /event: ready/);
    assert.match(text, /"stale":true/);
    await reader.cancel();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  ok("SSE emits quotes with genuine stale timestamps and cleans up");
  const blocked = await fetch(base + "/api/portfolios", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://untrusted.example",
    },
    body: JSON.stringify({ name: "blocked", startingCash: 0 }),
  });
  assert.equal(blocked.status, 403);
  ok("Cross-origin portfolio mutations are blocked");
  const desk = await request("/api/desk");
  const summary = desk.portfolios.find((x) => x.id === p.id);
  assert.equal(
    summary.currentValue,
    summary.cashBalance + summary.equitiesValue + summary.optionsValue,
  );
  ok("Dashboard account totals balance");
  console.log(`\nAll ${passed} API scenarios passed.`);
} finally {
  for (const id of ids) {
    const p = await db.portfolio.findUnique({ where: { id } });
    if (p?.name.startsWith(prefix))
      await db.portfolio.delete({ where: { id } });
  }
  await db.quoteCache.deleteMany({
    where: { symbol: staleSymbol, source: "demo" },
  });
  if (userId)
    await db.user.deleteMany({
      where: { id: userId, email: prefix + "@example.test" },
    });
  await db.$disconnect();
  console.log("Disposable verification portfolios removed.");
}
