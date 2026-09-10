import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function currentProfile() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}
export const signInRequired = () =>
  Response.json(
    { error: "Sign in to your profile to save or access portfolios." },
    { status: 401 },
  );
export async function portfolioAccess(id: string) {
  const user = await currentProfile();
  if (!user) return signInRequired();
  const found = await prisma.portfolio.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  return found
    ? null
    : Response.json({ error: "Portfolio not found." }, { status: 404 });
}
export async function positionAccess(id: string) {
  const user = await currentProfile();
  if (!user) return signInRequired();
  const found = await prisma.position.findFirst({
    where: { id, portfolio: { userId: user.id } },
    select: { id: true },
  });
  return found
    ? null
    : Response.json({ error: "Position not found." }, { status: 404 });
}
