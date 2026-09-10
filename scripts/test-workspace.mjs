// Bounded local/demo QA. Creates only disposable profiles, guest workspaces and rows.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
try {
  process.loadEnvFile(".env");
} catch {}
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
for (const value of [base, process.env.DATABASE_URL])
  assert.ok(
    value &&
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname),
    "Loopback app and database required",
  );
const origin = new URL(base).origin,
  prefix = `__qa_workspace_${Date.now()}_${randomUUID().slice(0, 8)}_`;
const db = new PrismaClient(),
  profiles = [],
  guestTokens = new Set(),
  checks = [];
const preferences = {
  theme: "light",
  density: "comfortable",
  privacy: false,
  pinned: [],
  archived: [],
  order: [],
};
class Client {
  constructor(cookie = "") {
    this.jar = new Map(
      cookie
        .split("; ")
        .filter(Boolean)
        .map((part) => {
          const i = part.indexOf("=");
          return [part.slice(0, i), part.slice(i + 1)];
        }),
    );
  }
  cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  guestOnly() {
    return new Client(
      `investor-desk.guest=${this.jar.get("investor-desk.guest")}`,
    );
  }
  async req(path, method = "GET", body, options = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(options.noOrigin ? {} : { Origin: options.origin ?? origin }),
        ...(this.cookie() ? { Cookie: this.cookie() } : {}),
        ...(body === undefined && options.raw === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(options.timeout ?? 75000),
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0],
        i = pair.indexOf("="),
        key = pair.slice(0, i),
        value = pair.slice(i + 1);
      if (!value || /max-age=0(?:;|$)/i.test(raw)) this.jar.delete(key);
      else this.jar.set(key, value);
      if (key === "investor-desk.guest" && value) guestTokens.add(value);
    }
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
    return { status: response.status, data };
  }
}
function ok(result, status = 200) {
  assert.equal(result.status, status, JSON.stringify(result));
  return result.data;
}
const list = async (client) => ok(await client.req("/api/workspace")).entries;
const save = (client, key, value, version = 0) =>
  client.req("/api/workspace", "PUT", { key, value, version });
