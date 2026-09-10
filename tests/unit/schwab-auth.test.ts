import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  linkSync,
  chmodSync,
  statSync,
  existsSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSchwabAuth,
  readPrivateFile,
  validateCallback,
} from "../../src/server/providers/schwab-auth.mjs";
import {
  createCallbackValidator,
  prepareCallbackTLS,
} from "../../scripts/lib/schwab-callback.mjs";
let root: string;
const fetchMock = vi.fn();
const response = (extra = {}) =>
  Response.json({
    access_token: "synthetic-access",
    refresh_token: "synthetic-refresh",
    token_type: "Bearer",
    expires_in: 1800,
    ...extra,
  });
const config = () => ({
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret",
  directory: join(root, "auth"),
});
const auth = () => createSchwabAuth(config());
beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), "schwab-test-"));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("private OAuth storage and lifecycle", () => {
  it("exchanges only at the fixed token endpoint, preserves exact callback, and reports safe status", async () => {
    fetchMock.mockResolvedValue(response());
    const a = auth();
    expect(a.status().state).toBe("not_connected");
    await a.exchangeCode("synthetic-code");
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.schwabapi.com/v1/oauth/token");
    expect(request).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
    });
    expect(request.body.get("redirect_uri")).toBe("https://127.0.0.1:8182");
    expect(statSync(config().directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(config().directory, "tokens.json")).mode & 0o777).toBe(
      0o600,
    );
    expect(a.status().state).toBe("connected");
    expect(JSON.stringify(a.status())).not.toMatch(/synthetic-/);
    expect(
      createSchwabAuth({ ...config(), clientSecret: "different" }).status()
        .state,
    ).toBe("invalid_storage");
  });
  it.each([undefined, "MAC", "", 123])(
    "rejects token type %s without saving",
    async (token_type) => {
      fetchMock.mockResolvedValue(response({ token_type }));
      await expect(auth().exchangeCode("code")).rejects.toThrow(
        "incomplete authorization",
      );
      expect(existsSync(join(config().directory, "tokens.json"))).toBe(false);
    },
  );
  it("accepts case-insensitive bearer and rejects oversized or malformed bodies safely", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ token_type: "bEaReR" }))
      .mockResolvedValueOnce(
        new Response("private-provider-body" + "x".repeat(65537)),
      );
    await auth().exchangeCode("code");
    await expect(auth().exchangeCode("code")).rejects.toThrow(
      "Schwab: invalid authorization response.",
    );
  });
  it("coalesces concurrent rejected-token refreshes across separate auth instances and rotates refresh tokens", async () => {
    fetchMock.mockResolvedValueOnce(response()).mockResolvedValueOnce(
      response({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
      }),
    );
    const a = auth();
    await a.exchangeCode("code");
    const authorized = a.status().authorizedAt;
    const values = await Promise.all(
      Array.from({ length: 12 }, () => auth().accessToken("synthetic-access")),
    );
    expect(values.every((value) => value === "rotated-access")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body.get("refresh_token")).toBe(
      "synthetic-refresh",
    );
    expect(a.status().authorizedAt).toBe(authorized);
    expect(
      JSON.parse(readFileSync(join(config().directory, "tokens.json"), "utf8"))
        .refreshToken,
    ).toBe("rotated-refresh");
  });
  it("marks rejected refresh as reconnect required without exposing error content or retry loops", async () => {
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        new Response("secret-provider-content", { status: 400 }),
      );
    const a = auth();
    await a.exchangeCode("code");
    await expect(a.accessToken("synthetic-access")).rejects.toThrow(
      "authorization expired or was rejected",
    );
    expect(a.status().state).toBe("reconnect_required");
    await expect(a.accessToken()).rejects.toThrow("schwab:connect");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("disconnect waits for a live refresh even when its lock timestamp is old; tokens cannot resurrect", async () => {
    fetchMock.mockResolvedValueOnce(response());
    const a = auth();
    await a.exchangeCode("code");
    let complete!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    const refresh = a.accessToken("synthetic-access");
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    const lock = join(config().directory, "token.lock");
    utimesSync(lock, new Date(0), new Date(0));
    const disconnect = auth().disconnect();
    complete(response({ access_token: "rotated-access" }));
    await Promise.all([refresh, disconnect]);
    expect(a.status().state).toBe("not_connected");
    expect(existsSync(join(config().directory, "tokens.json"))).toBe(false);
    await expect(a.accessToken()).rejects.toThrow("not connected");
  });
  it("does not invalidate a newer token after a late rejected response", async () => {
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ access_token: "newer" }));
    const a = auth();
    await a.exchangeCode("code");
    await a.accessToken("synthetic-access");
    await a.rejectAccessToken("synthetic-access");
    expect(a.status().state).toBe("connected");
    await a.rejectAccessToken("newer");
    expect(a.status().state).toBe("reconnect_required");
  });
  it("rejects file and parent symlinks, hard links, broad permissions, and oversized files", () => {
    const safe = join(root, "safe");
    writeFileSync(safe, "private", { mode: 0o600 });
    const link = join(root, "link");
    symlinkSync(safe, link);
    expect(() => readPrivateFile(link)).toThrow("private regular");
    mkdirSync(join(root, "dir"));
    writeFileSync(join(root, "dir", "private"), "value", { mode: 0o600 });
    symlinkSync(join(root, "dir"), join(root, "linked-dir"));
    expect(() => readPrivateFile(join(root, "linked-dir", "private"))).toThrow(
      "private regular",
    );
    linkSync(safe, join(root, "hard"));
    expect(() => readPrivateFile(safe)).toThrow("private regular");
    const broad = join(root, "broad");
    writeFileSync(broad, "value");
    chmodSync(broad, 0o644);
    expect(() => readPrivateFile(broad)).toThrow("private regular");
    const large = join(root, "large");
    writeFileSync(large, "x".repeat(65537), { mode: 0o600 });
    expect(() => readPrivateFile(large)).toThrow("private regular");
  });
});

