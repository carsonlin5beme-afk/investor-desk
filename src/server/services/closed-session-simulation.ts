import { env } from "@/lib/env";
import type { ClosedSessionBasis } from "@/lib/quote-status";
import type { MarketQuote } from "@/server/domain/types";
import { alpacaGet } from "@/server/providers/alpaca-client";

const eastern = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function parts(ms: number) {
  return Object.fromEntries(
    eastern.formatToParts(ms).map((part) => [part.type, part.value]),
  );
}
function easternDate(ms: number) {
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}
function shiftedDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
function sessionTime(date: unknown, time: unknown): number {
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof time !== "string" ||
    !/^\d{2}:\d{2}$/.test(time)
  )
    throw new Error("Invalid session");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) throw new Error("Invalid session");
  const probe = Date.UTC(year, month - 1, day, hour, minute);
  const p = parts(probe);
  const offset =
    Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    ) - probe;
  const result = probe - offset;
  const actual = parts(result);
  if (
    easternDate(result) !== date ||
    `${actual.hour}:${actual.minute}` !== time
  )
    throw new Error("Invalid session");
  return result;
}
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error("Invalid timestamp");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error("Invalid timestamp");
  return ms;
}
type Clock = {
  timestamp: number;
  isOpen: boolean;
  nextOpen: number;
  nextClose: number;
};
type Session = { date: string; open: number; close: number };
function parseClock(raw: unknown): Clock {
  const value = raw as Record<string, unknown>;
  if (!value || typeof value.is_open !== "boolean")
    throw new Error("Invalid clock");
  return {
    timestamp: timestamp(value.timestamp),
    isOpen: value.is_open,
    nextOpen: timestamp(value.next_open),
    nextClose: timestamp(value.next_close),
  };
}
function parseCalendar(raw: unknown): Session[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error("Invalid calendar");
  const result = raw
    .map((row) => {
      const open = sessionTime(row?.date, row?.open),
        close = sessionTime(row?.date, row?.close);
      if (close <= open) throw new Error("Invalid session");
      return { date: row.date as string, open, close };
    })
    .sort((a, b) => a.open - b.open);
  if (new Set(result.map((row) => row.date)).size !== result.length)
    throw new Error("Duplicate session");
  return result;
}
let clockCache: { value: Clock; fetchedAt: number; base: string } | undefined;
let pendingClock: Promise<Clock> | undefined;
const calendars = new Map<string, { value: Session[]; until: number }>();
const pendingCalendars = new Map<string, Promise<Session[]>>();
async function loadClock(now: number, execute: boolean): Promise<Clock> {
  const maxAge = execute ? 2000 : 10000;
  if (
    clockCache?.base === env.ALPACA_REFERENCE_BASE_URL &&
    now >= clockCache.fetchedAt &&
    now - clockCache.fetchedAt < maxAge &&
    now < clockCache.value.nextOpen
  )
    return clockCache.value;
  if (pendingClock) return pendingClock;
  // No underlying TTL: this helper owns cache freshness, including the open boundary.
  pendingClock = alpacaGet<unknown>("/v2/clock", {}, true, 0, true).then(
    (raw) => {
      const value = parseClock(raw);
      clockCache = {
        value,
        fetchedAt: Date.now(),
        base: env.ALPACA_REFERENCE_BASE_URL,
      };
      return value;
    },
  );
  try {
    return await pendingClock;
  } finally {
    pendingClock = undefined;
  }
}
async function loadCalendar(now: number): Promise<Session[]> {
  const day = easternDate(now),
    start = shiftedDate(day, -14),
    end = shiftedDate(day, 7);
  const key = `${env.ALPACA_REFERENCE_BASE_URL}:${start}:${end}`;
  const cached = calendars.get(key);
  if (cached && cached.until > now) return cached.value;
  if (pendingCalendars.has(key)) return pendingCalendars.get(key)!;
  const request = alpacaGet<unknown>(
    "/v2/calendar",
    { start, end },
    true,
    0,
  ).then((raw) => {
    const value = parseCalendar(raw);
    if (calendars.size >= 8) calendars.delete(calendars.keys().next().value!);
    calendars.set(key, { value, until: Date.now() + 3600000 });
    return value;
  });
  pendingCalendars.set(key, request);
  try {
    return await request;
  } finally {
    pendingCalendars.delete(key);
  }
}

