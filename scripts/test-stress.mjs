// Local demo only. Every database mutation is restricted to this run's disposable fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
try {
  process.loadEnvFile(".env");
} catch {}
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
for (const url of [base, process.env.DATABASE_URL]) {
  assert.ok(
    url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
    "Local app and database required",
  );
}
// Optional JSONL evidence path. Never overwrite an existing report.
const reportPath = process.env.QA_REPORT_PATH
  ? resolve(process.env.QA_REPORT_PATH)
  : null;
if (reportPath) {
  const subpath = relative(resolve("docs/qa"), reportPath);
  assert.ok(
    subpath && !subpath.startsWith(".."),
    "QA_REPORT_PATH must be inside docs/qa",
  );
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, "", { flag: "wx" });
}
function emit(line) {
  console.log(line);
  if (reportPath) appendFileSync(reportPath, line + "\n");
}
const db = new PrismaClient();
const prefix = `__qa_stress_${Date.now()}_${randomUUID().slice(0, 8)}_`;
const symbols = [];
const checks = [];
let cookie = "";
const users = [];
const authEmails = [];
const origin = new URL(base).origin;
async function request(
  path,
  method = "GET",
  body,
  headers = {},
  sessionCookie = cookie,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const setCookie = response.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    await response.body.cancel();
    return { status: response.status, data: { stream: true }, setCookie };
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { nonJson: text.slice(0, 180) };
  }
  const result = { status: response.status, data };
  Object.defineProperty(result, "setCookie", { value: setCookie });
  return result;
}
async function checked(label, run) {
  try {
    const evidence = await run();
    checks.push({ label, result: "PASS", evidence });
  } catch (e) {
    checks.push({ label, result: "FAIL", evidence: e.message });
  }
  emit(JSON.stringify(checks.at(-1)));
}
async function portfolio(label, startingCash = 1000) {
  const r = await request("/api/portfolios", "POST", {
    name: prefix + label,
    startingCash,
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  return r.data.portfolio;
}
async function signup(label) {
  const email = prefix + label + "@example.invalid";
  const password = "QA-fixture-" + randomUUID();
  authEmails.push(email);
  const result = await request(
    "/api/auth/sign-up/email",
    "POST",
    { name: "QA disposable " + label, email, password },
    {},
    "",
  );
  assert.equal(
    result.status,
    200,
    "Auth not ready or signup failed: " +
      result.status +
      " " +
      (result.data.message ?? result.data.error ?? ""),
  );
  assert.ok(result.setCookie, "Signup must return a session cookie");
  users.push({
    id: result.data.user.id,
    email,
    password,
    cookie: result.setCookie,
  });
  return users.at(-1);
}
const buy = (p, extra = {}) => ({
  portfolioId: p.id,
  assetClass: "EQUITY",
  symbol: "TSLA",
  side: "BUY",
  orderType: "MARKET",
  quantity: 1,
  clientOrderId: randomUUID(),
  ...extra,
});
const execute = (t) => request("/api/orders/execute", "POST", t);
const cash = (p) => db.portfolio.findUniqueOrThrow({ where: { id: p.id } });
async function reconcile(p) {
  const current = await cash(p);
  const sum = await db.cashLedgerEntry.aggregate({
    where: { portfolioId: p.id },
    _sum: { amount: true },
  });
  assert.equal(current.cashBalance.toString(), sum._sum.amount.toString());
  assert.ok(current.cashBalance.greaterThanOrEqualTo(0));
  return current.cashBalance.toNumber();
}
try {
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal(
    health.data.mode,
    "demo",
    "No live provider or trading probes are allowed",
  );
  emit(
    JSON.stringify({
      run: prefix,
      mode: "demo",
      started: new Date().toISOString(),
    }),
  );
  const userA = await signup("a");
  const userB = await signup("b");
  cookie = userA.cookie;
  await checked("session belongs to its signed-in profile", async () => {
    const current = await request("/api/auth/get-session");
    assert.equal(current.status, 200);
    assert.equal(current.data.user.id, userA.id);
    const other = await request(
      "/api/auth/get-session",
      "GET",
      undefined,
      {},
      userB.cookie,
    );
    assert.equal(other.data.user.id, userB.id);
  });
  await checked(
    "signed-out collection endpoints return empty data",
    async () => {
      for (const path of ["/api/desk", "/api/portfolios"]) {
        const result = await request(path, "GET", undefined, {}, "");
        assert.equal(result.status, 200);
        assert.deepEqual(result.data.portfolios, []);
        assert.equal(result.data.user, null);
      }
    },
  );
  const owner = await portfolio("auth-owner");
  const ownedOrder = await execute(buy(owner));
  assert.equal(ownedOrder.status, 200);
  const positionId = ownedOrder.data.execution.position.id;
  assert.equal(
    (
      await request("/api/positions/" + positionId + "/target", "PATCH", {
        targetMode: "PRICE",
        targetPrice: 2000,
      })
    ).status,
    200,
  );
  const ownerPaths = [
    ["/api/portfolios/" + owner.id, "GET"],
    ["/api/portfolios/" + owner.id + "/activity", "GET"],
    ["/api/portfolios/" + owner.id + "/projection", "GET"],
    ["/api/positions?portfolioId=" + owner.id, "GET"],
    ["/api/quotes/stream?portfolioId=" + owner.id, "GET"],
    [
      "/api/portfolios/" + owner.id + "/cash",
      "POST",
      { type: "DEPOSIT", amount: 1 },
    ],
    ["/api/orders/preview", "POST", buy(owner)],
    ["/api/orders/execute", "POST", buy(owner)],
    ["/api/quotes/bootstrap", "POST", { portfolioId: owner.id }],
    [
      "/api/positions/" + positionId + "/target",
      "PATCH",
      { targetMode: "PRICE", targetPrice: 1 },
    ],
    ["/api/positions/" + positionId + "/target", "DELETE"],
  ];
  for (const [label, sessionCookie, status] of [
    ["unsigned", "", 401],
    ["cross-profile", userB.cookie, 404],
    [
      "invalid session",
      "better-auth.session_token=qa-not-a-valid-session",
      401,
    ],
  ]) {
    await checked(
      label + ": all per-id read/write and stream endpoints deny access",
      async () => {
        const before = (await cash(owner)).cashBalance.toString();
        for (const [path, method, body] of ownerPaths) {
          const result = await request(path, method, body, {}, sessionCookie);
          assert.equal(
            result.status,
            status,
            method +
              " " +
              path +
              ": " +
              result.status +
              " " +
              JSON.stringify(result.data),
          );
        }
        assert.equal((await cash(owner)).cashBalance.toString(), before);
        assert.equal(
          await db.order.count({ where: { portfolioId: owner.id } }),
          1,
        );
        assert.equal(
          (
            await db.targetScenario.findUniqueOrThrow({ where: { positionId } })
          ).targetPrice.toNumber(),
          2000,
        );
        return { endpoints: ownerPaths.length, status, noMutations: true };
      },
    );
  }
  await checked(
    "profiles only list their own portfolios; legacy unowned rows stay hidden",
    async () => {
      const legacy = await db.portfolio.create({
        data: { name: prefix + "unowned", startingCash: 0, cashBalance: 0 },
      });
      for (const path of ["/api/desk", "/api/portfolios"]) {
        const own = await request(path);
        assert.equal(own.status, 200);
        assert.deepEqual(
          own.data.portfolios.map((p) => p.id),
          [owner.id],
        );
        const foreign = await request(path, "GET", undefined, {}, userB.cookie);
        assert.deepEqual(foreign.data.portfolios, []);
      }
      assert.equal((await request("/api/portfolios/" + legacy.id)).status, 404);
      const spoofed = await request("/api/portfolios", "POST", {
        name: prefix + "spoof-owner",
        startingCash: 1,
        userId: userB.id,
      });
      assert.equal(spoofed.status, 201);
      const stored = await db.portfolio.findUniqueOrThrow({
        where: { id: spoofed.data.portfolio.id },
      });
      assert.equal(stored.userId, userA.id);
    },
  );
  await checked(
    "guest creation stays temporary and missing-Origin mutations are denied",
    async () => {
      const temporary = await request(
        "/api/portfolios",
        "POST",
        { name: prefix + "unsigned", startingCash: 1 },
        {},
        "",
      );
      try {
        assert.equal(temporary.status, 201);
        assert.equal(temporary.data.temporary, true);
        assert.ok(temporary.setCookie.includes("investor-desk.guest="));
        assert.equal(
          await db.portfolio.count({
            where: { id: temporary.data.portfolio.id },
          }),
          0,
        );
      } finally {
        if (temporary.setCookie) {
          const discarded = await request(
            "/api/guest",
            "DELETE",
            undefined,
            {},
            temporary.setCookie,
          );
          assert.equal(discarded.status, 200);
        }
      }
      const result = await fetch(
        base + "/api/portfolios/" + owner.id + "/cash",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ type: "DEPOSIT", amount: 1 }),
          signal: AbortSignal.timeout(15000),
        },
      );
      assert.equal(result.status, 403);
      assert.equal(await reconcile(owner), 679.95);
    },
  );
  await checked(
    "12 simultaneous duplicate submissions debit once",
    async () => {
      const p = await portfolio("replay");
      const ticket = buy(p);
      const results = await Promise.all(
        Array.from({ length: 12 }, () => execute(ticket)),
      );
      assert.deepEqual(
        results.map((r) => r.status),
        Array(12).fill(200),
        JSON.stringify(results),
      );
      assert.equal(
        new Set(results.map((r) => r.data.execution.orderId)).size,
        1,
      );
      assert.equal(await db.order.count({ where: { portfolioId: p.id } }), 1);
      assert.equal(await reconcile(p), 679.95);
      const changed = await execute({ ...ticket, quantity: 2 });
      assert.equal(changed.status, 400);
      return { responses: 12, orders: 1, cash: 679.95 };
    },
  );
  await checked("12 independent buyers cannot overspend", async () => {
    const p = await portfolio("buyers");
    const results = await Promise.all(
      Array.from({ length: 12 }, () => execute(buy(p))),
    );
    assert.equal(
      results.filter((r) => r.status === 200).length,
      3,
      JSON.stringify(results),
    );
    assert.equal(results.filter((r) => r.status === 400).length, 9);
    assert.equal(await reconcile(p), 39.85);
    return { filled: 3, rejected: 9, cash: 39.85 };
  });
  await checked("concurrent withdrawals serialize and reconcile", async () => {
    const p = await portfolio("withdrawals", 1);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(`/api/portfolios/${p.id}/cash`, "POST", {
          type: "WITHDRAWAL",
          amount: 0.33,
        }),
      ),
    );
    assert.equal(
      results.filter((r) => r.status === 200).length,
      3,
      JSON.stringify(results),
    );
    assert.equal(results.filter((r) => r.status === 400).length, 3);
    assert.equal(await reconcile(p), 0.01);
    return { accepted: 3, cash: 0.01 };
  });
  await checked(
    "cash withdrawals and fills share the same balance lock",
    async () => {
      const p = await portfolio("mixed", 400);
      const results = await Promise.all([
        execute(buy(p)),
        request(`/api/portfolios/${p.id}/cash`, "POST", {
          type: "WITHDRAWAL",
          amount: 200,
        }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
      return { cash: await reconcile(p) };
    },
  );
  await checked(
    "partial equity sell preserves basis and full close removes target",
    async () => {
      const p = await portfolio("accounting", 10000);
      const a = await execute(buy(p, { quantity: 3 }));
      assert.equal(a.status, 200);
      const id = a.data.execution.position.id;
      assert.equal(
        (
          await request(`/api/positions/${id}/target`, "PATCH", {
            targetMode: "PRICE",
            targetPrice: 2000,
          })
        ).status,
        200,
      );
      assert.equal(
        (await execute(buy(p, { side: "SELL", quantity: 1 }))).status,
        200,
      );
      const row = await db.position.findUniqueOrThrow({ where: { id } });
      assert.equal(row.quantity.toNumber(), 2);
      assert.equal(row.avgCost.toNumber(), 320.05);
      assert.equal(
        (await execute(buy(p, { side: "SELL", quantity: 2 }))).status,
        200,
      );
      assert.equal(await db.position.count({ where: { id } }), 0);
      assert.equal(
        await db.targetScenario.count({ where: { positionId: id } }),
        0,
      );
      assert.equal(await reconcile(p), 9999.7);
      const pnl = await db.fill.aggregate({
        where: { order: { portfolioId: p.id } },
        _sum: { realizedPnL: true },
      });
      assert.equal(pnl._sum.realizedPnL.toNumber(), -0.3);
      return { cash: 9999.7, realizedPnL: -0.3 };
    },
  );
  await checked("remaining fractional-share dust can be closed", async () => {
    const p = await portfolio("dust");
    assert.equal((await execute(buy(p))).status, 200);
    assert.equal(
      (await execute(buy(p, { side: "SELL", quantity: 0.999999 }))).status,
      200,
    );
    const final = await execute(buy(p, { side: "SELL", quantity: 0.000001 }));
    assert.equal(
      final.status,
      200,
      `Final 0.000001-share liquidation: ${JSON.stringify(final)}`,
    );
  });
  await checked(
    "tiny positive manual shares never silently round to zero",
    async () => {
      const p = await portfolio("tiny-shares");
      const a = await execute(buy(p));
      assert.equal(a.status, 200);
      const id = a.data.execution.position.id;
      const result = await request(`/api/positions/${id}/target`, "PATCH", {
        targetMode: "MARKET_CAP",
        targetMarketCap: 1000,
        useManualShares: true,
        sharesOutstandingManual: 1e-7,
      });
      const stored = await db.targetScenario.findUnique({
        where: { positionId: id },
      });
      assert.ok(
        result.status === 400 ||
          (stored && stored.sharesOutstandingManual.greaterThan(0)),
        `response=${JSON.stringify(result)} storedShares=${stored?.sharesOutstandingManual}`,
      );
    },
  );
  await checked(
    "out-of-range market-cap input returns validation error not 500",
    async () => {
      const p = await portfolio("target-bounds");
      const a = await execute(buy(p));
      assert.equal(a.status, 200);
      const result = await request(
        `/api/positions/${a.data.execution.position.id}/target`,
        "PATCH",
        {
          targetMode: "MARKET_CAP",
          targetMarketCap: 1e20,
          useManualShares: true,
          sharesOutstandingManual: 1e9,
        },
      );
      assert.equal(result.status, 400, JSON.stringify(result));
    },
  );
  await checked(
    "missing provider quote is explicitly estimated and not zeroed",
    async () => {
      const p = await portfolio("missing");
      const symbol = `Q${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
      await db.position.create({
        data: {
          portfolioId: p.id,
          assetClass: "EQUITY",
          symbol,
          quantity: 3,
          avgCost: 10,
        },
      });
      const response = await request(`/api/positions?portfolioId=${p.id}`);
      assert.equal(response.status, 200);
      const q = response.data.positions[0].projection;
      assert.equal(q.currentMarketValue, 30);
      assert.equal(q.priceEstimated, true);
      assert.equal(q.quoteStale, true);
      return { marketValue: 30, priceEstimated: true, quoteStale: true };
    },
  );
  await checked(
    "stale cache timestamp survives snapshot, valuation and SSE",
    async () => {
      const p = await portfolio("stale");
      const symbol = `Q${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
      symbols.push(symbol);
      await db.position.create({
        data: {
          portfolioId: p.id,
          assetClass: "EQUITY",
          symbol,
          quantity: 2,
          avgCost: 10,
        },
      });
      await db.quoteCache.create({
        data: {
          symbol,
          assetClass: "EQUITY",
          source: "demo",
          bid: 7,
          ask: 9,
          mark: 8,
          asOf: new Date("2020-01-01"),
        },
      });
      const response = await request(`/api/positions?portfolioId=${p.id}`);
      assert.equal(response.status, 200);
      assert.equal(
        response.data.positions[0].projection.currentMarketValue,
        16,
      );
      assert.equal(response.data.positions[0].projection.quoteStale, true);
      const snapshot = await request(
        `/api/quotes/snapshot?symbol=${symbol}&assetClass=EQUITY`,
      );
      assert.equal(snapshot.data.quote.asOf, "2020-01-01T00:00:00.000Z");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      let text = "";
      try {
        const stream = await fetch(
          `${base}/api/quotes/stream?portfolioId=${p.id}`,
          {
            headers: cookie ? { Cookie: cookie } : {},
            signal: controller.signal,
          },
        );
        assert.equal(stream.status, 200);
        const reader = stream.body.getReader();
        try {
          while (!text.includes('"stale":true')) {
            const chunk = await reader.read();
            if (chunk.done) break;
            text += new TextDecoder().decode(chunk.value);
          }
        } finally {
          await reader.cancel();
        }
        assert.match(text, /event: ready/);
        assert.match(text, /"stale":true/);
        assert.match(text, /2020-01-01/);
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
      return { asOf: snapshot.data.quote.asOf, stale: true, sseClosed: true };
    },
  );
  await checked(
    "cross-origin and invalid-content writes are rejected without mutation",
    async () => {
      const p = await portfolio("origin");
      const path = `/api/portfolios/${p.id}/cash`;
      assert.equal(
        (
          await request(
            path,
            "POST",
            { type: "DEPOSIT", amount: 1 },
            { Origin: "https://untrusted.example" },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            path,
            "POST",
            { type: "DEPOSIT", amount: 1 },
            { "Content-Type": "text/plain" },
          )
        ).status,
        415,
      );
      assert.equal(await reconcile(p), 1000);
    },
  );
  await checked("malformed JSON is a client error", async () => {
    const response = await fetch(base + "/api/portfolios", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: "{",
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(
      response.status,
      400,
      `status=${response.status} body=${await response.text()}`,
    );
  });
  await checked(
    "unsupported and invalid quantities produce no accounting changes",
    async () => {
      const p = await portfolio("invalid");
      for (const extra of [
        { quantity: 0 },
        { quantity: -1 },
        { quantity: 1e10 },
        { quantity: 1e-7 },
        { symbol: "NOQAFOUND" },
        { side: "SELL", quantity: 1 },
      ]) {
        const result = await execute(buy(p, extra));
        assert.equal(result.status, 400, JSON.stringify(result));
      }
      assert.equal(await db.order.count({ where: { portfolioId: p.id } }), 0);
      assert.equal(await reconcile(p), 1000);
    },
  );
  await checked(
    "sign-out invalidates the old cookie and sign-in creates a working new session",
    async () => {
      const oldCookie = cookie;
      const signedOut = await request("/api/auth/sign-out", "POST", {});
      assert.equal(signedOut.status, 200);
      assert.equal(
        (
          await request(
            "/api/portfolios/" + owner.id,
            "GET",
            undefined,
            {},
            oldCookie,
          )
        ).status,
        401,
      );
      const wrong = await request(
        "/api/auth/sign-in/email",
        "POST",
        { email: userA.email, password: "QA-wrong-password-123" },
        {},
        "",
      );
      assert.equal(wrong.status, 401);
      const signedIn = await request(
        "/api/auth/sign-in/email",
        "POST",
        { email: userA.email, password: userA.password },
        {},
        "",
      );
      assert.equal(signedIn.status, 200);
      assert.ok(signedIn.setCookie);
      cookie = signedIn.setCookie;
      assert.equal((await request("/api/portfolios/" + owner.id)).status, 200);
    },
  );
  emit(
    JSON.stringify({
      summary: {
        passed: checks.filter((x) => x.result === "PASS").length,
        failed: checks.filter((x) => x.result === "FAIL").length,
        checks: checks.length,
      },
    }),
  );
  if (checks.some((x) => x.result === "FAIL")) process.exitCode = 1;
} finally {
  const fixtures = await db.portfolio.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true, name: true },
  });
  for (const p of fixtures) {
    assert.ok(p.name.startsWith(prefix));
    await db.portfolio.delete({ where: { id: p.id } });
  }
  for (const symbol of symbols)
    await db.quoteCache.deleteMany({
      where: { symbol, source: "demo", assetClass: "EQUITY" },
    });
  const remaining = await db.portfolio.count({
    where: { name: { startsWith: prefix } },
  });
  emit(
    JSON.stringify({
      cleanup: {
        fixturesDeleted: fixtures.length,
        remaining,
        cacheRowsDeleted: symbols.length,
      },
    }),
  );
  let deletedUsers = 0;
  for (const email of authEmails) {
    assert.ok(email.startsWith(prefix));
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) continue;
    await db.user.delete({ where: { id: user.id } });
    assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
    assert.equal(await db.account.count({ where: { userId: user.id } }), 0);
    deletedUsers++;
  }
  emit(
    JSON.stringify({
      authCleanup: {
        deletedUsers,
        remaining: await db.user.count({
          where: { email: { in: authEmails } },
        }),
        sessionsAndAccountsCascaded: true,
      },
    }),
  );
  await db.$disconnect();
  assert.equal(remaining, 0);
}