describe("malformed token rotation", () => {
  it.each(["synthetic-😀", "token with spaces", "token\u0000", "tökén"])(
    "rejects non-header-safe access token without replacing saved authorization",
    async (access_token) => {
      fetchMock
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(response({ access_token }));
      const a = auth();
      await a.exchangeCode("code");
      const previous = readFileSync(
        join(config().directory, "tokens.json"),
        "utf8",
      );
      await expect(a.accessToken("synthetic-access")).rejects.toThrow(
        "incomplete authorization",
      );
      expect(
        readFileSync(join(config().directory, "tokens.json"), "utf8"),
      ).toBe(previous);
    },
  );
});

describe("one-use HTTPS callback", () => {
  const state = "a".repeat(43),
    callback = "https://127.0.0.1:8182";
  const validator = () =>
    createCallbackValidator({ state, callback, expiresAt: 1000 });
  const request = (query: string) => ({
    method: "GET",
    host: "127.0.0.1:8182",
    url: "/?" + query,
  });
  it.each([
    "",
    "state=" + "é".repeat(43),
    "state=" + state + "&state=" + state,
    "state=" + "a".repeat(10000),
    "state=" + "b".repeat(43),
    "state=%zz",
    "state=" + state + "&code=x&code=y",
    "state=" + state + "&code=",
    "state=" + state + "&code=%00",
  ])("safely rejects %s", (query) => {
    expect(validator()(request(query), 1).kind).toBe("invalid");
  });
  it("accepts exactly once and rejects replay, expiry, bad methods, paths, host and malformed targets", () => {
    const valid = request("state=" + state + "&code=synthetic%40code");
    const check = validator();
    expect(check(valid, 1)).toEqual({ kind: "code", code: "synthetic@code" });
    expect(check(valid, 2).kind).toBe("invalid");
    expect(validator()(valid, 1000).kind).toBe("invalid");
    for (const change of [
      { method: "POST" },
      { url: "/wrong?state=" + state + "&code=x" },
      { host: "evil.example" },
      { url: "https://evil.example/" },
      { url: "//evil.example/" },
    ])
      expect(validator()({ ...valid, ...change }, 1).kind).toBe("invalid");
  });
  it("consumes validated provider denial without echoing provider text", () => {
    const check = validator();
    expect(
      check(request("state=" + state + "&error=private-provider-text"), 1),
    ).toEqual({ kind: "denied" });
    expect(check(request("state=" + state + "&code=x"), 2).kind).toBe(
      "invalid",
    );
  });
  it.each([
    "http://127.0.0.1:8182",
    "https://localhost:8182",
    "https://127.0.0.1",
    "https://127.0.0.1:8182/path",
    "https://evil.example:8182",
  ])("rejects unsafe registered callback %s", (value) =>
    expect(() => validateCallback(value)).toThrow(),
  );
});

describe("private local TLS", () => {
  it("generates a private pair, reuses it, renews an expired pair, and refuses existing symlinks", async () => {
    const directory = join(root, "tls");
    const pair = await prepareCallbackTLS(directory);
    expect((await prepareCallbackTLS(directory)).cert).toBe(pair.cert);
    expect(statSync(join(directory, "callback-key.pem")).mode & 0o777).toBe(
      0o600,
    );
    const renewed = await prepareCallbackTLS(
      directory,
      Date.now() + 31 * 86400000,
    );
    expect(renewed.key).not.toBe(pair.key);
    const other = join(root, "unsafe");
    mkdirSync(other);
    symlinkSync(
      join(directory, "callback-key.pem"),
      join(other, "callback-key.pem"),
    );
    await expect(prepareCallbackTLS(other)).rejects.toThrow("private regular");
    expect(readFileSync(join(directory, "callback-key.pem"), "utf8")).toBe(
      renewed.key,
    );
  });
});
