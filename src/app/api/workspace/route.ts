import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateWorkspaceValue, type WorkspaceEntry } from "@/lib/studio";
import { currentProfile } from "@/server/auth/access";
import { guestCookie, guestIdentity } from "@/server/guest/http";
import { createGuest, getGuest, lockGuest } from "@/server/guest/store";
export const dynamic = "force-dynamic";
const maxBodyBytes = 900000;
const requestSchema = z.object({
  key: z
    .string()
    .max(160)
    .regex(
      /^(preferences|(?:scenario|note):[a-f0-9-]{36})$/,
      "Invalid workspace key.",
    ),
  version: z.number().int().nonnegative().max(2147483646),
  value: z.unknown().optional(),
});
const entrySelect = {
  key: true,
  value: true,
  version: true,
  updatedAt: true,
} as const;
const failure = (error: string, status: number) =>
  NextResponse.json({ error }, { status });
const conflict = () =>
  failure(
    "This item changed in another window. Reload the workspace before saving again.",
    409,
  );
const unavailable = () =>
  failure(
    "The workspace could not be saved or loaded. Your draft is still available; please try again.",
    503,
  );
class InputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
// Enforce the limit while reading, including multi-byte text and chunked requests.
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("Send a workspace item as JSON.");
  const decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel();
        throw new InputError("This workspace item is too large.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    try {
      return requestSchema.parse(JSON.parse(text));
    } catch (error) {
      throw new InputError(
        error instanceof z.ZodError
          ? (error.issues[0]?.message ?? "Invalid workspace item.")
          : "Send valid JSON for this workspace item.",
      );
    }
  } finally {
    reader.releaseLock();
  }
}
export async function GET() {
  try {
    const user = await currentProfile();
    if (user)
      return NextResponse.json({
        entries: await prisma.workspaceEntry.findMany({
          where: { userId: user.id },
          select: entrySelect,
        }),
        temporary: false,
      });
    const { state } = await guestIdentity();
    return NextResponse.json({
      entries: Object.values(state?.entries ?? {}),
      temporary: true,
    });
  } catch {
    return unavailable();
  }
}
async function mutate(request: Request, remove: boolean) {
  try {
    const body = await readBody(request);
    let value: ReturnType<typeof validateWorkspaceValue> | undefined;
    if (!remove) {
      try {
        value = validateWorkspaceValue(body.key, body.value);
      } catch (error) {
        throw new InputError(
          error instanceof z.ZodError
            ? (error.issues[0]?.message ?? "Invalid workspace item.")
            : error instanceof Error
              ? error.message
              : "Invalid workspace item.",
        );
      }
    }
    const user = await currentProfile();
    if (user) {
      // Count, version check and returned value share a snapshot. Concurrent creates
      // cannot bypass the cap, or replace the value returned to an earlier editor.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await prisma.$transaction(
            async (tx) => {
              const where = {
                userId: user.id,
                key: body.key,
                version: body.version,
              };
              if (remove) {
                const d = await tx.workspaceEntry.deleteMany({ where });
                return d.count ? NextResponse.json({ ok: true }) : conflict();
              }
              if (body.version === 0) {
                const count = await tx.workspaceEntry.count({
                  where: { userId: user.id },
                });
                if (count >= 300)
                  throw new InputError(
                    "Workspace limit reached. Remove an old scenario or note first.",
                  );
                const entry = await tx.workspaceEntry.create({
                  data: {
                    userId: user.id,
                    key: body.key,
                    value: value as unknown as Prisma.InputJsonValue,
                  },
                  select: entrySelect,
                });
                return NextResponse.json({ entry });
              }
              const d = await tx.workspaceEntry.updateMany({
                where,
                data: {
                  value: value as unknown as Prisma.InputJsonValue,
                  version: { increment: 1 },
                },
              });
              if (!d.count) return conflict();
              const entry = await tx.workspaceEntry.findUniqueOrThrow({
                where: { userId_key: { userId: user.id, key: body.key } },
                select: entrySelect,
              });
              return NextResponse.json({ entry });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2034" &&
            attempt < 2
          )
            continue;
          throw error;
        }
      }
    }
    const identity = await guestIdentity();
    let token: string | undefined;
    let state = identity.state;
    if (!state) {
      if (body.version || remove) return conflict();
      const created = createGuest();
      state = created.state;
      token = created.token;
    }
    const key = state.key;
    const response = await lockGuest(key, async () => {
      const active = getGuest(key);
      if (!active || active.imported) return conflict();
      const entries = (active.entries ??= {}),
        old = entries[body.key];
      if ((old?.version ?? 0) !== body.version || (remove && !old))
        return conflict();
      if (remove) {
        delete entries[body.key];
        return NextResponse.json({ ok: true });
      }
      if (!old && Object.keys(entries).length >= 100)
        throw new InputError(
          "Guest workspace limit reached. Save your profile or remove an older item.",
        );
      const entry: WorkspaceEntry = {
        key: body.key,
        value: value!,
        version: body.version + 1,
        updatedAt: new Date().toISOString(),
      };
      entries[body.key] = entry;
      return NextResponse.json({ entry, temporary: true });
    });
    return token ? guestCookie(response, token, request) : response;
  } catch (error) {
    if (error instanceof InputError)
      return failure(error.message, error.status);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(error.code)
    )
      return conflict();
    console.error("[workspace]", {
      category:
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : error instanceof Error
            ? error.name
            : "unknown",
      workspaceModelAvailable: Boolean(prisma.workspaceEntry),
    });
    return unavailable();
  }
}
export const PUT = (request: Request) => mutate(request, false);
export const DELETE = (request: Request) => mutate(request, true);
