import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
export const dynamic = "force-dynamic";
export async function GET() {
  let database = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "error";
  }
  return NextResponse.json(
    {
      status: database === "ok" ? "ok" : "degraded",
      mode: env.MARKET_DATA_MODE,
      feeds: {
        equities: `alpaca-${env.ALPACA_FEED}`,
        options:
          env.OPTIONS_PROVIDER === "alpaca"
            ? "alpaca-opra"
            : env.TRADIER_BASE_URL.includes("sandbox")
              ? "tradier-delayed"
              : "tradier",
        transport: "snapshots / polling (not tick streaming)",
      },
      checks: { app: "ok", database },
      providers: {
        alpaca:
          env.ALPACA_API_KEY && env.ALPACA_API_SECRET
            ? "configured (connectivity not checked)"
            : "not configured",
        tradier: env.TRADIER_API_TOKEN
          ? "configured (connectivity not checked)"
          : "not configured",
        alphaVantage: env.ALPHAVANTAGE_API_KEY
          ? "configured (connectivity not checked)"
          : "not configured",
      },
      timestamp: new Date().toISOString(),
    },
    { status: database === "ok" ? 200 : 503 },
  );
}
