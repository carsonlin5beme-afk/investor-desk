# Investor Desk

A single-user, local-first portfolio simulator for stocks, ETFs, and long options. Explore the value of your portfolios if every holding reaches its own target, simultaneously. No orders are sent to a broker.

## Start locally

Use a folder **outside iCloud Drive, Dropbox, or OneDrive**. Sync services can evict dependencies and PostgreSQL files while they are in use. On this Mac the working project is `~/Developer/investor-desk`; the original `~/Documents/INvestorDesk5` path links to it.

Requirements: Node.js 22 or newer, npm, macOS/Linux supported by embedded-postgres. Node.js 24 is verified.

```sh
npm install
npm run local:start
npm run local:status
```

Open <http://127.0.0.1:3000>. The launcher creates `.env` if missing, starts persistent Postgres 18, generates Prisma, applies migrations, and starts Next.js with hot reload. It refuses to take over occupied ports or migrate an external database. Both services bind to loopback only.

```sh
npm run local:stop       # Gracefully stop; keeps all portfolios
npm run local           # Foreground alternative, Ctrl+C to stop
```

Startup logs: `.local/stack.log`. Database: `.local/postgres`. Never delete `.local` as a troubleshooting step. Back up the database before upgrades. The app is not designed to be exposed to the internet; there is no login or multi-user isolation.

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

The default `MARKET_DATA_MODE=demo` uses **illustrative fixtures, never real quotes**. Supported sample symbols: TSLA, BTG, AAPL, NVDA, MSFT, AMZN, GOOGL, JPM, V, SPY, QQQ, VOO. Sample option expirations roll forward with the current date. Sample share counts are invented examples, not company fundamentals. The sample BTG $5 calls use a $1.83 ask to make the original vision reproducible.

To connect market data, edit `.env` and restart:

```dotenv
MARKET_DATA_MODE=live
ALPACA_API_KEY=your_key
ALPACA_API_SECRET=your_secret
ALPACA_FEED=sip
OPTIONS_PROVIDER=alpaca
ALPACA_REFERENCE_BASE_URL=https://paper-api.alpaca.markets
ALPHAVANTAGE_API_KEY=your_key
```

This consolidated-data configuration uses one entitled Alpaca account for SIP stock quotes and OPRA options. Reference APIs default to paper-account keys; for live-account keys set `ALPACA_REFERENCE_BASE_URL=https://api.alpaca.markets`. Only GET market-data/reference endpoints are used, never brokerage order endpoints. The original hybrid configuration remains available: set `OPTIONS_PROVIDER=tradier` and provide `TRADIER_API_TOKEN`.

Open **Data & assumptions > Test feed access (read-only)** to check credentials, SIP/OPRA access, and quote timestamps before switching out of sample mode. The checker does not subscribe to a plan, grant access, place orders, or claim every symbol is covered. A market-closed quote can be authorized but stale.

Keys stay on the server and are gitignored. Sample, IEX, SIP, OPRA, and delayed cached quotes are separated by exact feed source, and missing live feeds never silently become sample data. Live credentials were not available during verification, so authenticated vendor requests still require validation with your accounts.

The dashboard refreshes every 15 seconds while visible. Quote requests are cached and deduplicated. `/api/quotes/stream` provides a lifecycle-managed polling SSE feed with actual quote timestamps and stale flags. The Alpaca adapter also exposes websocket subscriptions; the current dashboard uses polling rather than a permanent websocket worker. Tradier requests use timeouts, caching, and rate-limit cooldowns. Closed-market quotes remain visible; quotes older than the configured threshold cannot execute trades.

### Recommended U.S. real-time route

As checked September 7, 2026, [Alpaca Algo Trader Plus](https://docs.alpaca.markets/us/docs/about-market-data-api) is listed at **$99/month** for personal Trading API users and includes all-U.S.-exchange stock coverage and OPRA options. Its detailed plan table limits option websocket subscriptions to **1,000 quotes at once**. Basic IEX equities and indicative options are not equivalent to consolidated SIP/OPRA. Eligibility and exchange agreements still apply; this personal plan is not a blanket commercial redistribution license. No subscription has been purchased for this project.

Live symbol search now prefers Alpaca's active U.S. equity/ETF asset directory, with SEC company search as a degraded fallback. OTC is excluded. Options discovery paginates provider-listed expirations and snapshots, including LEAPS. The simulator accepts standard 100-share contracts only; adjusted/nonstandard contracts and index options need separate modeling. Not all stocks have listed options. Authenticated coverage and latency remain unverified until keys are supplied.

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
npm run format:check
```

API tests create uniquely named disposable portfolios and remove only those portfolios afterward. They cover the TSLA and BTG examples, duplicate submissions, concurrent buying power, option closing sales, cash adjustments, target aggregation, stale SSE quotes, and cross-origin protection. Do not interrupt the test if possible; failed runs clean up in `finally`.

Development and production use separate `.next-dev` and `.next` output directories, so builds do not corrupt the running dev server. GitHub Actions runs unit/type/build checks and the API scenarios against a disposable Postgres service.

## Structure

- `src/components`: dashboard, accessible dialogs, target editor, order ticket.
- `src/server/domain`: deterministic financial rules and Black-Scholes.
- `src/server/providers`: swappable data adapters and explicit sample fixtures.
- `src/server/services`: transactional orders, quote cache, and projections.
- `src/app/api`: local REST and SSE interfaces.
- `prisma`: schema and versioned migrations.
- `scripts`: persistent local startup and API acceptance tests.
