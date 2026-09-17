import { NextRequest, NextResponse } from "next/server";
import { deploymentOrigin, isLoopbackHost } from "./lib/deployment-origin.mjs";

const deny = (error: string, status: number) =>
  NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

export function middleware(request: NextRequest) {
  let deployment;
  try {
    deployment = deploymentOrigin(process.env.BETTER_AUTH_URL);
  } catch {
    return deny("Invalid application origin configuration.", 503);
  }
  // Host comes from the request itself. Forwarded headers and request.nextUrl
  // never grant access, including behind a TLS-terminating reverse proxy.
  const host = (request.headers.get("host") ?? "").toLowerCase();
  if (deployment.local ? !isLoopbackHost(host) : host !== deployment.host)
    return deny(
      deployment.local
        ? "Investor Desk is a local-only workspace."
        : "This host is not configured for Investor Desk.",
      403,
    );
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (
      !origin ||
      (deployment.local
        ? origin !== `http://${host}` && origin !== `https://${host}`
        : origin !== deployment.origin)
    )
      return deny("Cross-origin changes are not allowed.", 403);
    if (
      request.method !== "DELETE" &&
      request.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return deny("Use application/json.", 415);
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export const config = { matcher: "/api/:path*" };
