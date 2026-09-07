import { prisma } from "@/lib/prisma";
import { getLiveQuote } from "@/server/services/quote-service";
export async function POST(request: Request) {
  const body = await request.json();
  if (typeof body.portfolioId !== "string")
    return Response.json({ error: "portfolioId is required" }, { status: 400 });
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
