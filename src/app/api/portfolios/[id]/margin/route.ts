import { NextResponse } from "next/server";
import { marginSettingsSchema } from "@/lib/margin";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/server/api/http";
import { currentProfile, signInRequired } from "@/server/auth/access";
import { guestResponse } from "@/server/guest/http";
import {
  marginStorage,
  portfolioMarginSettings,
} from "@/server/services/portfolio-margin";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  const user = await currentProfile();
  if (!user) return signInRequired();
  const id = (await params).id;
  try {
    const portfolio = await prisma.portfolio.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        marginDebt: true,
        marginAprPercent: true,
        marginMaintenancePercent: true,
        marginDayCountBasis: true,
      },
    });
    if (!portfolio) return jsonError("Portfolio not found.", 404);
    return NextResponse.json({
      portfolioId: id,
      margin: portfolioMarginSettings(portfolio),
    });
  } catch {
    return jsonError("Unable to load margin settings. Please try again.", 500);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  const user = await currentProfile();
  if (!user) return signInRequired();
  const id = (await params).id;
  const input = marginSettingsSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success)
    return jsonError(
      "Enter valid margin debt, APR, maintenance and day-count settings.",
      400,
      input.error.flatten(),
    );
  try {
    // The owner is checked in the write itself; only liability assumptions change.
    const result = await prisma.portfolio.updateMany({
      where: { id, userId: user.id },
      data: marginStorage(input.data),
    });
    if (!result.count) return jsonError("Portfolio not found.", 404);
    return NextResponse.json({ portfolioId: id, margin: input.data });
  } catch {
    return jsonError("Unable to save margin settings. Please try again.", 500);
  }
}
