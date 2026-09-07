import { NextRequest, NextResponse } from "next/server";
export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
    return NextResponse.json(
      { error: "Investor Desk is a local-only workspace." },
      { status: 403 },
    );
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== `http://${host}` && origin !== `https://${host}`)
      return NextResponse.json(
        { error: "Cross-origin changes are not allowed." },
        { status: 403 },
      );
    if (
      request.method !== "DELETE" &&
      !request.headers.get("content-type")?.startsWith("application/json")
    )
      return NextResponse.json(
        { error: "Use application/json." },
        { status: 415 },
      );
  }
  return NextResponse.next();
}
export const config = { matcher: "/api/:path*" };
