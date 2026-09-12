import { guestResponse } from "@/server/guest/http";
import { portfolioAccess } from "@/server/auth/access";
import { NextRequest, NextResponse } from "next/server";

import { toNumber } from "@/lib/decimal";
import { jsonError } from "@/server/api/http";
import { orderTicketSchema } from "@/server/api/schemas";
import { executeOrder } from "@/server/services/order-service";

export async function POST(request: NextRequest) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  try {
    const parsed = orderTicketSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonError("Invalid order payload", 400, parsed.error.flatten());
    }

    const denied = await portfolioAccess(parsed.data.portfolioId);
    if (denied) return denied;
    const execution = await executeOrder(parsed.data);

    return NextResponse.json({
      execution: {
        orderId: execution.order.id,
        replayed: execution.replayed,
        simulationBasis: execution.simulationBasis,
        quoteSource: execution.quoteSource,
        quoteAsOf: execution.quoteAsOf,
        fillId: execution.fill.id,
        fillPrice: execution.fillPrice,
        notional: execution.notional,
        portfolioCashBalance: execution.portfolioCashBalance,
        position: execution.position
          ? {
              id: execution.position.id,
              symbol: execution.position.symbol,
              assetClass: execution.position.assetClass,
              quantity: toNumber(execution.position.quantity),
              avgCost: toNumber(execution.position.avgCost),
            }
          : null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to execute order";
    return jsonError(message, 400);
  }
}
