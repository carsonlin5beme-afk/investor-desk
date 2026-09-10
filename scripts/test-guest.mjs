// Bounded, loopback/demo-only guest QA. No real trades or existing user portfolio writes.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
try {
  process.loadEnvFile(".env");
} catch {}
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
for (const url of [base, process.env.DATABASE_URL])
  assert.ok(
    url && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
    "Local app and database required",
  );
const origin = new URL(base).origin;
// Slow cold compilation can exceed normal API response limits on a busy dev machine.
const requestTimeout = Number(process.env.QA_REQUEST_TIMEOUT_MS ?? 75000);
assert.ok(
  Number.isInteger(requestTimeout) &&
    requestTimeout >= 1000 &&
    requestTimeout <= 300000,
  "QA_REQUEST_TIMEOUT_MS must be between 1000 and 300000",
);
const prefix = `__qa_guest_${Date.now()}_${randomUUID().slice(0, 8)}_`;
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
const safe = (data) =>
  JSON.stringify(data, (key, value) =>
    /^(cookie|setCookie|password|token)$/i.test(key) ? "[redacted]" : value,
  );
function emit(data) {
  const line = safe(data);
  console.log(line);
  if (reportPath) appendFileSync(reportPath, line + "\n");
}
const db = new PrismaClient();
const profiles = [],
  emails = [],
  guests = [],
  portfolioIds = new Set(),
  checks = [];
const GUEST = "investor-desk.guest";
class Client {
  constructor(cookie = "") {
    this.jar = new Map(
      cookie
        .split("; ")
        .filter(Boolean)
        .map((s) => {
          const i = s.indexOf("=");
          return [s.slice(0, i), s.slice(i + 1)];
        }),
    );
  }
  cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  guestCookie() {
    const token = this.jar.get(GUEST);
    return token ? `${GUEST}=${token}` : "";
  }
  async req(path, method = "GET", body, options = {}) {
    const headers = {
      ...(options.noOrigin ? {} : { Origin: options.origin ?? origin }),
      ...(body === undefined && options.raw === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(this.cookie() ? { Cookie: this.cookie() } : {}),
      ...options.headers,
    };
    const response = await fetch(base + path, {
      method,
      headers,
      body:
        options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(requestTimeout),
    });
    const cookies = response.headers.getSetCookie();
    for (const raw of cookies) {
      const pair = raw.split(";")[0],
        i = pair.indexOf("="),
        key = pair.slice(0, i),
        value = pair.slice(i + 1);
      if (!value || /max-age=0(?:;|$)/i.test(raw)) this.jar.delete(key);
      else this.jar.set(key, value);
    }
    let data;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      await response.body.cancel();
      data = { stream: true };
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { nonJson: text.slice(0, 120) };
      }
    }
    const result = { status: response.status, data };
    Object.defineProperty(result, "setCookie", { value: cookies });
    return result;
  }
}
const responseOk = (r, status = 200) => {
  assert.equal(r.status, status, safe(r));
  return r.data;
};
async function checked(label, fn) {
  try {
    const evidence = await fn();
    checks.push({ label, result: "PASS", evidence });
  } catch (error) {
    checks.push({ label, result: "FAIL", evidence: error.message });
  }
  emit(checks.at(-1));
}
async function newGuest(label, cash = 1000) {
  const client = new Client();
  const result = await client.req("/api/portfolios", "POST", {
    name: prefix + label,
    startingCash: cash,
  });
  // Track even failed requests that issued a guest cookie, so finally can discard them.
  guests.push(client.guestCookie());
  const data = responseOk(result, 201);
  assert.equal(data.temporary, true);
  assert.ok(client.guestCookie());
  assert.ok(
    result.setCookie.some(
      (c) =>
        c.startsWith(GUEST + "=") &&
        /httponly/i.test(c) &&
        /samesite=lax/i.test(c) &&
        /path=\//i.test(c),
    ),
  );
  portfolioIds.add(data.portfolio.id);
  return { client, p: data.portfolio, cookie: client.guestCookie() };
}
async function createPortfolio(client, label, cash = 1000) {
  const data = responseOk(
    await client.req("/api/portfolios", "POST", {
      name: prefix + label,
      startingCash: cash,
    }),
    201,
  );
  portfolioIds.add(data.portfolio.id);
  return data.portfolio;
}
async function signup(client, label) {
  const email = prefix + label + "@example.invalid",
    password = "QA-guest-fixture-" + randomUUID();
  emails.push(email);
  const r = await client.req("/api/auth/sign-up/email", "POST", {
    name: "QA guest " + label,
    email,
    password,
  });
  assert.equal(
    r.status,
    200,
    "Signup failed: " + r.status + " " + (r.data.message ?? ""),
  );
  const profile = {
    id: r.data.user.id,
    email,
    password,
    cookie: client.cookie(),
  };
  profiles.push(profile);
  return profile;
}
const ticket = (p, extra = {}) => ({
  portfolioId: p.id,
  assetClass: "EQUITY",
  symbol: "TSLA",
  side: "BUY",
  quantity: 1,
  orderType: "MARKET",
  clientOrderId: randomUUID(),
  ...extra,
});
const execute = (client, t) => client.req("/api/orders/execute", "POST", t);
const cashAdjust = (client, p, amount, type = "DEPOSIT", extra = {}) =>
  client.req(`/api/portfolios/${p.id}/cash`, "POST", {
    type,
    amount,
    note: prefix + "cash",
    ...extra,
  });
