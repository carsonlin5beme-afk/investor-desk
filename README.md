# Investor Desk

A local-first, profile-isolated portfolio simulator for stocks, ETFs, and long options. Explore the value of your portfolios if every holding reaches its own target, simultaneously. No orders are sent to a broker.

## Start locally

Use a folder **outside iCloud Drive, Dropbox, or OneDrive**. Sync services can evict dependencies and PostgreSQL files while they are in use. Choose a stable local folder such as `~/Developer/investor-desk`.

Requirements: Node.js 22 or newer, npm, macOS/Linux supported by embedded-postgres. Node.js 24 is verified.

```sh
npm install
npm run local:start
npm run local:status
```

Open <http://127.0.0.1:3000>. The launcher creates `.env` if missing, starts persistent Postgres 18, generates Prisma, applies migrations, builds the optimized website, then serves it with `next start`. Compilation happens once during startup instead of when visitors open pages. It refuses to take over occupied ports or migrate an external database. Both services bind to loopback only.

```sh
npm run local:stop       # Gracefully stop; keeps saved portfolios, clears guest work
npm run local           # Foreground alternative, Ctrl+C to stop
npm run local:dev       # Explicit development mode with hot reload (when stopped)
```

The optimized site reflects the source at startup. To publish later edits locally, save any temporary guest work, stop the managed stack, then run `local:start` again. `local:dev` keeps hot reload available for development; its first page loads include compilation overhead. Neither start command restarts an existing process or discards its guest workspace.

Startup logs: `.local/stack.log`. Database: `.local/postgres`. Never delete `.local` as a troubleshooting step. Back up the database before upgrades. Local scripts and the default API configuration remain loopback-only. A separate, explicit hosted setup is documented in [Hosted deployment](docs/hosted-deployment.md): one Node process, a newly created PostgreSQL database, demo quotes and a validated HTTPS origin. Profiles have password sign-in and server-side ownership checks, but email verification, password recovery and broader public operational controls are not complete. Live market-data distribution needs its own approval.

### Docker alternative

Do not run Docker Postgres and embedded Postgres on the same port.

```sh
cp .env.example .env     # Only for a new checkout; do not replace existing keys
npm install
docker compose up -d
npx prisma generate
npx prisma migrate deploy
npm run dev
```

The Docker workflow uses a separate named Postgres volume. It does not contain the embedded database's portfolios. Use PostgreSQL dump/restore if moving between them.

## App routes

- `/`: public-facing landing page with isolated, illustrative stock/options scenarios and FAQs.
- `/dashboard`: a blank guest workspace initially; temporary portfolios while exploring; your saved portfolios when signed in.
- `/sign-up` and `/sign-in`: local profile creation and password sign-in.
- `/portfolios/[id]`: existing portfolio detail URLs remain unchanged.

The landing preview never reads or modifies your portfolios and does not claim its sample prices are live.

## Profiles and blank-slate behavior

New visitors and portfolio creation forms start empty; no example holdings or cash are seeded. **No account is required to create portfolios, allocate cash, trade, or set targets.** Guest portfolios use the same quote, fill, and projection rules as saved portfolios.

Guest financial records live only in this server process's RAM, isolated by a cryptographically random HttpOnly browser-session cookie. They are not stored in the portfolio database. Page refreshes and navigating to signup preserve them. Closing the browser session, restarting the server, or 24 hours of inactivity can clear them. Shared market quote caches may still be persisted, but no guest Portfolio, Position, Order, Fill, CashLedgerEntry, or TargetScenario records are saved. Limits: 20 portfolios and approximately 2,000 combined position/order/ledger records per guest workspace, with 200 active workspaces per process.

Choose **Save my portfolios** and create a profile, or sign in to an existing one. The app automatically transfers every current guest portfolio, including cash, holdings, options details, targets, and the complete transaction history. Existing account portfolios remain unchanged. Portfolio and holding URLs retain their IDs. The transfer and a GuestImport receipt commit in one database transaction; retries cannot duplicate the transfer. A failed transaction leaves the entire guest workspace intact and offers a retry without re-registering the profile. Trading and transfer share a workspace lock so successful in-flight changes are not dropped. Completed transfers immediately release their RAM slot.

