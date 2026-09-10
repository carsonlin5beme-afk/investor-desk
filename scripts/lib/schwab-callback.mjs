import {
  timingSafeEqual,
  X509Certificate,
  createPrivateKey,
} from "node:crypto";
import { mkdtempSync, chmodSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  privateDirectory,
  readPrivateFile,
  validateCallback,
} from "../../src/server/providers/schwab-auth.mjs";
const exec = promisify(execFile);

export function createCallbackValidator({ state, callback, expiresAt }) {
  validateCallback(callback);
  if (!/^[A-Za-z0-9_-]{43}$/.test(state))
    throw new Error("Schwab: invalid local state.");
  const expected = Buffer.from(state, "ascii");
  let consumed = false;
  return ({ method, url: target, host }, now = Date.now()) => {
    // All attacker-controlled parsing and byte comparison stays inside this boundary.
    try {
      if (
        consumed ||
        now >= expiresAt ||
        method !== "GET" ||
        host !== new URL(callback).host ||
        typeof target !== "string" ||
        target.length > 20000 ||
        !target.startsWith("/") ||
        target.startsWith("//") ||
        /%(?![0-9a-f]{2})/i.test(target)
      )
        return { kind: "invalid" };
      const url = new URL(target, callback);
      if (
        url.pathname !== "/" ||
        url.hash ||
        url.origin !== new URL(callback).origin
      )
        return { kind: "invalid" };
      const values = url.searchParams.getAll("state"),
        codes = url.searchParams.getAll("code"),
        errors = url.searchParams.getAll("error");
      if (
        values.length !== 1 ||
        !/^[A-Za-z0-9_-]{43}$/.test(values[0]) ||
        !timingSafeEqual(Buffer.from(values[0], "ascii"), expected)
      )
        return { kind: "invalid" };
      if (errors.length === 1 && codes.length === 0) {
        consumed = true;
        return { kind: "denied" };
      }
      if (
        errors.length ||
        codes.length !== 1 ||
        !/^[\x21-\x7e]{1,8192}$/.test(codes[0])
      )
        return { kind: "invalid" };
      consumed = true;
      return { kind: "code", code: codes[0] };
    } catch {
      return { kind: "invalid" };
    }
  };
}

export async function prepareCallbackTLS(directory, now = Date.now()) {
  privateDirectory(directory);
  const keyFile = join(directory, "callback-key.pem"),
    certFile = join(directory, "callback-cert.pem");
  // Validate every existing artifact before spawning a tool or replacing either file.
  const key = readPrivateFile(keyFile),
    cert = readPrivateFile(certFile);
  if (key && cert) {
    try {
      const certificate = new X509Certificate(cert);
      if (
        Date.parse(certificate.validFrom) <= now &&
        Date.parse(certificate.validTo) > now + 86400000 &&
        certificate.checkIP("127.0.0.1") &&
        certificate.checkPrivateKey(createPrivateKey(key))
      )
        return { key, cert };
    } catch {
      /* Invalid or expired local pair: replace it privately. */
    }
  }
  const temporary = mkdtempSync(join(directory, "tls-"));
  chmodSync(temporary, 0o700);
  try {
    const newKey = join(temporary, "key.pem"),
      newCert = join(temporary, "cert.pem");
    const previousMask = process.umask(0o077);
    let generated;
    try {
      generated = exec(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          newKey,
          "-out",
          newCert,
          "-days",
          "30",
          "-subj",
          "/CN=127.0.0.1",
          "-addext",
          "subjectAltName=IP:127.0.0.1",
        ],
        { timeout: 15000 },
      );
    } finally {
      process.umask(previousMask);
    }
    await generated;
    chmodSync(newKey, 0o600);
    chmodSync(newCert, 0o600);
    const result = {
      key: readPrivateFile(newKey),
      cert: readPrivateFile(newCert),
    };
    renameSync(newKey, keyFile);
    renameSync(newCert, certFile);
    return result;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
