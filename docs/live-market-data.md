# Live U.S. Market Data: Implementation Path

## Current capabilities (2026-09-10)

A new checkout defaults to explicitly labeled sample mode and includes illustrative PL stock and standard-option fixtures. Sample prices are not provider quotes. Live IEX stock quotes using paper-account API keys have passed authenticated read-only checks. Each installation supplies its own server-side credentials and checks its selected feeds; public source contains no usable keys or personal configuration. The quote cache is not a market-data subscription.

Stock and options adapters, symbol/contract discovery, timestamped snapshots, feed checks, and polling SSE are implemented. The dashboard and open option chain poll every 15 seconds, with dashboard polling paused while hidden. Stock and option entitlements are independent: an earlier authenticated OPRA probe returned HTTP 403 even though IEX stock access worked. This establishes neither consolidated SIP/OPRA access nor universal coverage or measured end-to-end latency. The app does not yet run a persistent SIP/OPRA stream worker. A profile login saves simulated portfolios; it does not grant exchange data access.

## Recommended provider choice

Use one entitled Alpaca account for consolidated SIP equities and OPRA options. Alpaca currently lists its personal Algo Trader Plus plan at $99/month, with 1,000 simultaneous options quote subscriptions. Basic IEX is one exchange, and indicative options are not equivalent to executable consolidated quotes. This is a personal-data route, not permission to redistribute prices to arbitrary signed-up users.

Keep the existing hybrid alternative: Alpaca stocks plus Tradier production options. Tradier requires a brokerage account for real-time U.S. stock/options data; its sandbox is delayed. Its IV/Greeks update less frequently than quotes. Choose each feed explicitly and verify its entitlement separately; stock access alone cannot authorize options quotes.

Before a public multi-user launch, obtain commercial/display rights and clarify professional versus non-professional classifications and exchange agreements with the provider. Do not use personal keys as a public quote relay. API keys stay server-side; no brokerage order endpoints are called.

Sources: [Alpaca Market Data plans](https://docs.alpaca.markets/us/docs/about-market-data-api), [Tradier Market Data](https://docs.tradier.com/docs/market-data), [OPRA access](https://www.opraplan.com/get-access-to-opra-data).

## Phase 1: Activate the existing snapshot path

1. Save your own provider keys in the local gitignored `.env`, never in chat or client code. Keep `MARKET_DATA_MODE=demo` while checking setup. Paper-account Alpaca keys can use `EQUITY_PROVIDER=alpaca`, `ALPACA_FEED=iex`, and `ALPACA_REFERENCE_BASE_URL=https://paper-api.alpaca.markets` for the verified IEX stock path.
2. Use `ALPACA_FEED=sip` only when consolidated-stock access is entitled. Select `OPTIONS_PROVIDER=alpaca` for the separate OPRA path, or `tradier` with its production token for the hybrid route. Use the paper/live reference base URL appropriate to the key type. Missing fundamentals can use a manual shares-outstanding input.
3. In `next dev`, selected market fields and the Alpaca key/secret pair are read from the project-root `.env` on server-module hot reload. This preserves the server process and guest RAM. Confirm the applied settings through **Data & assumptions > Test feed access (read-only)**; a process restart is not a prerequisite for this development path. See the [development configuration contract](../README.md#local-development-market-configuration) for supported fields. Production/tests and other provider secrets retain their normal environment behavior.
4. Check the selected stock feed and options separately. A successful IEX result does not clear an OPRA 403. After a feed passes, set `MARKET_DATA_MODE=live` and confirm the applied mode. Missing keys, entitlement denial, rate limits, failed refreshes, and stale prices remain distinct. Never silently substitute demo, indicative, or delayed data.
5. During an open session, check PL, an ETF, and—only with options access—a liquid standard option and longer-dated contract. Confirm symbol, source, bid, ask, original timestamp, and standard multiplier. Compare with a second entitled reference when measuring quote age and client latency, allowing for independently sampled prices.

## Phase 2: Actual tick-driven updates

Use one server-side market-data worker, not one vendor websocket per browser or portfolio. Share subscriptions across profiles, but authorize each portfolio's downstream messages.

```
Entitled provider SIP / OPRA websocket
  -> normalize and validate symbol, side prices, timestamp, source
  -> shared in-memory quote cache
  -> coalesced database snapshots (not a write for every market tick)
  -> authenticated SSE fan-out
  -> holdings and the currently visible ticket contracts
```

- Bootstrap subscriptions from a REST snapshot, then apply streaming quotes. Watch held instruments and visible contracts only; unsubscribe when there are no consumers. Do not subscribe to the full options universe on a retail plan.
- Page the full instrument directory for search and load option expirations/chains on demand. Directory coverage and simultaneous streaming capacity are different requirements. Not every stock has listed options.
- Keep ordered provider timestamps and reject older out-of-order events. Track quote age separately from the last successful network request. Do not change quote timestamps on reconnect or cache reads.
- Reconnect with bounded exponential backoff and jitter; restore subscriptions after authentication. Enforce entitlement limits, batch REST fallback requests, coalesce bursts to the UI, and expose rate-limit/disconnection states.
- Keep snapshots as a clearly labeled polling fallback. Stream errors must not authorize execution from the last cached value. Provider bid/ask and transport latency must be visible rather than a generic green live badge.
- Recheck sessions for long-lived streams and close them after revocation. Scope each SSE request to a portfolio owned by that profile. Shared market quotes must never reveal other users' holdings or order activity.

## Market hours and simulation limits

Keep last quotes visible outside market hours, with their original timestamp and stale status. Stale data alone is not proof of regular-session closure. Do not invent ticks or substitute the latest request time for quote time.

The currently accepted simulator rejects stale/delayed/indicative fills, requires valid executable ask/bid, and checks the provider again on execution. A limit only fills if already crossed; it is not left resting. Prices can change between preview and execution.

**Under implementation, not yet accepted:** a compact closed-session LIMIT simulation for eligible IEX equities. The planned rule uses a successfully refreshed last available quote timestamped at or after the **open of the latest completed regular session**, including later post-close quotes, with server-verified clock/calendar state and original source/time labels. It does not require a quote from the final 15 minutes. BUY fills at the disclosed ask only when ask is at or below the limit; SELL fills at bid only when bid is at or above the limit. Changed quote/session basis requires a new preview, and execution rechecks expiry/market open before committing. Open-session stale data, failed refreshes, invalid quotes and unavailable options remain blocked. This is a historical-price simulation, with no broker submission or queued order. Do not treat this planned exception as shipped behavior.

A quote-based fill is still a simulation: it does not model depth, partial fills, slippage, market impact, margin, adjusted contracts, corporate actions, or actual option settlement. The current options UI supports standard 100-share long equity/ETF contracts, not every derivative listed on U.S. exchanges. Quote IV and model assumptions are not the same thing as executable premiums.

Sources: [Planet investor FAQ (PL)](https://investors.planet.com/resources/investor-faqs/default.aspx), [NYSE hours and holidays](https://www.nyse.com/trade/hours-calendars).

## Acceptance gates before calling it live

- Real credentials plus verified source entitlements, without exposing keys in browser assets or logs.
- Fresh bid/ask observations during an open market; correctly labeled old observations outside hours.
- Reconnect, unauthorized, rate-limited, out-of-order, missing-symbol, zero-sided, crossed, malformed, and stale quote tests.
- Stock and option fills recompute cash with contract multipliers and never call real-order endpoints.
- Multiple simultaneous profiles receive their own holdings and activity only.
- Report measured quote age and client update latency. No claim of universal, tick-by-tick real-time coverage based solely on a successful HTTP request.