This temporary store is designed for one server process. A hosted single-process beta retains its limits: restarts, sleep and deployment can clear guest work immediately, even before 24 hours. A multi-worker deployment needs a shared temporary store and locks; public operation also needs explicit retention policy, abuse controls and monitoring. Process RAM is not a durable database. Guest data is never automatically assigned from another browser session or from legacy unowned portfolios.

Better Auth handles password hashing and HttpOnly sessions in PostgreSQL User, Account, Session, Verification, and RateLimit tables. Passwords require at least 12 characters. Sessions expire after 7 days and are revoked on sign-out. Auth attempts are rate limited, mutation requests require a matching Origin, and every portfolio/position endpoint verifies profile ownership, including SSE. API responses use no-store. New profiles do not inherit another profile's holdings. No email is sent; email verification and password recovery are not configured yet.

The local launcher and npm run dev generate a private BETTER_AUTH_SECRET in the gitignored .env when missing. Set a random 32+ character secret explicitly for a custom production workflow and keep it stable across restarts. Use one local hostname consistently because cookies on localhost and 127.0.0.1 are separate.

The profile migration preserves older local portfolios with userId=null. These are intentionally hidden from every profile, not deleted or automatically granted to the first registrant. A deliberate, operator-reviewed database ownership migration is required to assign a legacy portfolio to its correct new profile. Never expose an unauthenticated claim-by-ID endpoint.

## What works

- Multiple independently funded portfolios, deposits, withdrawals, and cash ledger.
- Stock/ETF search, options expiration/right/strike chains, bid/ask quotes, and contract selection.
- Market buys at ask and sells at bid. Limits are **immediate-or-cancel**: they fill only when already crossed. Uncrossed limits are rejected, not queued.
- Order preview validates buying power and owned quantity. Execution revalidates quotes and account state. UUID submission IDs prevent duplicate fills.
- Equity and option buys, partial sales, full closing sales, weighted average cost, and realized/unrealized P/L.
- Per-holding price targets or market-cap targets with provider shares outstanding or a manual override.
- Equity target value, option intrinsic and Black-Scholes estimates, simultaneous-target net worth, and an interactive scenario-progress chart.
- Quote-source and stale badges, explicitly marked cost-basis estimates when marks are unavailable, holdings CSV export, and recent transaction history.
- Responsive desktop/mobile UI with keyboard-accessible dialogs.
- Database transactions and per-portfolio row locks protect cash from concurrent trades/withdrawals.

## Sample versus live data

The default `MARKET_DATA_MODE=demo` uses **illustrative fixtures, never real quotes**. Supported sample symbols: PL, TSLA, BTG, AAPL, NVDA, MSFT, AMZN, GOOGL, JPM, V, SPY, QQQ, VOO. Sample option expirations roll forward with the current date. Sample share counts are invented examples, not company fundamentals. The sample BTG $5 calls use a $1.83 ask to make the original vision reproducible.

To configure paper-key IEX stock data, save your own keys in the local gitignored `.env`. Keep sample mode while checking access:

```dotenv
MARKET_DATA_MODE=demo
EQUITY_PROVIDER=alpaca
ALPACA_API_KEY=your_key
ALPACA_API_SECRET=your_secret
ALPACA_FEED=iex
OPTIONS_PROVIDER=alpaca
ALPACA_REFERENCE_BASE_URL=https://paper-api.alpaca.markets
ALPHAVANTAGE_API_KEY=your_key
```

Paper-account API keys support the IEX stock-data path, which has passed authenticated read-only checks. IEX covers one exchange. Set `ALPACA_FEED=sip` only with the required consolidated-stock entitlement. `OPTIONS_PROVIDER=alpaca` selects the separate OPRA options path; a working IEX stock connection does not grant OPRA access. Reference APIs default to paper-account keys; for live-account keys set `ALPACA_REFERENCE_BASE_URL=https://api.alpaca.markets`. Only GET market-data/reference endpoints are used, never brokerage order endpoints. The hybrid configuration remains available: set `OPTIONS_PROVIDER=tradier` and provide `TRADIER_API_TOKEN`. Alpha Vantage fundamentals are optional; manual shares outstanding are available when fundamentals cannot be fetched.

