const localNames = new Set(["localhost", "127.0.0.1", "[::1]"]);
const defaultOrigin = "http://127.0.0.1:3000";
const invalidOrigin = () =>
  new Error(
    "Invalid BETTER_AUTH_URL: use one HTTPS origin, or HTTP on localhost, 127.0.0.1 or [::1].",
  );

/** Shared by Edge middleware, server auth and the Node launcher; no Node APIs. */
export function deploymentOrigin(value) {
  const raw = value === undefined ? defaultOrigin : value;
  // Validate the input before URL normalization can hide credentials, paths,
  // encoded hosts, backslashes, whitespace or empty query/fragment delimiters.
  const parts =
    typeof raw === "string" &&
    raw === raw.trim() &&
    /^(https?):\/\/(\[[^\]]+\]|[a-z0-9.-]+)(?::([0-9]+))?\/?$/i.exec(raw);
  if (!parts || (parts[3] && !validPort(parts[3]))) throw invalidOrigin();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw invalidOrigin();
  }
  const hostname = parts[2].toLowerCase();
  const local = localNames.has(hostname);
  if (!local) {
    const labels = hostname.split(".");
    if (
      url.protocol !== "https:" ||
      hostname !== url.hostname ||
      hostname.length > 253 ||
      labels.length < 2 ||
      labels.some(
        (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
      ) ||
      !/[a-z]/.test(labels.at(-1)) ||
      ["localhost", "local", "internal"].includes(labels.at(-1))
    )
      throw invalidOrigin();
  }
  const port = url.port ? `:${url.port}` : "";
  return {
    origin: url.origin,
    host: url.host,
    local,
    // Keep the existing localhost/127.0.0.1 local sign-in aliases, using the
    // configured scheme/port. Public auth has exactly one trusted origin.
    trustedOrigins: local
      ? [
          ...new Set([
            url.origin,
            ...["127.0.0.1", "localhost"].map(
              (name) => `${url.protocol}//${name}${port}`,
            ),
          ]),
        ]
      : [url.origin],
  };
}

export function validPort(value) {
  return (
    typeof value === "string" &&
    /^[0-9]+$/.test(value) &&
    Number(value) >= 1 &&
    Number(value) <= 65535
  );
}

export function isLoopbackHost(host) {
  const parts = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]+))?$/i.exec(host);
  return Boolean(parts && (!parts[2] || validPort(parts[2])));
}
