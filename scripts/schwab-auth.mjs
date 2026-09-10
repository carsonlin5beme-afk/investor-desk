import { createServer } from "node:https";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpathSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  schwabAuth,
  validateCallback,
  SCHWAB_AUTHORIZE_URL,
  DEFAULT_SCHWAB_CALLBACK,
} from "../src/server/providers/schwab-auth.mjs";
import {
  createCallbackValidator,
  prepareCallbackTLS,
} from "./lib/schwab-callback.mjs";
const exec = promisify(execFile);
// Anchor secrets to the real repository, even when npm starts through its legacy symlink.
process.chdir(realpathSync(fileURLToPath(new URL("..", import.meta.url))));
if (existsSync(".env")) process.loadEnvFile(".env");
const auth = schwabAuth();
async function connect() {
  if (!auth.configured()) throw new Error(auth.status().detail);
  const callback = validateCallback(
    process.env.SCHWAB_CALLBACK_URL || DEFAULT_SCHWAB_CALLBACK,
  );
  const directory = resolve(".local/schwab");
  const { key, cert } = await prepareCallbackTLS(directory);
  const state = randomBytes(32).toString("base64url");
  const authorize = new URL(SCHWAB_AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    client_id: process.env.SCHWAB_CLIENT_ID,
    redirect_uri: callback,
    response_type: "code",
    state,
  }).toString();
  const validate = createCallbackValidator({
    state,
    callback,
    expiresAt: Date.now() + 300000,
  });
  await new Promise((done, reject) => {
    const server = createServer(
      {
        key,
        cert,
        maxHeaderSize: 24000,
        requestTimeout: 10000,
        headersTimeout: 10000,
      },
      async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; frame-ancestors 'none'",
        );
        try {
          const result = validate({
            method: request.method,
            url: request.url,
            host: request.headers.host,
          });
          if (result.kind === "invalid") {
            response.writeHead(400);
            response.end(
              "Invalid authorization callback. Return to the project terminal.",
            );
            return;
          }
          if (result.kind === "denied")
            throw new Error(
              "Schwab: authorization was not completed. Retry from the project terminal.",
            );
          await auth.exchangeCode(result.code);
          response.end(
            "Schwab authorization saved privately. Return to Investor Desk and check feed access. All portfolios and trades remain simulated.",
          );
          finish();
        } catch (error) {
          response.writeHead(400);
          response.end("Authorization failed. Return to the project terminal.");
          finish(error);
        }
      },
    );
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            "Schwab: authorization timed out after five minutes. Run the connect command again.",
          ),
        ),
      300000,
    );
    function finish(error) {
      clearTimeout(timeout);
      server.close();
      server.closeIdleConnections();
      error ? reject(error) : done();
    }
    server.once("error", () =>
      finish(
        new Error(
          "Schwab: callback port unavailable. Close the other listener or configure a matching loopback callback port.",
        ),
      ),
    );
    server.listen(Number(new URL(callback).port), "127.0.0.1", async () => {
      console.log(
        `OAuth listener: ${callback}\nUse this exact callback in your approved Schwab app. Your browser may require accepting this local certificate. This command never changes provider portal settings.\nOpen this authorization URL if your browser does not open:\n${authorize}`,
      );
      try {
        await exec(process.platform === "darwin" ? "open" : "xdg-open", [
          authorize.toString(),
        ]);
      } catch {
        /* URL is already available in this local terminal. */
      }
    });
  });
  console.log(
    "Authorization saved. Use Check connections in Investor Desk before enabling MARKET_DATA_MODE=live.",
  );
}
try {
  const command = process.argv[2] || "status";
  if (command === "connect") await connect();
  else if (command === "disconnect") {
    await auth.disconnect();
    console.log(
      "Local Schwab tokens removed. Revoke access in Schwab separately if desired. Existing simulated portfolios remain saved.",
    );
  } else if (command === "status")
    console.log(JSON.stringify(auth.status(), null, 2));
  else
    throw new Error(
      "Usage: node scripts/schwab-auth.mjs connect|status|disconnect",
    );
} catch (error) {
  // Do not print provider bodies, codes, keys, token files, or exception objects.
  console.error(
    error instanceof Error && error.message.startsWith("Schwab")
      ? error.message
      : "Schwab: local authorization failed. Check configuration, OpenSSL availability, and private file permissions.",
  );
  process.exitCode = 1;
}
