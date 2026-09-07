import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
