import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guest: vi.fn(),
  profile: vi.fn(),
  find: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/server/guest/http", () => ({ guestResponse: mocks.guest }));
vi.mock("@/server/auth/access", () => ({
  currentProfile: mocks.profile,
  portfolioAccess: vi.fn(),
  signInRequired: () => new Response(null, { status: 401 }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { portfolio: { findFirst: mocks.find, deleteMany: mocks.remove } },
}));
vi.mock("@/server/services/projection-service", () => ({}));
import { DELETE } from "@/app/api/portfolios/[id]/route";
const call = (body: unknown = { name: "Personal" }) =>
  DELETE(
    new Request("http://localhost/api/portfolios/p1", {
      method: "DELETE",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "p1" }) },
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guest.mockResolvedValue(null);
  mocks.profile.mockResolvedValue({ id: "owner" });
  mocks.find.mockResolvedValue({ name: "Personal" });
  mocks.remove.mockResolvedValue({ count: 1 });
});
describe("portfolio deletion ownership and confirmation", () => {
  it("delegates guests without touching saved portfolios", async () => {
    mocks.guest.mockResolvedValue(new Response("guest"));
    expect(await (await call()).text()).toBe("guest");
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("rejects signed-out requests", async () => {
    mocks.profile.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it.each([{}, null, { name: "" }, { name: 3 }])(
    "requires an explicit named confirmation: %j",
    async (body) => {
      expect((await call(body)).status).toBe(400);
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );
  it("does not expose or delete another owner's portfolio", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(mocks.find).toHaveBeenCalledWith({
      where: { id: "p1", userId: "owner" },
      select: { name: true },
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("checks the owner and confirmed name again in the atomic delete", async () => {
    expect(await (await call()).json()).toEqual({ deletedId: "p1" });
    expect(mocks.remove).toHaveBeenCalledWith({
      where: { id: "p1", userId: "owner", name: "Personal" },
    });
  });
  it("refuses a renamed portfolio before deletion", async () => {
    mocks.find.mockResolvedValue({ name: "Renamed" });
    expect((await call()).status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("rejects a concurrent rename/delete rather than claiming success", async () => {
    mocks.remove.mockResolvedValue({ count: 0 });
    expect((await call()).status).toBe(409);
  });
  it("returns a recoverable error without leaking database details", async () => {
    mocks.remove.mockRejectedValue(new Error("secret connection"));
    const r = await call();
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("secret");
  });
});
