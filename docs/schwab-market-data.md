# Schwab market data for simulated portfolios

Schwab supplies quotes and standard stock/ETF option discovery. All portfolios, holdings, cash and orders in Investor Desk remain simulated. This integration has no account, holdings-import, order or funds-transfer endpoints. It permits only GET `/marketdata/v1/quotes`, `/chains` and `/expirationchain` on `https://api.schwabapi.com`, plus OAuth token exchanges. Fundamentals still use Alpha Vantage or a manual shares-outstanding override.

## Local setup

Use Node.js 22+ and OpenSSL in the real project directory. Keep the app in demo mode while connecting. An approved developer subscription, a **Ready For Use** app with Market Data Production, and sufficient market-data permissions are separate requirements. The OAuth consent grants access to the registered app; it does not guarantee real-time entitlement for every instrument.

Enter App Key/Secret only in the private local `.env`; never put them in chat, browser application settings, source control, or a `NEXT_PUBLIC_` variable. Preserve existing database and profile settings. Configure:

```dotenv
MARKET_DATA_MODE=demo
EQUITY_PROVIDER=schwab
OPTIONS_PROVIDER=schwab
SCHWAB_CLIENT_ID=your_app_key
SCHWAB_CLIENT_SECRET=your_app_secret
SCHWAB_CALLBACK_URL=https://127.0.0.1:8182
```

The registered callback and `SCHWAB_CALLBACK_URL` must match exactly, including HTTPS, port and trailing slash. `https://127.0.0.1:8182` is the dedicated local helper's chosen callback; the main app remains at its existing HTTP address. This callback was accepted by the user's developer portal; another registration must also register that exact value. The helper accepts only HTTPS on `127.0.0.1` with an explicit port and root path.

```sh
npm run schwab:connect
```

This opens Schwab's authorization page and listens on loopback for five minutes. Complete consent in the browser. The helper generates a private self-signed certificate for `127.0.0.1`; the browser may ask you to proceed through a certificate warning for that exact local callback. No system certificate trust is changed. Expired or mismatched local certificates are renewed. The terminal prints the authorization URL for manual opening if needed; it includes the transaction state and public client identifier, so do not share it. Never paste the returned callback URL into chat: it contains the authorization code.

State is random, transaction-bound, time-limited and one-use. Invalid, duplicate, malformed, mismatched or replayed callbacks fail safely. This helper uses confidential-client authorization-code OAuth with state protection; it does not claim PKCE support.

```sh
npm run schwab:status
```

Status reports safe state and dates, never tokens. `connected` or `refresh_due` means local authorization exists; feed access is still unverified. Token expiry comes from `expires_in`; refresh preserves the original authorization date and accepts token rotation. The authenticated Trader OAuth guide specifies approximately 30-minute access tokens and a seven-day refresh-token lifetime from creation. The helper uses returned `expires_in` for access expiry and preserves the original authorization date; refreshing does not assume a new seven-day window. Plan to reconnect at least every seven days or sooner if access is revoked. Rejected/revoked authorization becomes `reconnect_required`; run the connect command again.

Restart the local app after changing provider configuration, then open **Settings > Connections > Check connections** while still in demo mode. The checker deliberately probes selected real providers even in demo mode. With Schwab selected it distinguishes local authorization from successful AAPL stock, SPY ETF and standard SPY option quotes. It will not send quote requests when authorization is absent or rejected. Missing credentials, disconnected state, entitlement denial, rate limits and failed requests have separate messages.

Only after successful entitled quote checks, change `MARKET_DATA_MODE=live` locally and restart. During market hours verify the actual provider source, timestamps and usable bid/ask for a stock, ETF and standard option, then verify a simulated buy/sell. Do not assume a local mock test proves authenticated connectivity. Market-closed or illiquid instruments may return old prices despite valid authorization.

## Sources, contracts and model limits

- `schwab-equity` and `schwab-option`: provider explicitly reported real-time status. A fresh usable quote is still required for a simulated fill.
- Suffix `-delayed`: provider explicitly marked delayed data; fills are blocked.
- Suffix `-indicative`: real-time status was missing or unknown; UI says real-time status is unconfirmed and fills are blocked.
- Provider quote times are preserved; missing timestamps never become request time. Stale, excessively future, crossed, or missing executable-side prices cannot authorize fills. Forced execution refresh failures cannot use cached prices.

The app polls snapshots approximately every 15 seconds; it does not stream every tick. Source caches remain separate across demo, Schwab, Alpaca and Tradier. Existing provider choices remain available independently through `EQUITY_PROVIDER` and `OPTIONS_PROVIDER`.

Schwab padded symbols normalize to compact OCC symbols. Supported options must match the requested underlying, right, strike and calendar expiration and carry explicit standard 100-share, non-mini, non-index metadata. Alternate deliverables and inconsistent or incomplete metadata are rejected. A fresh individual option quote must also have reference terms agreeing with the validated chain/OCC terms. LEAPS are kept when returned by expiration discovery; missing options do not establish that an underlying is invalid.

Authenticated official documentation establishes quote/reference field names and epoch-millisecond single-quote timestamps. The chain example is a generated placeholder; actual nested chain arrays, standard null/empty deliverables and chain timestamp conventions still need read-only live validation. The adapter uses documented `bidPrice`, `askPrice`, `isMini`, `isNonStandard`, `isIndexOption` and `isIndex` fields and fails safely if required metadata is absent. The expiration endpoint's official example uses `expirationDate`, whereas its named schema says `expiration`; both validated date fields are supported, with contradictory values rejected. See Scout's research for schema evidence and live-check limitations.

**Schwab implied volatility is currently unavailable:** the inspected official examples disagree on scale and do not define its unit. Investor Desk uses its existing explicitly labeled 60% model assumption instead of silently guessing a conversion. Quotes and supported contracts remain usable independently of IV. No provider mark substitutes for an invalid bid/ask midpoint.

## Disconnect and private storage

```sh
npm run schwab:disconnect
```

This removes only the local token file, waits for an in-flight refresh, and leaves simulated portfolios and database untouched. Revoking the app at Schwab is a separate manual provider action. Tokens and local TLS artifacts live under gitignored `.local/schwab`: directory mode 700, files mode 600. Symlinks, hard-linked token files, unsafe ownership and broad file permissions are rejected. Do not sync or share this directory.

The OAuth lock prevents concurrent refresh/exchange/disconnect operations and checks ownership before saving or releasing. It deliberately does **not** evict a lock by age or PID: automatic reclamation can race another owner and resurrect disconnected authorization. A process crash may leave `.local/schwab/token.lock`. If the command continues to report authorization busy after 15 seconds, stop Investor Desk and all Schwab CLI commands, verify no process is using authorization, then remove only the abandoned `owner.json` and its empty lock directory. Never remove a lock while another command/app process might be refreshing. Restart and retry afterward. If ownership is uncertain, retain the lock and investigate.

**Never delete `.local`**: it also contains the user's database. Do not delete tokens or broad directories to troubleshoot unrelated app issues.

## Local verification

```sh
npx vitest run tests/unit/schwab-auth.test.ts tests/unit/schwab-provider.test.ts tests/unit/schwab-client.test.ts tests/unit/schwab-check.test.ts tests/unit/schwab-execution.test.ts
npm test
npm run lint
npm run build
```

The synthetic tests use temporary private directories and mocked provider calls; they never read actual `.env`, tokens or the database. Authenticated consent, entitlements and real payload validation must be reported separately from these local checks.
