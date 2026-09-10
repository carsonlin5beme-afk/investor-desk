// Node-only OAuth/token storage shared by the local CLI and Next's server.
import {
  constants,
  mkdirSync,
  lstatSync,
  chmodSync,
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { readSchwabJson } from "./schwab-http.mjs";

export const SCHWAB_AUTHORIZE_URL =
  "https://api.schwabapi.com/v1/oauth/authorize";
const TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
export const DEFAULT_SCHWAB_CALLBACK = "https://127.0.0.1:8182";
export function validateCallback(value = DEFAULT_SCHWAB_CALLBACK) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Schwab: callback must be an HTTPS 127.0.0.1 URL with an explicit port and no path, query, or fragment.",
    );
  return value;
}
function checkParents(directory) {
  // Do not traverse a symlink to store brokerage credentials.
  const parts = resolve(directory).split("/").filter(Boolean);
  let current = "/";
  for (const part of parts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("unsafe");
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "Schwab: credential directory must not contain symlinks.",
        );
    }
  }
}
export function privateDirectory(directory) {
  checkParents(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid()))
    throw new Error("Schwab: credential directory ownership is invalid.");
  chmodSync(directory, 0o700);
}
export function readPrivateFile(file) {
  let fd;
  try {
    checkParents(dirname(file));
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid()) ||
      stat.size > 65536
    )
      throw new Error("unsafe");
    return readFileSync(fd, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(
      "Schwab: credential file must be a private regular file owned by this user (chmod 600).",
    );
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export function createSchwabAuth({
  clientId,
  clientSecret,
  callbackUrl = DEFAULT_SCHWAB_CALLBACK,
  directory,
}) {
  const file = join(directory, "tokens.json"),
    lock = join(directory, "token.lock");
  const fingerprint = createHash("sha256")
    .update(`${clientId || ""}\0${clientSecret || ""}`)
    .digest("hex");
  function configured() {
    return Boolean(clientId && clientSecret);
  }
  function read() {
    const value = readPrivateFile(file);
    if (!value) return null;
    try {
      const token = JSON.parse(value);
      if (
        token.version !== 1 ||
        token.clientFingerprint !== fingerprint ||
        typeof token.accessToken !== "string" ||
        !token.accessToken ||
        typeof token.refreshToken !== "string" ||
        !token.refreshToken ||
        !Number.isFinite(token.expiresAt) ||
        !Number.isFinite(token.authorizedAt)
      )
        throw new Error("invalid");
      return token;
    } catch {
      throw new Error(
        "Schwab: saved authorization is invalid or belongs to another app. Reconnect locally.",
      );
    }
  }
  function status() {
    if (!configured())
      return {
        state: "not_configured",
        detail:
          "Set SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET in the local .env, then run npm run schwab:connect. Keep secrets out of chat.",
      };
    try {
      const token = read();
      if (!token)
        return {
          state: "not_connected",
          detail:
            "Run npm run schwab:connect in the project terminal to authorize market data.",
        };
      if (token.reconnectRequired)
        return {
          state: "reconnect_required",
          detail:
            "Schwab rejected authorization. Run npm run schwab:connect locally.",
        };
      return {
        state:
          token.expiresAt > Date.now() + 60000 ? "connected" : "refresh_due",
        detail:
          "Local authorization is stored. Feed access is unverified until a quote check succeeds; reconnect if refresh is rejected.",
        expiresAt: new Date(token.expiresAt).toISOString(),
        authorizedAt: new Date(token.authorizedAt).toISOString(),
      };
    } catch {
      return {
        state: "invalid_storage",
        detail:
          "Local authorization cannot be read safely. Check private file permissions or reconnect in the project terminal.",
      };
    }
  }
  async function withLock(run) {
    privateDirectory(directory);
    const ownerFile = join(lock, "owner.json");
    const owner = JSON.stringify({
      pid: process.pid,
      nonce: randomBytes(16).toString("hex"),
    });
    const deadline = Date.now() + 15000;
    for (;;) {
      try {
        mkdirSync(lock, { mode: 0o700 });
        writeFileSync(ownerFile, owner, { mode: 0o600, flag: "wx" });
        break;
      } catch (error) {
        if (error.code !== "EEXIST")
          throw new Error("Schwab: cannot lock local authorization.");
        let stat;
        try {
          stat = lstatSync(lock);
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          (stat.mode & 0o077) !== 0 ||
          (process.getuid && stat.uid !== process.getuid())
        )
          throw new Error("Schwab: invalid authorization lock.");
        // Do not reclaim by age or PID: concurrent reclaimers can delete a new
        // owner's lock between inspecting and unlinking it. Fail closed instead;
        // the setup guide describes deliberate cleanup after stopping all users.
        if (Date.now() >= deadline)
          throw new Error(
            "Schwab: authorization is busy. Retry shortly; see the setup guide for abandoned locks.",
          );
        await delay(50);
      }
    }
    const assertOwner = () => {
      if (readPrivateFile(ownerFile) !== owner)
        throw new Error(
          "Schwab: authorization lock ownership was lost. Retry locally.",
        );
    };
    try {
      return await run(assertOwner);
    } finally {
      if (readPrivateFile(ownerFile) === owner) {
        unlinkSync(ownerFile);
        rmdirSync(lock);
      }
    }
  }
  function save(token, assertOwner) {
    assertOwner();
    const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(token), {
        mode: 0o600,
        flag: "wx",
      });
      renameSync(temporary, file);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {}
    }
  }
  async function grant(params, previous, assertOwner) {
    if (!configured())
      throw new Error("Schwab: local app credentials are missing.");
    let response;
    try {
      response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams(params),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new Error(
        "Schwab: authorization service is unavailable. Retry locally.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (previous && (response.status === 400 || response.status === 401))
        save({ ...previous, reconnectRequired: true }, assertOwner);
      throw new Error(
        response.status === 400 || response.status === 401
          ? "Schwab: authorization expired or was rejected. Run npm run schwab:connect locally."
          : `Schwab: authorization service unavailable (${response.status}).`,
      );
    }
    let data;
    try {
      data = await readSchwabJson(response, 65536);
    } catch {
      throw new Error("Schwab: invalid authorization response.");
    }
    if (
      !data ||
      typeof data !== "object" ||
      typeof data.token_type !== "string" ||
      data.token_type.toLowerCase() !== "bearer" ||
      typeof data.access_token !== "string" ||
      !data.access_token ||
      data.access_token.length > 16384 ||
      /[^\x21-\x7e]/.test(data.access_token) ||
      typeof data.expires_in !== "number" ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 60 ||
      data.expires_in > 86400 ||
      typeof (data.refresh_token ?? previous?.refreshToken) !== "string" ||
      !(data.refresh_token ?? previous?.refreshToken) ||
      (data.refresh_token ?? previous?.refreshToken).length > 16384 ||
      /[^\x21-\x7e]/.test(data.refresh_token ?? previous?.refreshToken)
    )
      throw new Error("Schwab: incomplete authorization response.");
    const token = {
      version: 1,
      clientFingerprint: fingerprint,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? previous.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      authorizedAt: previous?.authorizedAt ?? Date.now(),
    };
    save(token, assertOwner);
    return token.accessToken;
  }
  async function accessToken(rejectedToken) {
    return withLock(async (assertOwner) => {
      const token = read();
      if (!token)
        throw new Error(
          "Schwab: not connected. Run npm run schwab:connect locally.",
        );
      if (token.reconnectRequired)
        throw new Error(
          "Schwab: authorization expired or was rejected. Run npm run schwab:connect locally.",
        );
      // A concurrent process may already have rotated the rejected access token.
      if (
        token.expiresAt > Date.now() + 60000 &&
        (!rejectedToken || token.accessToken !== rejectedToken)
      )
        return token.accessToken;
      return grant(
        { grant_type: "refresh_token", refresh_token: token.refreshToken },
        token,
        assertOwner,
      );
    });
  }
  async function exchangeCode(code) {
    if (
      typeof code !== "string" ||
      !code ||
      code.length > 8192 ||
      /[^\x21-\x7e]/.test(code)
    )
      throw new Error("Schwab: invalid authorization code.");
    validateCallback(callbackUrl);
    return withLock((assertOwner) =>
      grant(
        { grant_type: "authorization_code", code, redirect_uri: callbackUrl },
        undefined,
        assertOwner,
      ),
    );
  }
  async function rejectAccessToken(rejectedToken) {
    return withLock(async (assertOwner) => {
      const token = read();
      if (token?.accessToken === rejectedToken)
        save({ ...token, reconnectRequired: true }, assertOwner);
    });
  }
  async function disconnect() {
    await withLock(async (assertOwner) => {
      assertOwner();
      try {
        unlinkSync(file);
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new Error("Schwab: could not remove local authorization.");
      }
    });
  }
  return {
    configured,
    status,
    accessToken,
    exchangeCode,
    disconnect,
    rejectAccessToken,
  };
}
let instance;
export function schwabAuth() {
  return (instance ??= createSchwabAuth({
    clientId: process.env.SCHWAB_CLIENT_ID,
    clientSecret: process.env.SCHWAB_CLIENT_SECRET,
    callbackUrl: process.env.SCHWAB_CALLBACK_URL || DEFAULT_SCHWAB_CALLBACK,
    directory: resolve(process.cwd(), ".local/schwab"),
  }));
}