export function evaluateClosedSession(
  quote: MarketQuote,
  clock: Clock,
  calendar: Session[],
  now: number,
): { basis: ClosedSessionBasis | null; reason?: string } {
  const blocked = (reason: string) => ({ basis: null, reason });
  if (quote.assetClass !== "EQUITY" || quote.source !== "alpaca-iex")
    return blocked("This feed does not support closed-session simulation.");
  if (
    quote.bid == null ||
    quote.ask == null ||
    !Number.isFinite(quote.bid) ||
    !Number.isFinite(quote.ask) ||
    quote.bid <= 0 ||
    quote.ask <= 0 ||
    quote.bid > quote.ask
  )
    return blocked("A positive, uncrossed bid and ask are required.");
  const asOf = quote.asOf.getTime();
  if (!Number.isFinite(asOf) || asOf > now + 5000)
    return blocked("The quote timestamp is invalid.");
  if (
    Math.abs(clock.timestamp - now) > 30000 ||
    clock.nextOpen <= now ||
    clock.nextClose <= clock.nextOpen
  )
    return blocked(
      "The market session could not be verified. Retry the quote.",
    );
  if (clock.isOpen)
    return blocked("The regular session is open. A fresh quote is required.");
  const latest = calendar.filter((session) => session.close <= now).at(-1);
  const upcoming = calendar.find((session) => session.open > now);
  if (
    !latest ||
    !upcoming ||
    upcoming.open !== clock.nextOpen ||
    upcoming.close !== clock.nextClose ||
    calendar.some((session) => session.open <= now && session.close > now)
  )
    return blocked(
      "The market clock and calendar do not agree. Retry the quote.",
    );
  if (asOf < latest.open)
    return blocked(
      "The quote predates the latest completed regular session. Refresh before simulating an order.",
    );
  return {
    basis: {
      kind: "CLOSED_SESSION_LIMIT",
      quoteSource: quote.source,
      quoteAsOf: quote.asOf.toISOString(),
      quoteBid: quote.bid,
      quoteAsk: quote.ask,
      sessionDate: latest.date,
      nextOpen: new Date(clock.nextOpen).toISOString(),
      validUntil: new Date(Math.min(now + 60000, clock.nextOpen)).toISOString(),
    },
  };
}

export async function closedSessionEligibility(
  quote: MarketQuote,
  execute = false,
) {
  if (
    env.MARKET_DATA_MODE !== "live" ||
    env.EQUITY_PROVIDER !== "alpaca" ||
    env.ALPACA_FEED !== "iex" ||
    !env.ALPACA_API_KEY ||
    !env.ALPACA_API_SECRET ||
    quote.assetClass !== "EQUITY" ||
    quote.source !== "alpaca-iex"
  )
    return { basis: null };
  try {
    const [clock, calendar] = await Promise.all([
      loadClock(Date.now(), execute),
      loadCalendar(Date.now()),
    ]);
    return evaluateClosedSession(quote, clock, calendar, Date.now());
  } catch {
    return {
      basis: null,
      reason:
        "The regular-session schedule is unavailable. Retry the quote before simulating a closed-session order.",
    };
  }
}

export function assertClosedSessionCurrent(basis: ClosedSessionBasis | null) {
  const boundary = basis
    ? Math.min(Date.parse(basis.nextOpen), Date.parse(basis.validUntil))
    : Infinity;
  if (basis && (!Number.isFinite(boundary) || Date.now() >= boundary))
    throw new Error(
      "This closed-session preview has expired. Refresh the quote and preview the order again.",
    );
}
export function executionAuditNote(
  side: string,
  quantity: number,
  symbol: string,
  quote: MarketQuote,
  basis: ClosedSessionBasis | null,
) {
  return `${side} ${quantity} ${symbol} (${quote.source}) · Quote at ${quote.asOf.toISOString()}${basis ? " · Closed-session limit simulation using last available quote" : ""}`;
}

export function auditQuoteMetadata(note: string | null | undefined) {
  const asOf = note?.match(
    / · Quote at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)(?: ·|$)/,
  )?.[1];
  const quoteAsOf = asOf && Number.isFinite(Date.parse(asOf)) ? asOf : null;
  return {
    quoteAsOf,
    simulationBasis: quoteAsOf
      ? note?.includes(" · Closed-session limit simulation")
        ? ("CLOSED_SESSION_LIMIT" as const)
        : ("QUOTE" as const)
      : null,
  };
}