const note = (title = "Thesis") => ({
  id: randomUUID(),
  holdingId: "",
  symbol: "TSLA",
  title,
  body: "Verified research fixture",
  source: "https://example.com/evidence",
  reviewDate: "2026-12-01",
  revisions: [],
});
const scenario = () => ({
  id: randomUUID(),
  name: "Saved case",
  notes: "Frozen assumptions",
  capturedAt: "2026-09-07T12:00:00.000Z",
  portfolioNames: [],
  cash: 25000,
  assets: [],
  assumptions: { rate: 0.04, iv: null, daysForward: 0 },
});
async function signup(client, label) {
  const email = prefix + label + "@example.invalid";
  profiles.push({ email });
  const data = ok(
    await client.req("/api/auth/sign-up/email", "POST", {
      name: "Workspace QA " + label,
      email,
      password: "Workspace-QA-" + randomUUID(),
    }),
  );
  profiles.at(-1).id = data.user.id;
  return data.user.id;
}
async function check(label, action) {
  await action();
  checks.push(label);
  console.log(JSON.stringify({ check: label, result: "PASS" }));
}
try {
  assert.equal(
    ok(await new Client().req("/api/health")).mode,
    "demo",
    "Demo mode required; no live provider probes",
  );
  // Warm the read-only route before creating fixtures: cold development compilation
  // can exceed the shorter mutation timeout on a busy local workstation.
  ok(
    await new Client().req("/api/workspace", "GET", undefined, {
      timeout: 180000,
    }),
  );
  const guest = new Client(),
    foreign = new Client(),
    firstNote = note(),
    firstScenario = scenario();
  const noteKey = `note:${firstNote.id}`,
    scenarioKey = `scenario:${firstScenario.id}`;
  await check(
    "guest research survives new requests, stays isolated and is reported without portfolios",
    async () => {
      ok(await save(guest, "preferences", { ...preferences, theme: "dark" }));
      ok(await save(guest, noteKey, firstNote));
      ok(await save(guest, scenarioKey, firstScenario));
      assert.equal((await list(new Client(guest.cookie()))).length, 3);
      assert.deepEqual(await list(foreign), []);
      const status = ok(await guest.req("/api/guest"));
      assert.equal(status.portfolioCount, 0);
      assert.equal(status.entryCount, 3);
      assert.equal(
        await db.workspaceEntry.count({
          where: { key: { in: [noteKey, scenarioKey] } },
        }),
        0,
      );
    },
  );
  await check(
    "input validation, body limits and same-origin checks preserve saved data",
    async () => {
      const before = await list(guest);
      for (const bad of [
        { ...firstNote, id: randomUUID() },
        { ...firstNote, source: "javascript:alert(1)" },
        { ...firstNote, title: "" },
      ])
        assert.equal((await save(guest, noteKey, bad, 1)).status, 400);
      assert.equal(
        (await guest.req("/api/workspace", "PUT", undefined, { raw: "{" }))
          .status,
        400,
      );
      assert.equal(
        (
          await guest.req("/api/workspace", "PUT", {
            key: noteKey,
            value: firstNote,
            version: 1,
            padding: "界".repeat(300000),
          })
        ).status,
        413,
      );
      for (const options of [
        { noOrigin: true },
        { origin: "https://untrusted.example" },
      ])
        assert.equal(
          (
            await guest.req(
              "/api/workspace",
              "PUT",
              { key: noteKey, value: firstNote, version: 1 },
              options,
            )
          ).status,
          403,
        );
      assert.deepEqual(await list(guest), before);
    },
  );
  await check(
    "concurrent guest edits accept one version and reject stale deletes",
    async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          save(
            new Client(guest.cookie()),
            noteKey,
            { ...firstNote, body: `Guest accepted edit ${i}` },
            1,
          ),
        ),
      );
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      assert.equal(results.filter((r) => r.status === 409).length, 3);
      const saved = (await list(guest)).find((e) => e.key === noteKey);
      assert.equal(saved.version, 2);
      assert.equal(
        (
          await guest.req("/api/workspace", "DELETE", {
            key: noteKey,
            version: 1,
          })
        ).status,
        409,
      );
    },
  );
  const guestCookie = guest.cookie(),
    accountA = new Client(guestCookie),
    accountB = new Client();
  const userA = await signup(accountA, "a"),
    userB = await signup(accountB, "b");
  await check(
    "research-only import is durable, idempotent and keeps existing account appearance",
    async () => {
      ok(
        await save(accountA, "preferences", {
          ...preferences,
          theme: "system",
        }),
      );
      const first = ok(await accountA.req("/api/guest/import", "POST", {}));
      assert.deepEqual(first.portfolioIds, []);
      assert.equal(first.alreadySaved, false);
      const imported = await list(accountA);
      assert.equal(imported.length, 3);
      assert.equal(
        imported.find((e) => e.key === "preferences").value.theme,
        "system",
      );
      assert.equal(imported.find((e) => e.key === noteKey).version, 2);
      assert.deepEqual(
        imported.find((e) => e.key === scenarioKey).value,
        firstScenario,
      );
      const replay = new Client(accountA.cookie());
      replay.jar.set(
        "investor-desk.guest",
        new Client(guestCookie).jar.get("investor-desk.guest"),
      );
      assert.equal(
        ok(await replay.req("/api/guest/import", "POST", {})).alreadySaved,
        true,
      );
      assert.equal(
        await db.workspaceEntry.count({ where: { userId: userA } }),
        3,
      );
      assert.deepEqual(await list(new Client(guestCookie)), []);
    },
  );
  await check(
    "signed-in ownership cannot be overridden by a guessed key or payload user ID",
    async () => {
      assert.deepEqual(await list(accountB), []);
      assert.equal((await save(accountB, noteKey, firstNote, 2)).status, 409);
      assert.equal(
        (
          await accountB.req("/api/workspace", "DELETE", {
            key: noteKey,
            version: 2,
            userId: userA,
          })
        ).status,
        409,
      );
      ok(
        await accountB.req("/api/workspace", "PUT", {
          key: noteKey,
          value: { ...firstNote, body: "B private note" },
          version: 0,
          userId: userA,
        }),
      );
      assert.equal((await list(accountB))[0].value.body, "B private note");
      assert.notEqual(
        (await list(accountA)).find((e) => e.key === noteKey).value.body,
        "B private note",
      );
      assert.equal(
        await db.workspaceEntry.count({ where: { userId: userB } }),
        1,
      );
    },
  );
  await check(
    "profile concurrent edits, delete and undo persist a coherent accepted value",
    async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          save(
            new Client(accountA.cookie()),
            noteKey,
            { ...firstNote, body: `Profile accepted edit ${i}` },
            2,
          ),
        ),
      );
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      assert.equal(results.filter((r) => r.status === 409).length, 5);
      const accepted = results.find((r) => r.status === 200).data.entry;
      assert.deepEqual(
        (await list(accountA)).find((e) => e.key === noteKey),
        accepted,
      );
      assert.equal(
        (
          await accountA.req("/api/workspace", "DELETE", {
            key: noteKey,
            version: 2,
          })
        ).status,
        409,
      );
      ok(
        await accountA.req("/api/workspace", "DELETE", {
          key: noteKey,
          version: accepted.version,
        }),
      );
      assert.ok(!(await list(accountA)).some((e) => e.key === noteKey));
      ok(await save(accountA, noteKey, accepted.value));
      assert.deepEqual(
        (await list(accountA)).find((e) => e.key === noteKey).value,
        accepted.value,
      );
    },
  );
  await check(
    "colliding research IDs retain both guest and account notes",
    async () => {
      const source = new Client();
      ok(
        await save(source, noteKey, {
          ...firstNote,
          body: "Guest collision preserved",
        }),
      );
      const prior = (await list(accountA)).find((e) => e.key === noteKey);
      const merge = new Client(accountA.cookie());
      merge.jar.set(
        "investor-desk.guest",
        source.jar.get("investor-desk.guest"),
      );
      ok(await merge.req("/api/guest/import", "POST", {}));
      const entries = await list(accountA);
      assert.deepEqual(
        entries.find((e) => e.key === noteKey),
        prior,
      );
      const copied = entries.find(
        (e) => e.value.body === "Guest collision preserved",
      );
      assert.ok(copied);
      assert.notEqual(copied.key, noteKey);
      assert.equal(copied.key, `note:${copied.value.id}`);
    },
  );
  await check(
    "competing final-slot creates cannot exceed the 300-entry profile limit",
    async () => {
      const count = await db.workspaceEntry.count({ where: { userId: userB } });
      await db.workspaceEntry.createMany({
        data: Array.from({ length: 299 - count }, () => {
          const value = note("Capacity fixture");
          return { userId: userB, key: `note:${value.id}`, value };
        }),
      });
      const results = await Promise.all(
        Array.from({ length: 5 }, () => {
          const value = note("Competing last slot");
          return save(new Client(accountB.cookie()), `note:${value.id}`, value);
        }),
      );
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      assert.ok(results.every((r) => [200, 400, 409].includes(r.status)));
      assert.equal(
        await db.workspaceEntry.count({ where: { userId: userB } }),
        300,
      );
    },
  );
  await check(
    "full-profile import leaves guest work intact and succeeds after capacity is freed",
    async () => {
      const source = new Client(),
        research = note("Capacity retry");
      ok(await save(source, `note:${research.id}`, research));
      const portfolio = ok(
        await source.req("/api/portfolios", "POST", {
          name: prefix + "capacity",
          startingCash: 1000,
        }),
        201,
      ).portfolio;
      const merge = new Client(accountB.cookie());
      merge.jar.set(
        "investor-desk.guest",
        source.jar.get("investor-desk.guest"),
      );
      assert.equal(
        (await merge.req("/api/guest/import", "POST", {})).status,
        409,
      );
      assert.equal(
        await db.portfolio.count({ where: { id: portfolio.id } }),
        0,
      );
      assert.equal((await list(source)).length, 1);
      assert.equal(ok(await source.req("/api/guest")).portfolioCount, 1);
      const disposable = (
        await db.workspaceEntry.findMany({
          where: { userId: userB },
          select: { key: true },
        })
      ).find((e) => e.key !== noteKey);
      await db.workspaceEntry.delete({
        where: { userId_key: { userId: userB, key: disposable.key } },
      });
      const result = ok(await merge.req("/api/guest/import", "POST", {}));
      assert.deepEqual(result.portfolioIds, [portfolio.id]);
      assert.equal(
        await db.workspaceEntry.count({ where: { userId: userB } }),
        300,
      );
      assert.deepEqual(
        (await list(accountB)).find((e) => e.key === `note:${research.id}`)
          .value,
        research,
      );
      assert.equal(
        (await db.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } }))
          .userId,
        userB,
      );
    },
  );
  await check(
    "a guest save racing import is either persisted in the profile or explicitly rejected",
    async () => {
      const source = new Client(),
        research = note("Import race"),
        key = `note:${research.id}`;
      ok(await save(source, key, research));
      const merge = new Client(accountA.cookie());
      merge.jar.set(
        "investor-desk.guest",
        source.jar.get("investor-desk.guest"),
      );
      const [edit, imported] = await Promise.all([
        save(
          new Client(source.cookie()),
          key,
          { ...research, body: "Saved during transfer" },
          1,
        ),
        merge.req("/api/guest/import", "POST", {}),
      ]);
      ok(imported);
      assert.ok([200, 409].includes(edit.status));
      const entry = (await list(accountA)).find((e) => e.key === key);
      assert.ok(entry);
      assert.equal(
        entry.value.body,
        edit.status === 200 ? "Saved during transfer" : research.body,
      );
    },
  );
  console.log(
    JSON.stringify({
      summary: {
        passed: checks.length,
        failed: 0,
        mode: "demo",
        profiles: profiles.length,
      },
    }),
  );
} finally {
  const errors = [];
  for (const token of guestTokens) {
    try {
      ok(
        await new Client(`investor-desk.guest=${token}`).req(
          "/api/guest",
          "DELETE",
        ),
      );
    } catch (error) {
      errors.push("Guest cleanup: " + error.message);
    }
  }
  for (const fixture of profiles) {
    try {
      assert.ok(fixture.email.startsWith(prefix));
      const user = await db.user.findUnique({
        where: { email: fixture.email },
        select: { id: true },
      });
      if (!user) continue;
      if (fixture.id) assert.equal(user.id, fixture.id);
      await db.user.delete({ where: { id: user.id } });
      for (const model of [
        db.workspaceEntry,
        db.portfolio,
        db.session,
        db.account,
        db.guestImport,
      ])
        assert.equal(await model.count({ where: { userId: user.id } }), 0);
    } catch (error) {
      errors.push("Profile cleanup: " + error.message);
    }
  }
  const remainingProfiles = profiles.length
    ? await db.user.count({
        where: { email: { in: profiles.map((p) => p.email) } },
      })
    : 0;
  await db.$disconnect();
  console.log(
    JSON.stringify({
      cleanup: {
        remainingProfiles,
        fixtureGuests: guestTokens.size,
        cascadesVerified: errors.length === 0,
        errors,
      },
    }),
  );
  assert.equal(remainingProfiles, 0);
  assert.deepEqual(errors, []);
}
