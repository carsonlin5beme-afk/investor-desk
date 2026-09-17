# Hosted demo preparation

This setup runs the existing simulator as one Node process behind an HTTPS proxy, with a **new PostgreSQL database** and illustrative demo quotes. It prepares the application for a bounded hosted beta; it does not provision resources, migrate a database or establish that a live deployment has passed review. Public demo versus private live-data access remains a separate release decision. No real broker orders are supported.

## Runtime and origin settings

Local `dev`, `start` and `local:*` scripts retain their loopback behavior. The separate `npm run start:hosted` command binds `0.0.0.0` on the platform's explicit `PORT`. It refuses to start without a valid public HTTPS `BETTER_AUTH_URL`, a valid port, a 32-character-or-longer secret and an explicit PostgreSQL URL. It does not generate secrets, create/load `.env`, start embedded Postgres or run migrations. Next.js itself supports dotenv files, so deploy from a clean checkout without private `.env*` files rather than running the hosted launcher inside a personal local installation.

Set the following **through the hosting platform's environment/secret settings**, available during both build and runtime:

| Variable             | Hosted demo value                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `NODE_ENV`           | `production`                                                                                         |
| `BETTER_AUTH_URL`    | The one chosen public origin, for example `https://your-selected-service.onrender.com`               |
| `BETTER_AUTH_SECRET` | A freshly generated, private random secret of at least 32 characters; keep it stable across releases |
| `DATABASE_URL`       | The private connection URL for a newly created, empty deployment database                            |
| `MARKET_DATA_MODE`   | `demo`                                                                                               |
| `PORT`               | The host-provided listen port; Render normally supplies `10000`                                      |

Do not transfer a local `.env`, `.local`, PostgreSQL directory/dump, saved portfolios, auth sessions or provider credentials. Do not set Alpaca, Tradier, Alpha Vantage or Schwab keys/tokens in this public demo. Demo mode uses the application's existing fixtures and starts financial workspaces empty; it does not seed anyone's saved account or advertise live prices. Keep the database connection and auth secret out of Git, client variables, logs and chat.

`BETTER_AUTH_URL` accepts a root origin with an optional final slash. Public names require HTTPS and an exact DNS hostname. Credentials, paths, query/fragment delimiters, wildcard hosts, non-loopback IP literals, single-label names, `.local`/`.localhost`/`.internal` names and malformed values are rejected. Validation does not perform a DNS lookup; the operator must select the actual public deployment hostname. Loopback HTTP remains available for local use. Unset configuration defaults to `http://127.0.0.1:3000`; a blank or invalid value fails closed instead of enabling public access.

In public mode, every `/api` request must carry the configured `Host` (including any nondefault configured port). Mutations also require the exact configured HTTPS `Origin`; POST/PUT/PATCH require the JSON media type. DELETE retains its bodyless exception but still requires Origin. Responses use `no-store`. No CORS permission is added. `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `VERCEL_URL` and other public-base URL variables never expand this allowlist. Better Auth uses the same base URL and trusted origin with proxy-header trust disabled; its separate `BETTER_AUTH_TRUSTED_ORIGINS` setting is intentionally rejected. Guest cookies use the configured HTTPS origin to retain `Secure` through internal HTTP proxying, alongside HttpOnly and SameSite=Lax.

Only one public hostname is accepted. If adding a custom domain, choose it deliberately and redirect the old hostname at the host/proxy rather than adding a wildcard. Set the origin for both build and runtime and rebuild when changing it. Do not loosen Host validation if the platform's health request uses an unexpected host; use a suitable non-API health path and verify the actual proxy contract first.

## One Node service and fresh Postgres

Use Node 24 (the project's verified runtime), the committed lockfile and its pinned installed Prisma major version. The commands below are deployment instructions, not commands run by this preparation task. Point them only at the new cloud database after the release owner verifies that target.

Build command:

```sh
npm ci --include=dev && npm run prisma:generate && npm run build
```

The installed Prisma CLI is required for deployment migrations; do not omit/prune it before running the release command. Use the new database's supported direct migration connection when its provider requires one. The existing Prisma 5 datasource reads `DATABASE_URL`; adding a separate migration URL requires a deliberate schema/configuration change, not copying instructions for another Prisma major version.

Where the platform offers a pre-deploy step, run:

```sh
node node_modules/prisma/build/index.js migrate deploy
```

Then start with:

```sh
npm run start:hosted
```

Render Free lacks a pre-deploy command. For a deliberately selected limited beta, the release owner can use this start command so migration failure prevents listening:

```sh
node node_modules/prisma/build/index.js migrate deploy && npm run start:hosted
```

Never use `migrate dev`, `db push`, the local stack launcher or database-reset commands online. A repeat `migrate deploy` should report no pending migrations; verify the host's cold-start timeout and keep later migrations compatible with the previous application during replacement. Back up the new database and retain the previous reviewed application release for rollback; an application rollback does not undo schema changes.

Render requires a `0.0.0.0` listener and recommends `PORT`. Its proxy terminates HTTPS before forwarding to the Node process. Configure exactly one replica and one Next process, with no PM2/Node cluster or autoscaling. A non-API `/` health check can check the web listener without relaxing the API Host guard; it does not prove database readiness. Verify the configured-host `/api/health` separately. [Render web-service configuration](https://render.com/docs/web-services), [deploy phases](https://render.com/docs/deploys).

Guest workspaces and their locks remain in process memory. Sleep, crash, restart and replacement can erase them; neither a persistent disk nor the saved-account database preserves those Maps. Even with one selected replica, rolling replacement can briefly involve old and new processes, so do not promise guest continuity during deployment. Saved profiles use the new PostgreSQL database. Render Free sleeps after inactivity and has service/database limits; choose a database with an appropriate retention policy rather than assuming a free database is permanent. [Render Free limitations](https://render.com/docs/free).

This preparation does not add shared guest storage, email verification/recovery, general API abuse protection or account administration. Auth rate limits already use the database. A public beta must clearly describe temporary guest loss and its account-recovery limits; unrestricted public account readiness needs further operational work. Keep any paid plan, provider access or private-live deployment behind its own explicit release decision.

## Required hosted checks

Before calling the deployment usable, record the reviewed Git revision, build, origin and migration result, then exercise the actual HTTPS service using disposable demo fixtures:

1. Confirm page/assets load, the platform health probe succeeds and `/api/health` works with the canonical Host. Verify unknown Host requests are rejected, including with forged forwarded headers.
2. Create a guest portfolio and perform supported sample trades/targets. Check its cookie is Secure, HttpOnly, SameSite=Lax and host-scoped with no persistent expiry. Confirm foreign/missing Origin mutations and non-JSON bodies fail, while same-origin JSON requests work.
3. Save the disposable guest workspace into a new profile; sign out/in and verify the data, duplicate-import protection and isolation from a second account. Inspect auth cookie Secure behavior through the real proxy. Never use personal/local account records as deployment fixtures.
4. Verify saved accounts survive a controlled restart while guest loss is reported honestly. Check the radio, navigation and request/browser logs, including real platform request URLs and Host headers. No provider credentials should be requested or sent.

The focused unit tests cover origin parsing, middleware, auth wiring, cookie security and launcher behavior. They do not prove Render forwarding, HTTPS termination, production memory capacity, migrations or live account flows. Those remain hosted verification requirements. [Next.js self-hosting guidance](https://nextjs.org/docs/app/guides/self-hosting), [Better Auth options](https://better-auth.com/docs/reference/options).
