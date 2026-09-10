import { guestResponse } from "@/server/guest/http";
import { portfolioAccess } from "@/server/auth/access";
import { NextRequest, NextResponse } from "next/server";

import { jsonError } from "@/server/api/http";
import { orderTicketSchema } from "@/server/api/schemas";
import { previewOrder } from "@/server/services/order-service";

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
    const preview = await previewOrder(parsed.data);
    return NextResponse.json({ preview });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to preview order";
    return jsonError(message, 400);
  }
}
