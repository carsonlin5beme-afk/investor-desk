import { createPortfolioSchema } from "@/server/api/schemas";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentProfile } from "@/server/auth/access";
import { env } from "@/lib/env";
import {
  isDemo,
  equitiesConfigured,
  equityFeedConfigured,
  optionsConfigured,
} from "@/server/providers/factory";
import { getLiveQuote } from "@/server/services/quote-service";
import { isQuoteStale } from "@/server/domain/staleness";
import {
  createGuest,
  discardGuest,
  getGuest,
  guestKey,
  GUEST_COOKIE,
  lockGuest,
  type GuestWorkspace,
} from "./store";
import {
  adjustCash,
  createPortfolio,
  guestFailure,
  guestOrder,
  guestTarget,
  GuestError,
  ownedPortfolio,
  ownedPosition,
  presentGuest,
} from "./portfolio";
export async function guestIdentity() {
  const token = (await cookies()).get(GUEST_COOKIE)?.value;
  const key = guestKey(token);
  return { token, key, state: getGuest(key) };
}
export function guestCookie(
  response: NextResponse,
  token: string,
  request: Request,
  clear = false,
) {
  response.cookies.set(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    ...(clear ? { maxAge: 0 } : {}),
  });
  return response;
}
export async function guestStatus() {
  const { state, token } = await guestIdentity();
  return {
    portfolioCount: state && !state.imported ? state.portfolios.length : 0,
    entryCount:
      state && !state.imported ? Object.keys(state.entries ?? {}).length : 0,
    expiresAt: state ? new Date(state.expiresAt).toISOString() : null,
    expired: Boolean(token && !state),
  };
}
async function desk(state: GuestWorkspace | null, expired: boolean) {
  return {
    user: null,
    portfolios: state
      ? await Promise.all(state.portfolios.map(presentGuest))
      : [],
    guest: {
      temporary: true,
      expired,
      expiresAt: state ? new Date(state.expiresAt).toISOString() : null,
    },
    mode: isDemo ? "demo" : "live",
    feeds: {
      equities: equitiesConfigured(),
      options: optionsConfigured(),
      fundamentals: Boolean(env.ALPHAVANTAGE_API_KEY),
      equityFeed: equityFeedConfigured(),
      optionsProvider: env.OPTIONS_PROVIDER,
    },
    asOf: new Date().toISOString(),
  };
}
async function stream(request: Request, key: string, id: string) {
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false,
        timer: ReturnType<typeof setTimeout>;
      const send = (event: string, data: unknown) => {
        if (!closed)
          controller.enqueue(
            new TextEncoder().encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
      };
      stop = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        request.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {}
      };
      const tick = async () => {
        try {
          await lockGuest(key, async () => {
            const state = getGuest(key);
            if (!state || state.imported) {
              stop();
              return;
            }
            const p = ownedPortfolio(state, id);
            for (const position of p.positions) {
              if (closed) return;
              const quote = await getLiveQuote(
                position.symbol,
                position.assetClass,
              );
              if (quote)
                send("quote", {
                  ...quote,
                  stale: isQuoteStale(quote.asOf, env.QUOTE_STALE_SECONDS),
                });
            }
            send("keepalive", { at: new Date().toISOString() });
          });
        } catch {
          send("feed-error", { message: "Guest quotes unavailable." });
        } finally {
          if (!closed) timer = setTimeout(tick, 15000);
        }
      };
      request.signal.addEventListener("abort", stop, { once: true });
      if (request.signal.aborted) {
        stop();
        return;
      }
      send("ready", {
        portfolioId: id,
        transport: "polling-sse",
        intervalSeconds: 15,
        temporary: true,
      });
      void tick();
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
// This branch never reads or changes persisted portfolios. Signed-in requests use the original handlers.
export async function guestResponse(
  request: Request,
): Promise<Response | null> {
  if (await currentProfile()) return null;
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  const identity = await guestIdentity();
  let state = identity.state,
    token: string | undefined;
  if (path === "/api/portfolios" && method === "POST" && !state) {
    try {
      createPortfolioSchema.parse(await request.clone().json());
      const created = createGuest();
      state = created.state;
      token = created.token;
    } catch (error) {
      return guestFailure(error);
    }
  }
  if (!state) {
    if (path === "/api/desk")
      return NextResponse.json(await desk(null, Boolean(identity.token)));
    if (path === "/api/portfolios" && method === "GET")
      return NextResponse.json({ user: null, portfolios: [] });
    return null;
  }
  const key = state.key;
  return lockGuest(key, async () => {
    try {
      const active = getGuest(key);
      if (!active || active.imported)
        throw new GuestError(
          "This guest workspace has ended or was saved. Refresh your workspace.",
          409,
        );
      const json = (body: unknown, status = 200) => {
        const response = NextResponse.json(body, { status });
        return token ? guestCookie(response, token, request) : response;
      };
      if (path === "/api/desk") return json(await desk(active, false));
      if (path === "/api/portfolios") {
        if (method === "GET")
          return json({
            user: null,
            portfolios: await Promise.all(active.portfolios.map(presentGuest)),
          });
        if (method === "POST") {
          const p = createPortfolio(active, await request.json());
          return json(
            {
              portfolio: {
                id: p.id,
                name: p.name,
                baseCurrency: p.baseCurrency,
                startingCash: p.startingCash.toNumber(),
                cashBalance: p.cashBalance.toNumber(),
              },
              temporary: true,
            },
            201,
          );
        }
      }
      if (path === "/api/orders/preview" || path === "/api/orders/execute")
        return json(
          await guestOrder(
            active,
            await request.json(),
            path.endsWith("execute"),
          ),
        );
      const match = path.match(
        /^\/api\/portfolios\/([^/]+)(?:\/(cash|projection|activity))?$/,
      );
      if (match) {
        const id = decodeURIComponent(match[1]),
          part = match[2],
          p = ownedPortfolio(active, id);
        if (!part && method === "PATCH") {
          const body = await request.json();
          if (
            typeof body.name !== "string" ||
            !body.name.trim() ||
            body.name.trim().length > 80
          )
            throw new GuestError(
              "Use a portfolio name between 1 and 80 characters.",
            );
          p.name = body.name.trim();
          return json({ portfolio: { id: p.id, name: p.name } });
        }
        if (part === "cash" && method === "POST")
          return json(adjustCash(active, id, await request.json()));
        if (part === "activity")
          return json({
            orders: [...p.orders].reverse().slice(0, 100),
            ledger: [...p.cashLedgerEntries].reverse().slice(0, 100),
          });
        const view = await presentGuest(p);
        if (part === "projection")
          return json({
            portfolioId: id,
            cashBalance: view.cashBalance,
            projectedNetWorth: view.projectedNetWorth,
            projectedPositionsTotal: view.projectedPositionsTotal,
            positions: view.positions.map((p) => p.projection),
          });
        return json({
          portfolio: view,
          positions: view.positions.map((p) => p.projection),
        });
      }
      const position = path.match(/^\/api\/positions\/([^/]+)\/target$/);
      if (position) {
        const id = decodeURIComponent(position[1]);
        if (method === "DELETE") {
          ownedPosition(active, id).targetScenario = null;
          return json({ ok: true });
        }
        return json(await guestTarget(active, id, await request.json()));
      }
      if (path === "/api/positions") {
        const id = url.searchParams.get("portfolioId");
        if (!id) throw new GuestError("portfolioId is required");
        return json({
          positions: (await presentGuest(ownedPortfolio(active, id))).positions,
        });
      }
      if (path === "/api/quotes/bootstrap" || path === "/api/quotes/stream") {
        const id = path.endsWith("stream")
          ? url.searchParams.get("portfolioId")
          : (await request.json()).portfolioId;
        if (typeof id !== "string")
          throw new GuestError("portfolioId is required");
        const p = ownedPortfolio(active, id);
        if (path.endsWith("stream")) return stream(request, key, id);
        return json({
          portfolioId: id,
          quotes: (
            await Promise.all(
              p.positions.map((p) => getLiveQuote(p.symbol, p.assetClass)),
            )
          ).filter(Boolean),
          refresh: "15-second polling / SSE",
        });
      }
      return null;
    } catch (error) {
      return guestFailure(error);
    }
  });
}
export async function clearGuest(request: Request) {
  const { key } = await guestIdentity();
  if (key)
    await lockGuest(key, async () => {
      discardGuest(key);
    });
  return guestCookie(NextResponse.json({ ok: true }), "", request, true);
}
