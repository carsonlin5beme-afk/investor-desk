import { guestResponse } from "@/server/guest/http";
import { portfolioAccess } from "@/server/auth/access";
import { prisma } from "@/lib/prisma";
import { getLiveQuote } from "@/server/services/quote-service";
export async function POST(request: Request) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  const body = await request.json();
  if (typeof body.portfolioId !== "string")
    return Response.json({ error: "portfolioId is required" }, { status: 400 });
  const denied = await portfolioAccess(body.portfolioId);
  if (denied) return denied;
  const positions = await prisma.position.findMany({
    where: { portfolioId: body.portfolioId },
  });
  const quotes = await Promise.all(
    positions.map((p) => getLiveQuote(p.symbol, p.assetClass)),
  );
  return Response.json({
    portfolioId: body.portfolioId,
    quotes: quotes.filter(Boolean),
    refresh: "15-second polling / SSE",
  });
}
