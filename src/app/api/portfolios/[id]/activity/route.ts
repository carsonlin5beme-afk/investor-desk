import { guestResponse } from "@/server/guest/http";
import { portfolioAccess } from "@/server/auth/access";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  const { id } = await params;
  const denied = await portfolioAccess(id);
  if (denied) return denied;
  const orders = await prisma.order.findMany({
    where: { portfolioId: id },
    include: { fills: true },
    orderBy: { submittedAt: "desc" },
    take: 100,
  });
  const ledger = await prisma.cashLedgerEntry.findMany({
    where: { portfolioId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ orders, ledger });
}
