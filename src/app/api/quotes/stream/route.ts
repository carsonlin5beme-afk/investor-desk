import { prisma } from "@/lib/prisma";
import { getLiveQuote } from "@/server/services/quote-service";
import { env } from "@/lib/env";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const portfolioId = new URL(request.url).searchParams.get("portfolioId");
  if (!portfolioId)
    return Response.json({ error: "portfolioId is required" }, { status: 400 });
  if (!(await prisma.portfolio.findUnique({ where: { id: portfolioId } })))
    return Response.json({ error: "Portfolio not found" }, { status: 404 });
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout>;
      const send = (event: string, data: unknown) => {
        if (!closed)
          controller.enqueue(
            new TextEncoder().encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
      };
      stop = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        request.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {}
      };
      const tick = async () => {
        try {
          const positions = await prisma.position.findMany({
            where: { portfolioId },
          });
          for (const p of positions) {
            if (closed) return;
            const quote = await getLiveQuote(p.symbol, p.assetClass);
            if (quote)
              send("quote", {
                ...quote,
                stale:
                  Date.now() - quote.asOf.getTime() >
                  env.QUOTE_STALE_SECONDS * 1000,
              });
          }
          send("keepalive", { at: new Date().toISOString() });
        } catch {
          send("feed-error", {
            message: "Quote refresh unavailable; retaining last prices.",
          });
        } finally {
          if (!closed) timer = setTimeout(tick, 15000);
        }
      };
      request.signal.addEventListener("abort", stop, { once: true });
      if (request.signal.aborted) {
        stop();
        return;
      }
      send("ready", {
        portfolioId,
        transport: "polling-sse",
        intervalSeconds: 15,
      });
      void tick();
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
