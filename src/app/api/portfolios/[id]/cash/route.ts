import { guestResponse } from "@/server/guest/http";
import { portfolioAccess } from "@/server/auth/access";
import { CashEntryType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { toDecimal, toNumber } from "@/lib/decimal";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/server/api/http";
import { cashAdjustSchema } from "@/server/api/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  const denied = await portfolioAccess((await params).id);
  if (denied) return denied;
  try {
    const body = await request.json();
    const parsed = cashAdjustSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(
        "Invalid cash adjustment payload",
        400,
        parsed.error.flatten(),
      );
    }

    const { amount, note, type } = parsed.data;
    const portfolioId = (await params).id;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Portfolio" WHERE id = ${portfolioId} FOR UPDATE`;
      const portfolio = await tx.portfolio.findUnique({
        where: { id: portfolioId },
      });
      if (!portfolio) {
        throw new Error("Portfolio not found.");
      }

      const currentCash = toNumber(portfolio.cashBalance);
      const signedAmount = type === CashEntryType.DEPOSIT ? amount : -amount;
      const nextCash = currentCash + signedAmount;

      if (nextCash < 0) {
        throw new Error("Insufficient cash balance for withdrawal.");
      }

      const updated = await tx.portfolio.update({
        where: { id: portfolioId },
        data: { cashBalance: toDecimal(nextCash) },
      });

      await tx.cashLedgerEntry.create({
        data: {
          portfolioId,
          type,
          amount: toDecimal(signedAmount),
          note,
        },
      });

      return updated;
    });

    return NextResponse.json({
      portfolioId: result.id,
      cashBalance: toNumber(result.cashBalance),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to adjust cash.";
    const status = message.includes("not found") ? 404 : 400;
    return jsonError(message, status);
  }
}
