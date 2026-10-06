import { PrismaClient } from "@prisma/client";
import { developmentPrismaClient } from "@/server/services/development-prisma";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __prismaGeneratedSignature: string | undefined;
}

function client() {
  if (process.env.NODE_ENV !== "development") return new PrismaClient();
  const loaded = developmentPrismaClient(
    globalThis.__prisma,
    globalThis.__prismaGeneratedSignature,
  );
  globalThis.__prisma = loaded.client;
  globalThis.__prismaGeneratedSignature = loaded.signature;
  // Existing requests can finish on their old client; never disconnect it here.
  return loaded.client;
}
export const prisma = client();
