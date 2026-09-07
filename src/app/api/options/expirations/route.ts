import { NextRequest, NextResponse } from "next/server";

import { jsonError } from "@/server/api/http";
import { providers } from "@/server/providers/factory";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams
    .get("symbol")
    ?.trim()
    .toUpperCase();
  if (!symbol) {
    return jsonError("symbol query parameter is required", 400);
  }

  try {
    const expirations = await providers.options.getExpirations(symbol);
    return NextResponse.json({ symbol, expirations });
  } catch (error) {
    console.error(error);
    return jsonError("Failed to load option expirations", 500);
  }
}
