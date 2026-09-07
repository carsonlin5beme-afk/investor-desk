import { NextRequest, NextResponse } from "next/server";

import { jsonError } from "@/server/api/http";
import { searchSymbols } from "@/server/services/symbol-search-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limitRaw = request.nextUrl.searchParams.get("limit") ?? "12";
  const limit = Number(limitRaw);

  if (!query.trim()) {
    return NextResponse.json({ symbols: [] });
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    return jsonError("limit must be a positive number", 400);
  }

  try {
    const symbols = await searchSymbols(query, limit);
    return NextResponse.json({ symbols });
  } catch (error) {
    console.error(error);
    return jsonError("Failed to search symbols", 500);
  }
}
