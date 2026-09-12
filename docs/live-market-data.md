# Live U.S. Market Data: Implementation Path

## Current capabilities (2026-09-12)

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

During the open regular session, stale quotes remain blocked. New simulated fills require valid executable bid/ask and a successful provider refresh. Delayed/indicative feeds and unavailable options remain blocked. Prices can change between preview and execution.

Closed-session simulation is limited to **Alpaca IEX equities (`EQUITY`, `alpaca-iex`) and LIMIT orders**. The server clock/calendar must verify that the regular session is closed and identify its latest completed session, including holidays and early closes. The server must successfully refresh a valid quote whose original timestamp is at or after that session's **OPEN**, including later post-close quotes within the existing future-time tolerance. Quotes from an earlier session, invalid/missing/crossed bid/ask, failed refreshes, unknown session state and unsupported feeds cannot use this exception.

The compact ticket displays the last available quote with its original source and `quoteAsOf`; this historical price is not presented as an official closing print or a fresh after-hours quote. BUY limits prefill from ask and fill at ask only when `ask <= limit`; SELL limits prefill from bid and fill at bid only when `bid >= limit`. Noncrossing limits are rejected immediately. There is no resting or queued order and no broker submission or real-money trade.

Guest and saved portfolios share the quote/session policy. For a new fill, changed source, timestamp, bid/ask or session proof requires a new preview, even when a changed price still crosses the limit. Closed-session previews expire after at most 60 seconds or at the next regular-session open, whichever comes first. Execution checks expiry/open after any accounting-lock wait and before commit; an expired preview cannot authorize a new fill. Original source/time/basis remains in receipts and history. Retrying an already completed submission returns its original fill metadata without a new provider check or duplicate cash mutation; missing legacy metadata remains unknown.

A short confirmation sound is limited to new successful simulated fills. The separate Order sounds mute uses its current setting when success arrives and does not change Space radio. Preview, rejection, failure and idempotent replay produce no success chime.

A quote-based fill is still a simulation: it does not model depth, partial fills, slippage, market impact, margin, adjusted contracts, corporate actions, or actual option settlement. The current options UI supports standard 100-share long equity/ETF contracts, not every derivative listed on U.S. exchanges. Quote IV and model assumptions are not the same thing as executable premiums.

Sources: [Planet investor FAQ (PL)](https://investors.planet.com/resources/investor-faqs/default.aspx), [NYSE hours and holidays](https://www.nyse.com/trade/hours-calendars).

## Acceptance gates before calling it live

- Real credentials plus verified source entitlements, without exposing keys in browser assets or logs.
- Fresh bid/ask observations during an open market; correctly labeled old observations outside hours.
- Reconnect, unauthorized, rate-limited, out-of-order, missing-symbol, zero-sided, crossed, malformed, and stale quote tests.
- Stock and option fills recompute cash with contract multipliers and never call real-order endpoints.
- Multiple simultaneous profiles receive their own holdings and activity only.
- Report measured quote age and client update latency. No claim of universal, tick-by-tick real-time coverage based solely on a successful HTTP request.
