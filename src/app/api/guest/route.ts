import { NextResponse } from "next/server";
import { guestStatus, clearGuest } from "@/server/guest/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(await guestStatus());
}
export async function DELETE(request: Request) {
  return clearGuest(request);
}
