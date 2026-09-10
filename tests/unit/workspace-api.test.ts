import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  currentProfile: vi.fn(),
  guestIdentity: vi.fn(),
  guestCookie: vi.fn(),
  workspaceEntry: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    deleteMany: vi.fn(),
  },
  transaction: vi.fn(),
}));
vi.mock("@/server/auth/access", () => ({
  currentProfile: mocks.currentProfile,
}));
vi.mock("@/server/guest/http", () => ({
  guestIdentity: mocks.guestIdentity,
  guestCookie: mocks.guestCookie,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspaceEntry: mocks.workspaceEntry,
    $transaction: mocks.transaction,
  },
}));
import { GET, PUT, DELETE } from "@/app/api/workspace/route";
import { createGuest, discardGuest, guestKey } from "@/server/guest/store";
import { defaultPreferences } from "@/lib/studio";
const keys: string[] = [];
const input = (version = 0, value = defaultPreferences) => ({
  key: "preferences",
  version,
  value,
});
const request = (body: unknown, method = "PUT") =>
  new Request("http://localhost/api/workspace", {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const databaseError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(
    "Private database connection detail",
    { code, clientVersion: "5.22.0" },
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.currentProfile.mockResolvedValue(null);
  mocks.guestIdentity.mockResolvedValue({ state: null });
  mocks.guestCookie.mockImplementation((response, token) => {
    keys.push(guestKey(token)!);
    return response;
  });
  mocks.transaction.mockImplementation((callback) =>
    callback({ workspaceEntry: mocks.workspaceEntry }),
  );
});
afterEach(() => {
  for (const key of keys.splice(0)) discardGuest(key);
});
function activeGuest() {
  const guest = createGuest();
  keys.push(guest.state.key);
  mocks.guestIdentity.mockResolvedValue(guest);
  return guest.state;
}
describe("workspace route", () => {
  it("starts empty and creates a guest workspace for the first research or appearance save", async () => {
    expect(await (await GET()).json()).toEqual({
      entries: [],
      temporary: true,
    });
    const response = await PUT(request(input()));
    expect(response.status).toBe(200);
    expect((await response.json()).entry).toMatchObject({
      key: "preferences",
      version: 1,
      value: defaultPreferences,
    });
    expect(mocks.guestCookie).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("serializes competing guest editors and preserves the accepted version", async () => {
    const state = activeGuest();
    expect((await PUT(request(input()))).status).toBe(200);
    const results = await Promise.all([
      PUT(request(input(1, { ...defaultPreferences, theme: "dark" }))),
      PUT(request(input(1, { ...defaultPreferences, theme: "system" }))),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(state.entries?.preferences.version).toBe(2);
    const accepted = await results.find((r) => r.status === 200)!.json();
    expect(state.entries?.preferences).toEqual(accepted.entry);
    expect((await DELETE(request(input(1), "DELETE"))).status).toBe(409);
    expect((await DELETE(request(input(2), "DELETE"))).status).toBe(200);
    expect((await DELETE(request(input(0), "DELETE"))).status).toBe(409);
  });
  it("isolates guest reads and refuses stale versions without recreating discarded work", async () => {
    activeGuest();
    await PUT(request(input()));
    activeGuest();
    expect((await (await GET()).json()).entries).toEqual([]);
    expect((await PUT(request(input(1)))).status).toBe(409);
    mocks.guestIdentity.mockResolvedValue({ state: null });
    expect((await PUT(request(input(1)))).status).toBe(409);
    expect(mocks.guestCookie).not.toHaveBeenCalled();
  });
  it("rejects invalid data before creating or mutating any workspace", async () => {
    const state = activeGuest();
    for (const body of [
      null,
      {},
      { ...input(), key: "user:private" },
      input(-1),
      input(2147483647),
      { ...input(), value: { ...defaultPreferences, theme: "unrecognized" } },
    ])
      expect((await PUT(request(body))).status).toBe(400);
    const malformed = await PUT(
      new Request("http://localhost/api/workspace", {
        method: "PUT",
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: "Send valid JSON for this workspace item.",
    });
    expect(state.entries).toBeUndefined();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("measures upload limits in UTF-8 bytes and retains prior data", async () => {
    const state = activeGuest();
    await PUT(request(input()));
    const response = await PUT(
      request({ ...input(1), padding: "界".repeat(300000) }),
    );
    expect(response.status).toBe(413);
    expect(state.entries?.preferences.version).toBe(1);
  });
  it("allows updating a full guest workspace but rejects a new item", async () => {
    const state = activeGuest();
    await PUT(request(input()));
    for (let i = 0; i < 99; i++)
      state.entries![`fixture-${i}`] = {
        ...state.entries!.preferences,
        key: `fixture-${i}`,
      };
    expect(
      (await PUT(request(input(1, { ...defaultPreferences, theme: "dark" }))))
        .status,
    ).toBe(200);
    delete state.entries!.preferences;
    state.entries!["last-fixture"] = state.entries!["fixture-0"];
    expect((await PUT(request(input()))).status).toBe(400);
    expect(Object.keys(state.entries!)).toHaveLength(100);
  });
  it("uses only the signed-in owner's key and returns the value from the committing transaction", async () => {
    mocks.currentProfile.mockResolvedValue({ id: "profile-a" });
    mocks.workspaceEntry.updateMany.mockResolvedValue({ count: 1 });
    const entry = {
      key: "preferences",
      value: defaultPreferences,
      version: 2,
      updatedAt: new Date().toISOString(),
    };
    mocks.workspaceEntry.findUniqueOrThrow.mockResolvedValue(entry);
    const response = await PUT(request({ ...input(1), userId: "profile-b" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entry });
    expect(mocks.workspaceEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "profile-a", key: "preferences", version: 1 },
      }),
    );
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(mocks.guestIdentity).not.toHaveBeenCalled();
    mocks.workspaceEntry.findMany.mockResolvedValue([entry]);
    await GET();
    expect(mocks.workspaceEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "profile-a" } }),
    );
  });
  it("refuses stale signed-in edits and bounded storage without inserting", async () => {
    mocks.currentProfile.mockResolvedValue({ id: "profile-a" });
    mocks.workspaceEntry.updateMany.mockResolvedValue({ count: 0 });
    expect((await PUT(request(input(4)))).status).toBe(409);
    expect(mocks.workspaceEntry.findUniqueOrThrow).not.toHaveBeenCalled();
    mocks.workspaceEntry.count.mockResolvedValue(300);
    expect((await PUT(request(input()))).status).toBe(400);
    expect(mocks.workspaceEntry.create).not.toHaveBeenCalled();
  });
  it("retries serialization conflicts and reports exhausted conflicts without leaking database details", async () => {
    mocks.currentProfile.mockResolvedValue({ id: "profile-a" });
    mocks.transaction.mockRejectedValueOnce(databaseError("P2034"));
    mocks.workspaceEntry.deleteMany.mockResolvedValue({ count: 1 });
    expect((await DELETE(request(input(1), "DELETE"))).status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    mocks.transaction.mockRejectedValue(databaseError("P2034"));
    const response = await PUT(request(input()));
    expect(response.status).toBe(409);
    expect(mocks.transaction).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(await response.json())).not.toContain(
      "Private database",
    );
  });
  it("returns a recoverable service error for infrastructure failures", async () => {
    mocks.currentProfile.mockRejectedValue(new Error("SECRET_DB_URL"));
    for (const response of [await GET(), await PUT(request(input()))]) {
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toContain(
        "SECRET_DB_URL",
      );
    }
  });
});
