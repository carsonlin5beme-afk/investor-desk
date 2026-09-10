import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  CashLedgerEntry,
  Fill,
  Order,
  Portfolio,
  Prisma,
} from "@prisma/client";
export const GUEST_COOKIE = "investor-desk.guest";
export const GUEST_TTL_MS = 24 * 60 * 60 * 1000;
export type GuestPosition = Prisma.PositionGetPayload<{
  include: { targetScenario: true; optionDetails: true };
}>;
export type GuestPortfolio = Portfolio & {
  positions: GuestPosition[];
  orders: (Order & { fills: Fill[] })[];
  cashLedgerEntries: CashLedgerEntry[];
};
export type GuestWorkspace = {
  key: string;
  expiresAt: number;
  portfolios: GuestPortfolio[];
  imported: boolean;
  entries?: Record<string, import("@/lib/studio").WorkspaceEntry>;
};
const scope = globalThis as typeof globalThis & {
  investorGuestWorkspacesV1?: Map<string, GuestWorkspace>;
  investorGuestLocksV1?: Map<string, Promise<void>>;
};
const workspaces = (scope.investorGuestWorkspacesV1 ??= new Map());
const locks = (scope.investorGuestLocksV1 ??= new Map());
export const guestId = () => `guest_${randomUUID()}`;
export const guestKey = (token: string | undefined) =>
  token && /^[a-f0-9]{64}$/.test(token)
    ? createHash("sha256").update(token).digest("hex")
    : null;
export function getGuest(key: string | null): GuestWorkspace | null {
  const now = Date.now();
  for (const [id, state] of workspaces)
    if (state.expiresAt <= now && !locks.has(id)) workspaces.delete(id);
  const state = key ? workspaces.get(key) : undefined;
  if (!state || state.expiresAt <= now) return null;
  state.expiresAt = now + GUEST_TTL_MS;
  return state;
}
export function createGuest() {
  getGuest(null);
  if (workspaces.size >= 200)
    throw new Error(
      "Temporary workspace capacity reached. Please try again later.",
    );
  const token = randomBytes(32).toString("hex");
  const state: GuestWorkspace = {
    key: guestKey(token)!,
    expiresAt: Date.now() + GUEST_TTL_MS,
    portfolios: [],
    imported: false,
  };
  workspaces.set(state.key, state);
  return { token, state };
}
export function discardGuest(key: string) {
  workspaces.delete(key);
}
// Reads, trades and import share a per-workspace queue, so a transfer cannot miss an in-flight fill.
export async function lockGuest<T>(
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  const before = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = before.then(() => lock);
  locks.set(key, tail);
  await before;
  try {
    return await action();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}
export function guestLimit(state: GuestWorkspace) {
  const records = state.portfolios.reduce(
    (sum, p) =>
      sum + p.orders.length + p.cashLedgerEntries.length + p.positions.length,
    0,
  );
  if (records >= 2000)
    throw new Error(
      "Guest workspace limit reached. Sign in to save your portfolios and keep building.",
    );
}