Open **Data & assumptions > Test feed access (read-only)** to check the selected IEX/SIP stock feed and OPRA options separately, including original quote timestamps. After the selected feed passes, set `MARKET_DATA_MODE=live`; unavailable options remain unavailable even when stocks work. An earlier authenticated OPRA probe returned HTTP 403, so options entitlement must be verified independently. The checker does not subscribe to a plan, grant access, place orders, or claim every symbol is covered. A market-closed quote can be authorized but stale.

In `next dev`, the selected market fields and Alpaca key pair are re-read from `.env` on server-module hot reload, without a process restart or loss of guest RAM. Confirm the applied provider/mode through the feed checker. See [Local development market configuration](#local-development-market-configuration) for the exact supported fields and validation. Production and tests use their normal environment configuration; other secrets are outside this development overlay.

Keys stay on the server and are gitignored; a new checkout includes only sample configuration and placeholders. Sample, IEX, SIP, OPRA, and delayed cached quotes are separated by exact feed source, and missing live feeds never silently become sample data. Authenticated IEX quotes have been verified, but each installation still needs its own successful access check. This does not establish SIP/OPRA entitlement, universal symbol coverage, or measured end-to-end latency.

The dashboard and open option chain refresh every 15 seconds (dashboard polling pauses when hidden). The ticket now explains missing sample symbols, absent credentials, delayed feeds, failed refreshes, and stale timestamps. Forced trade refresh failures never fall back to cached execution prices. See the [market-data setup and transport plan](docs/live-market-data.md).

Quote requests are cached and deduplicated. `/api/quotes/stream` provides a lifecycle-managed polling SSE feed with actual quote timestamps and stale flags. The Alpaca adapter also exposes websocket subscriptions; the current dashboard uses polling rather than a permanent websocket worker. Tradier requests use timeouts, caching, and rate-limit cooldowns. Closed-market quotes remain visible with their original timestamps. Open-session stale quotes remain blocked; eligible IEX equity limit orders can use the closed-session simulation described below.

### Closed-session simulated limits

When Alpaca clock/calendar data verifies that the regular session is closed, **Alpaca IEX equities (`EQUITY`, `alpaca-iex`) can use LIMIT simulation** with a valid last available quote. The server must successfully refresh the provider quote, and its original timestamp must be at or after the **open of the latest completed regular session**, including later post-close quotes. The ticket shows “Last available quote” with its original time and source. This historical price is not labeled an official closing price or a fresh after-hours quote.

BUY limits prefill from ask and fill at that ask only when `ask <= limit`; SELL limits prefill from bid and fill at that bid only when `bid >= limit`. Noncrossing limits are rejected immediately, with no queued order. For a new fill, changed or expired quote/session proof requires a fresh preview; the server rechecks expiry and the next market open before committing. Failed refreshes, unknown session state, invalid quotes, unsupported feeds and unavailable options remain blocked. These rules apply to guest and saved portfolios; all trades use simulated money and no orders reach a broker.

Receipts preserve the original quote source, timestamp and closed-session basis, including on an already completed order's replay. A short, quiet confirmation sound plays only for a new successful simulated fill. **Order sounds** can be muted independently of Space radio; previews, failures and replays are silent.

### Schwab stocks and options

Set `EQUITY_PROVIDER=schwab` and `OPTIONS_PROVIDER=schwab` to use Schwab market data for simulated portfolios. Connect through the separate local HTTPS OAuth helper, then check stock/ETF and standard-option access while still in demo mode. Credentials and tokens stay server-side; no actual holdings or broker orders are requested. See [Schwab setup, authorization and verification](docs/schwab-market-data.md) for exact steps, source states and current IV/schema verification limits.

### Recommended U.S. real-time route

As checked September 7, 2026, [Alpaca Algo Trader Plus](https://docs.alpaca.markets/us/docs/about-market-data-api) is listed at **$99/month** for personal Trading API users and includes all-U.S.-exchange stock coverage and OPRA options. Its detailed plan table limits option websocket subscriptions to **1,000 quotes at once**. Basic IEX equities and indicative options are not equivalent to consolidated SIP/OPRA. Eligibility and exchange agreements still apply; this personal plan is not a blanket commercial redistribution license. No subscription has been purchased for this project.

Live symbol search now prefers Alpaca's active U.S. equity/ETF asset directory, with SEC company search as a degraded fallback. OTC is excluded. Options discovery paginates provider-listed expirations and snapshots, including LEAPS. The simulator accepts standard 100-share contracts only; adjusted/nonstandard contracts and index options need separate modeling. Not all stocks have listed options. Authenticated IEX stock checks have passed; broad stock/option coverage and end-to-end latency still require separate verification.

The next transport step is a single shared server-side SIP/OPRA stream, multiplexed to holdings and visible ticket contracts, with snapshots for initialization/reconnection. Do not subscribe to the entire OPRA universe on a retail connection. The current UI still polls snapshots; having real-time-source quotes does not mean the UI updates tick-by-tick.

[Tradier](https://docs.tradier.com/docs/market-data) is an account-based alternative with consolidated production stock/options quotes; sandbox data is delayed and Greeks/volatility update hourly. The current app uses Tradier for options only. Using it for equities as well needs a separate equity adapter. Check [account pricing and inactivity terms](https://tradier.com/individuals/pricing) before choosing it; API availability does not mean an account is unconditionally free.

### Provider choices and entitlements

| Provider                                                                                                                     | Role                                                   | Important limit                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [Alpaca](https://docs.alpaca.markets/us/docs/market-data-faq)                                                                | Equity SIP/IEX, optional OPRA options, asset directory | IEX is one exchange, not consolidated market coverage. SIP requires the appropriate entitlement. |
| [Tradier](https://docs.tradier.com/docs/market-data)                                                                         | Options chains, expirations, quotes, IV                | Real-time access depends on account permissions. Sandbox prices are delayed.                     |
| [Alpha Vantage](https://www.alphavantage.co/documentation/#company-overview)                                                 | Latest available shares outstanding                    | Rate limits apply; manual shares are required if fundamentals are unavailable.                   |
| [SEC ticker/exchange mapping](https://www.sec.gov/files/company_tickers_exchange.json)                                       | Company symbol search universe                         | Fallback only; not a price feed or complete ETF directory. Symbols may also be entered directly. |
| [Massive, formerly Polygon](https://massive.com/docs/rest/options/overview)                                                  | Alternative stock/options adapter                      | Coverage and latency depend on licensing tier.                                                   |
| [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs), [Twelve Data](https://twelvedata.com/docs) | Alternative fundamentals or market data                | Check coverage, limits, and redistribution terms before integration.                             |

There is no free public database that automatically grants unrestricted real-time consolidated stocks and all option quotes. Coverage is limited to listed and optionable instruments supported by the provider; not every stock has options. Check [OPRA access requirements](https://www.opraplan.com/get-access-to-opra-data) and vendor agreements before commercial redistribution.

## Projection math and boundaries

Cash is rounded to cents. Sub-cent buys and partial sales are rejected; a full close of an existing sub-cent residual is allowed with rounded proceeds. Target values and manual share counts must fit the database precision; tiny values that would round to zero are rejected.

- Equity current value: quantity x mark. An unavailable mark is shown as a **cost-basis estimate**, not zero or a live valuation.
- Price target: quantity x target price. Zero-dollar downside targets are supported.
- Valuation target price: target market cap / effective shares outstanding. Manual override takes priority. ETF market-cap targets are not appropriate; use share price.
- Long call intrinsic: max(target underlying price - strike, 0) x contracts x 100.
- Long put intrinsic: max(strike - target underlying price, 0) x contracts x 100.
- Option model: Black-Scholes with target spot, current remaining time, provider IV, 4% interest, and zero dividends. Missing IV uses an explicitly labeled 60% assumption.
- Expired option _scenario_ values collapse to target intrinsic. The app does not automatically settle expired contracts, and this is not the actual expiration payoff unless the underlying really was at that price.
- Projected net worth: cash + modeled target values. Holdings without a target stay at current/estimated value.
- The scenario slider shows progress toward each target, **not future dates or a probability forecast**. It blends current option marks toward model estimates and may curve or fall for mixed calls/puts.

USD, long-only, standard 100-share options, and zero fees. No shorting, margin, spreads, adjusted deliverables, liquidity/slippage model, dividends, splits, corporate actions, automatic exercise, or early-exercise pricing. The activity view shows recent entries, not a full performance or tax report. Models and sample data are not investment advice.

### Original vision examples

- 228 TSLA shares at a $2,000 target = **$456,000** equity value.
- 600 BTG call contracts at $1.83 cost **$109,800**. With a $5 strike, $50 billion target market cap, and an **illustrative manual** 1.35 billion shares outstanding, the implied stock price is about $37.037 and target intrinsic value is **$1,922,222.22**. Model value is shown separately. These are hypothetical inputs, not current BTG facts.

## Verification

```sh
npm test               # Financial math and service tests
npm run lint           # TypeScript
npm run build          # Optimized production build
npm run test:api        # Running local app + DB required; demo mode only
npm run test:stress     # Independent bounded accounting, concurrency and profile-isolation probes
npm run test:guest      # Guest isolation, no pre-auth financial persistence, transfer/retry/rollback
npm run format:check
```

API tests create uniquely named disposable profiles, portfolios and cache fixtures, then remove only those fixtures afterward. They cover the TSLA and BTG examples, duplicate submissions, concurrent buying power, option closing sales, cash adjustments, target aggregation, stale SSE quotes, and cross-origin protection. Do not interrupt the test if possible; failed runs clean up in `finally`.

Development and production use separate `.next-dev` and `.next` output directories, so builds do not corrupt the running dev server. GitHub Actions runs unit/type/build checks and API, stress, and guest-transfer scenarios against a disposable Postgres service. Stress output is retained as a workflow artifact. Independent local checks also cover accounting, profile isolation, guest transfer, and development configuration reload; environment-dependent checks must be repeated for the installation being used.

## Structure

- `src/components`: dashboard, accessible dialogs, target editor, order ticket.
- `src/server/domain`: deterministic financial rules and Black-Scholes.
- `src/server/providers`: swappable data adapters and explicit sample fixtures.
- `src/server/services`: transactional orders, quote cache, and projections.
- `src/server/guest`: isolated temporary workspaces, guest API routing, and atomic profile import.
- `src/app/api`: local REST and SSE interfaces.
- `prisma`: schema and versioned migrations.
- `scripts`: persistent local startup and API acceptance tests.

### Local development market configuration

In `next dev`, the project-root `.env` is authoritative for `MARKET_DATA_MODE`, `EQUITY_PROVIDER`, `OPTIONS_PROVIDER`, `ALPACA_FEED`, `ALPACA_DATA_BASE_URL`, `ALPACA_REFERENCE_BASE_URL`, and `ALPACA_WS_URL`, plus the atomic Alpaca key/secret pair. This avoids stale values inherited by the local launcher. `MARKET_DATA_MODE` must be explicit; other absent public fields use the schema defaults. Both missing or blank Alpaca fields clear the pair; a partial nonempty pair fails. Database, authentication, Schwab and other provider secrets retain their existing environment behavior. Production and tests do not read this development overlay.

The selected market fields support one assignment per line, optional `export`, single/double quoted single-line values, and comments. Unrelated quoted multiline values are preserved; their contents are never treated as market assignments. Multiline/escaped-quote market values, malformed lines and duplicate selected fields are rejected with sanitized errors; there is no variable interpolation. An unreadable file or invalid mode fails configuration instead of falling back to inherited live settings. A server-module hot reload re-evaluates this configuration without restarting the process or clearing in-memory guest workspaces. Quote access still requires a successful authenticated feed check; no credentials belong in source, logs or chat.
