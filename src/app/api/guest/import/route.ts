import { NextResponse } from "next/server";
import { currentProfile, signInRequired } from "@/server/auth/access";
import { guestCookie, guestIdentity } from "@/server/guest/http";
import { importGuest } from "@/server/guest/import";
import { GuestError } from "@/server/guest/portfolio";
export async function POST(request: Request) {
  const user = await currentProfile();
  if (!user) return signInRequired();
  const { key, token } = await guestIdentity();
  if (!token)
    return NextResponse.json({ portfolioIds: [], alreadySaved: false });
  if (!key)
    return NextResponse.json(
      {
        error: "Guest session is invalid. No account portfolios were changed.",
      },
      { status: 400 },
    );
  try {
    return guestCookie(
      NextResponse.json(await importGuest(key, user.id)),
      "",
      request,
      true,
    );
  } catch (error) {
    console.error("[guest:import]", {
      category: error instanceof GuestError ? "session" : "database",
    });
    return NextResponse.json(
      {
        error:
          error instanceof GuestError
            ? error.message
            : "Your account is ready, but the guest portfolios could not be saved. They remain temporary; retry saving before ending this session.",
      },
      { status: error instanceof GuestError ? error.status : 503 },
    );
  }
}