const hash = (cookie) =>
  createHash("sha256").update(new Client(cookie).jar.get(GUEST)).digest("hex");
async function noDatabaseRows(ids = [...portfolioIds]) {
  const counts = {
    portfolios: await db.portfolio.count({
      where: { OR: [{ id: { in: ids } }, { name: { startsWith: prefix } }] },
    }),
    positions: await db.position.count({ where: { portfolioId: { in: ids } } }),
    orders: await db.order.count({ where: { portfolioId: { in: ids } } }),
    fills: await db.fill.count({
      where: { order: { portfolioId: { in: ids } } },
    }),
    ledger: await db.cashLedgerEntry.count({
      where: { portfolioId: { in: ids } },
    }),
    receipts: await db.guestImport.count({
      where: { tokenHash: { in: guests.filter(Boolean).map(hash) } },
    }),
  };
  assert.ok(
    Object.values(counts).every((v) => v === 0),
    safe(counts),
  );
  return counts;
}
async function snapshot(client, p) {
  const activity = responseOk(
    await client.req(`/api/portfolios/${p.id}/activity`),
  );
  const positions = responseOk(
    await client.req(`/api/positions?portfolioId=${p.id}`),
  ).positions;
  const view = responseOk(
    await client.req(`/api/portfolios/${p.id}`),
  ).portfolio;
  return { activity, positions, view };
}
// Isolation protects stored state. Quotes and option projections are allowed to
// refresh while the denied-route sweep runs, so do not mistake freshness for a write.
function persistedSnapshot(value) {
  const { id, name, baseCurrency, startingCash, cashBalance, positionCount } =
    value.view;
  return {
    activity: value.activity,
    positions: value.positions.map(({ projection, ...position }) => position),
    portfolio: {
      id,
      name,
      baseCurrency,
      startingCash,
      cashBalance,
      positionCount,
    },
  };
}
async function reconcileDB(id) {
  const p = await db.portfolio.findUniqueOrThrow({ where: { id } });
  const sum = await db.cashLedgerEntry.aggregate({
    where: { portfolioId: id },
    _sum: { amount: true },
  });
  assert.equal(p.cashBalance.toString(), sum._sum.amount.toString());
  assert.ok(p.cashBalance.greaterThanOrEqualTo(0));
  return p.cashBalance.toNumber();
}
async function assertImported(p, before, ownerId) {
  const actual = await db.portfolio.findUniqueOrThrow({
    where: { id: p.id },
    include: {
      positions: { include: { targetScenario: true, optionDetails: true } },
      orders: { include: { fills: true } },
      cashLedgerEntries: true,
    },
  });
  assert.equal(actual.userId, ownerId);
  assert.equal(actual.name, before.view.name);
  assert.equal(actual.startingCash.toNumber(), before.view.startingCash);
  assert.equal(actual.cashBalance.toNumber(), before.view.cashBalance);
  assert.equal(await reconcileDB(p.id), before.view.cashBalance);
  for (const row of before.positions) {
    const found = actual.positions.find((x) => x.id === row.id);
    assert.ok(found, "Position ID preserved");
    for (const field of ["quantity", "avgCost"])
      assert.equal(found[field].toString(), String(row[field]));
    for (const field of ["targetScenario", "optionDetails"])
      assert.deepEqual(JSON.parse(JSON.stringify(found[field])), row[field]);
  }
  assert.equal(actual.positions.length, before.positions.length);
  for (const order of before.activity.orders) {
    const found = actual.orders.find((o) => o.id === order.id);
    assert.ok(found, "Order ID preserved");
    const raw = JSON.parse(JSON.stringify(found));
    const { clientOrderId: oldKey, ...expected } = order;
    const { clientOrderId: newKey, ...received } = raw;
    if (oldKey)
      assert.notEqual(newKey, oldKey, "Guest client retry UUID is remapped");
    assert.deepEqual(received, expected, "Order and fill details preserved");
  }
  const ledger = new Map(
    actual.cashLedgerEntries.map((l) => [l.id, JSON.parse(JSON.stringify(l))]),
  );
  for (const row of before.activity.ledger)
    assert.deepEqual(ledger.get(row.id), row);
  return actual;
}
try {
  const health = responseOk(await new Client().req("/api/health"));
  assert.equal(
    health.mode,
    "demo",
    "Demo mode required; no live provider probes",
  );
  emit({ run: prefix, started: new Date().toISOString(), mode: health.mode });
  const A = await newGuest("a-main", 10000),
    B = await newGuest("b-main", 500),
    C = await newGuest("discard", 250);
  const longHistory = await createPortfolio(A.client, "a-long-history", 0);
  const sharedRetryId = randomUUID();
  let aPosition;
  await checked(
    "guests build, preview, trade equities/options and set targets without database financial rows",
    async () => {
      const t = ticket(A.p, { quantity: 10, clientOrderId: sharedRetryId });
      const preview = responseOk(
        await A.client.req("/api/orders/preview", "POST", t),
      );
      assert.equal(preview.preview.estimatedNotional, 3200.5);
      assert.equal((await snapshot(A.client, A.p)).activity.orders.length, 0);
      const fill = responseOk(await execute(A.client, t));
      aPosition = fill.execution.position.id;
      responseOk(await cashAdjust(A.client, A.p, 123.45));
      responseOk(await cashAdjust(A.client, A.p, 23.45, "WITHDRAWAL"));
      responseOk(
        await execute(A.client, ticket(A.p, { side: "SELL", quantity: 3 })),
      );
      responseOk(
        await A.client.req(`/api/positions/${aPosition}/target`, "PATCH", {
          targetMode: "PRICE",
          targetPrice: 2000,
        }),
      );
      const expirations = responseOk(
        await A.client.req("/api/options/expirations?symbol=BTG"),
      ).expirations;
      const chain = responseOk(
        await A.client.req(
          `/api/options/chain?symbol=BTG&expiration=${expirations[2]}&right=CALL`,
        ),
      ).contracts;
      const c = chain.find((x) => x.strike === 5);
      assert.ok(c);
      const option = ticket(A.p, {
        assetClass: "OPTION",
        symbol: "BTG",
        quantity: 4,
        optionContractSymbol: c.contractSymbol,
        optionStrike: c.strike,
        optionRight: c.right,
        optionExpiration: c.expiration,
      });
      const bought = responseOk(await execute(A.client, option));
      responseOk(
        await execute(A.client, {
          ...option,
          side: "SELL",
          quantity: 1,
          clientOrderId: randomUUID(),
        }),
      );
      responseOk(
        await A.client.req(
          `/api/positions/${bought.execution.position.id}/target`,
          "PATCH",
          {
            targetMode: "MARKET_CAP",
            targetMarketCap: 50e9,
            useManualShares: true,
            sharesOutstandingManual: 1.35e9,
          },
        ),
      );
      const before = await snapshot(A.client, A.p);
      assert.equal(before.view.cashBalance, 7308.35);
      const optionPosition = before.positions.find(
        (x) => x.assetClass === "OPTION",
      );
      assert.equal(optionPosition.quantity, 3);
      assert.equal(optionPosition.optionDetails.contracts, 3);
      const independent = responseOk(
        await execute(
          B.client,
          ticket(B.p, { symbol: "NVDA", clientOrderId: sharedRetryId }),
        ),
      );
      assert.ok(independent.execution.orderId);
      return await noDatabaseRows();
    },
  );
  await checked(
    "guest cookies isolate every per-id read, write and stream route",
    async () => {
      assert.ok(aPosition);
      const probes = [
        [`/api/portfolios/${A.p.id}`, "GET"],
        [
          `/api/portfolios/${A.p.id}`,
          "PATCH",
          { name: prefix + "forbidden-rename" },
        ],
        [`/api/portfolios/${A.p.id}/activity`, "GET"],
        [`/api/portfolios/${A.p.id}/projection`, "GET"],
        [`/api/positions?portfolioId=${A.p.id}`, "GET"],
        [`/api/quotes/stream?portfolioId=${A.p.id}`, "GET"],
        [
          `/api/portfolios/${A.p.id}/cash`,
          "POST",
          { type: "DEPOSIT", amount: 1 },
        ],
        ["/api/orders/preview", "POST", ticket(A.p)],
        ["/api/orders/execute", "POST", ticket(A.p)],
        ["/api/quotes/bootstrap", "POST", { portfolioId: A.p.id }],
        [
          `/api/positions/${aPosition}/target`,
          "PATCH",
          { targetMode: "PRICE", targetPrice: 1 },
        ],
        [`/api/positions/${aPosition}/target`, "DELETE"],
      ];
      const before = await snapshot(A.client, A.p);
      for (const [path, method, body] of probes)
        assert.equal(
          (await B.client.req(path, method, body)).status,
          404,
          `${method} ${path}`,
        );
      assert.equal(
        (await new Client().req(`/api/portfolios/${A.p.id}`)).status,
        401,
      );
      assert.deepEqual(
        persistedSnapshot(await snapshot(A.client, A.p)),
        persistedSnapshot(before),
      );
      const mine = responseOk(await A.client.req("/api/desk"));
      assert.deepEqual(
        new Set(mine.portfolios.map((p) => p.id)),
        new Set([A.p.id, longHistory.id]),
      );
      assert.equal(
        responseOk(await B.client.req("/api/guest")).portfolioCount,
        1,
      );
      return { deniedRoutes: probes.length, noOwnerMutations: true };
    },
  );
  await checked(
    "payload tampering, malformed cookie and CSRF cannot alter another guest or import",
    async () => {
      const before = await snapshot(A.client, A.p);
      for (const rawCookie of [
        `${GUEST}=not-valid`,
        `${GUEST}=${"0".repeat(64)}`,
      ]) {
        const forged = new Client(rawCookie);
        assert.deepEqual(
          responseOk(await forged.req("/api/portfolios")).portfolios,
          [],
        );
        assert.equal(
          (await forged.req(`/api/portfolios/${A.p.id}`)).status,
          401,
        );
      }
      assert.equal(
        (
          await A.client.req("/api/guest/import", "POST", {
            userId: "spoof",
            portfolioIds: [A.p.id],
          })
        ).status,
        401,
      );
      for (const [path, method, body] of [
        [
          `/api/portfolios/${A.p.id}/cash`,
          "POST",
          { type: "DEPOSIT", amount: 1 },
        ],
        ["/api/guest", "DELETE", undefined],
        ["/api/guest/import", "POST", {}],
      ]) {
        assert.equal(
          (
            await A.client.req(path, method, body, {
              origin: "https://untrusted.example",
            })
          ).status,
          403,
        );
        assert.equal(
          (await A.client.req(path, method, body, { noOrigin: true })).status,
          403,
        );
      }
      assert.equal((await cashAdjust(A.client, A.p, -1)).status, 400);
      assert.equal(
        (
          await execute(
            A.client,
            ticket(A.p, { quantity: 0, portfolioId: B.p.id }),
          )
        ).status,
        400,
      );
      assert.deepEqual(
        persistedSnapshot(await snapshot(A.client, A.p)),
        persistedSnapshot(before),
      );
      return await noDatabaseRows();
    },
  );
  await checked(
    "discard removes only the caller's guest workspace and clears its cookie",
    async () => {
      const discarded = responseOk(
        await C.client.req("/api/guest", "DELETE", {
          portfolioIds: [A.p.id],
          userId: "spoof",
        }),
      );
      assert.equal(discarded.ok, true);
      assert.equal(C.client.guestCookie(), "");
      assert.deepEqual(
        responseOk(await new Client(C.cookie).req("/api/portfolios"))
          .portfolios,
        [],
      );
      assert.equal(
        responseOk(await A.client.req("/api/guest")).portfolioCount,
        2,
      );
      assert.equal(
        responseOk(await B.client.req("/api/guest")).portfolioCount,
        1,
      );
    },
  );
  await checked(
    "121-row guest cash history stays in RAM beyond UI history caps",
    async () => {
      for (let start = 0; start < 110; start += 8) {
        const results = await Promise.all(
          Array.from({ length: Math.min(8, 110 - start) }, () =>
            cashAdjust(A.client, longHistory, 0.01),
          ),
        );
        results.forEach((r) => responseOk(r));
      }
      for (let i = 0; i < 10; i++)
        responseOk(await cashAdjust(A.client, longHistory, 0.01, "WITHDRAWAL"));
      const before = await snapshot(A.client, longHistory);
      assert.equal(before.view.cashBalance, 1);
      assert.equal(before.activity.ledger.length, 100);
      return {
        expectedFullLedger: 121,
        visibleLedger: 100,
        cash: 1,
        database: await noDatabaseRows(),
      };
    },
  );
  const beforeA = await snapshot(A.client, A.p),
    beforeLong = await snapshot(A.client, longHistory),
    beforeB = await snapshot(B.client, B.p);
  const profileA = await signup(A.client, "profile-a"),
    profileB = await signup(B.client, "profile-b");
  const authA = A.client.cookie(),
    authB = B.client.cookie();
  await checked(
    "signup itself creates no portfolio financial rows before import",
    async () => await noDatabaseRows(),
  );
  await checked(
    "six concurrent signup-transfer imports preserve the whole workspace once",
    async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          new Client(authA).req("/api/guest/import", "POST", {
            portfolios: [{ name: prefix + "injected", cashBalance: 1e9 }],
            userId: profileB.id,
          }),
        ),
      );
      results.forEach((r) => {
        const d = responseOk(r);
        assert.deepEqual(
          new Set(d.portfolioIds),
          new Set([A.p.id, longHistory.id]),
        );
      });
      assert.equal(results.filter((r) => !r.data.alreadySaved).length, 1);
      await assertImported(A.p, beforeA, profileA.id);
      await assertImported(longHistory, beforeLong, profileA.id);
      assert.equal(
        await db.cashLedgerEntry.count({
          where: { portfolioId: longHistory.id },
        }),
        121,
      );
      assert.equal(
        await db.guestImport.count({ where: { tokenHash: hash(A.cookie) } }),
        1,
      );
      assert.equal(
        await db.portfolio.count({ where: { name: prefix + "injected" } }),
        0,
      );
      assert.equal(
        responseOk(await new Client(A.cookie).req("/api/guest")).portfolioCount,
        0,
      );
      return {
        createdImports: 1,
        retries: 5,
        portfolios: 2,
        fullLedgerRows: 121,
        IDsAndHistoryPreserved: true,
      };
    },
  );
  await checked(
    "import receipt survives guest discard and rejects another authenticated user",
    async () => {
      const foreign = new Client(authB);
      foreign.jar.set(GUEST, new Client(A.cookie).jar.get(GUEST));
      assert.equal(
        (await foreign.req("/api/guest/import", "POST", {})).status,
        409,
      );
      responseOk(await new Client(A.cookie).req("/api/guest", "DELETE"));
      const replay = responseOk(
        await new Client(authA).req("/api/guest/import", "POST", {}),
      );
      assert.equal(replay.alreadySaved, true);
      assert.deepEqual(
        new Set(replay.portfolioIds),
        new Set([A.p.id, longHistory.id]),
      );
      assert.equal(
        await db.portfolio.count({ where: { userId: profileA.id } }),
        2,
      );
    },
  );
  await checked(
    "signing into an existing profile merges guest holdings without replacing saved portfolios",
    async () => {
      const saved = await createPortfolio(B.client, "existing-saved", 1555);
      const prior = JSON.stringify(
        await db.portfolio.findUniqueOrThrow({
          where: { id: saved.id },
          include: { cashLedgerEntries: true },
        }),
      );
      responseOk(await B.client.req("/api/auth/sign-out", "POST", {}));
      const signedIn = await B.client.req("/api/auth/sign-in/email", "POST", {
        email: profileB.email,
        password: profileB.password,
      });
      assert.equal(signedIn.status, 200);
      const result = responseOk(
        await B.client.req("/api/guest/import", "POST", {}),
      );
      assert.deepEqual(result.portfolioIds, [B.p.id]);
      assert.equal(B.client.guestCookie(), "");
      await assertImported(B.p, beforeB, profileB.id);
      assert.equal(
        JSON.stringify(
          await db.portfolio.findUniqueOrThrow({
            where: { id: saved.id },
            include: { cashLedgerEntries: true },
          }),
        ),
        prior,
      );
      assert.equal(
        await db.portfolio.count({ where: { userId: profileB.id } }),
        2,
      );
      return {
        existingCash: 1555,
        mergedCash: beforeB.view.cashBalance,
        savedPortfolioUnchanged: true,
      };
    },
  );
  await checked(
    "concurrent trades, cash changes and imports never lose a successful mutation",
    async () => {
      const R = await newGuest("race", 1000);
      const account = new Client(authA);
      account.jar.set(GUEST, new Client(R.cookie).jar.get(GUEST));
      const actions = [
        execute(new Client(R.cookie), ticket(R.p)),
        execute(new Client(R.cookie), ticket(R.p)),
        new Client(account.cookie()).req("/api/guest/import", "POST", {}),
        cashAdjust(new Client(R.cookie), R.p, 50, "WITHDRAWAL"),
        execute(new Client(R.cookie), ticket(R.p)),
        new Client(account.cookie()).req("/api/guest/import", "POST", {}),
        execute(new Client(R.cookie), ticket(R.p)),
        cashAdjust(new Client(R.cookie), R.p, 10),
        new Client(account.cookie()).req("/api/guest/import", "POST", {}),
      ];
      const results = await Promise.all(actions);
      for (const i of [2, 5, 8]) responseOk(results[i]);
      const trades = [0, 1, 4, 6].map((i) => results[i]);
      for (const r of [...trades, results[3], results[7]])
        assert.ok([200, 400, 401, 409].includes(r.status), safe(r));
      const filled = trades.filter((r) => r.status === 200);
      const orders = await db.order.findMany({
        where: { portfolioId: R.p.id },
      });
      assert.deepEqual(
        new Set(orders.map((o) => o.id)),
        new Set(filled.map((r) => r.data.execution.orderId)),
      );
      const expected =
        Math.round(
          (1000 -
            320.05 * filled.length -
            (results[3].status === 200 ? 50 : 0) +
            (results[7].status === 200 ? 10 : 0)) *
            100,
        ) / 100;
      assert.equal(await reconcileDB(R.p.id), expected);
      return {
        acceptedTrades: filled.length,
        cash: expected,
        imports: 3,
        statuses: results.map((r) => r.status),
      };
    },
  );
  await checked(
    "failed import rolls back every new row, retains RAM, and succeeds after removing a QA-only collision",
    async () => {
      const F = await newGuest("rollback-first", 111);
      const second = await createPortfolio(F.client, "rollback-second", 222);
      await db.portfolio.create({
        data: {
          id: second.id,
          userId: profileA.id,
          name: prefix + "collision",
          startingCash: 0,
          cashBalance: 0,
        },
      });
      const account = new Client(authA);
      account.jar.set(GUEST, new Client(F.cookie).jar.get(GUEST));
      try {
        const failed = await account.req("/api/guest/import", "POST", {});
        assert.equal(failed.status, 503, safe(failed));
        assert.ok(
          account.guestCookie(),
          "Failed import must retain cookie for retry",
        );
        assert.equal(
          await db.portfolio.count({ where: { id: F.p.id } }),
          0,
          "First created portfolio rolled back",
        );
        assert.equal(
          await db.guestImport.count({ where: { tokenHash: hash(F.cookie) } }),
          0,
        );
        assert.equal(
          responseOk(await F.client.req("/api/guest")).portfolioCount,
          2,
        );
        const collision = await db.portfolio.findUniqueOrThrow({
          where: { id: second.id },
        });
        assert.equal(collision.name, prefix + "collision");
      } finally {
        const row = await db.portfolio.findUnique({ where: { id: second.id } });
        if (row?.name === prefix + "collision" && row.userId === profileA.id)
          await db.portfolio.delete({ where: { id: second.id } });
      }
      const retry = responseOk(
        await account.req("/api/guest/import", "POST", {}),
      );
      assert.deepEqual(
        new Set(retry.portfolioIds),
        new Set([F.p.id, second.id]),
      );
      assert.equal(await reconcileDB(F.p.id), 111);
      assert.equal(await reconcileDB(second.id), 222);
      return {
        rollbackVerified: true,
        retainedGuestPortfolios: 2,
        retrySaved: 2,
      };
    },
  );
  emit({
    summary: {
      passed: checks.filter((x) => x.result === "PASS").length,
      failed: checks.filter((x) => x.result === "FAIL").length,
      checks: checks.length,
    },
  });
  if (checks.some((x) => x.result === "FAIL")) process.exitCode = 1;
} finally {
  const errors = [];
  for (const cookie of new Set(guests.filter(Boolean))) {
    try {
      const r = await new Client(cookie).req("/api/guest", "DELETE");
      assert.equal(r.status, 200);
    } catch (e) {
      errors.push("Guest discard: " + e.message);
    }
  }
  for (const email of emails) {
    try {
      assert.ok(email.startsWith(prefix));
      const user = await db.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!user) continue;
      const expected = profiles.find((p) => p.email === email);
      if (expected) assert.equal(user.id, expected.id);
      await db.user.delete({ where: { id: user.id } });
      for (const model of [
        db.portfolio,
        db.session,
        db.account,
        db.guestImport,
      ])
        assert.equal(await model.count({ where: { userId: user.id } }), 0);
    } catch (e) {
      errors.push("Profile cleanup: " + e.message);
    }
  }
  const remainingUsers = await db.user.count({
    where: { email: { in: emails } },
  });
  const remainingPortfolios = await db.portfolio.count({
    where: {
      OR: [{ id: { in: [...portfolioIds] } }, { name: { startsWith: prefix } }],
    },
  });
  emit({
    cleanup: {
      guestWorkspacesDiscarded: new Set(guests.filter(Boolean)).size,
      disposableProfiles: profiles.length,
      remainingUsers,
      remainingPortfolios,
      profileCascadesVerified: errors.length === 0,
      errors,
    },
  });
  await db.$disconnect();
  assert.equal(remainingUsers, 0);
  assert.equal(remainingPortfolios, 0);
  assert.deepEqual(errors, []);
}
