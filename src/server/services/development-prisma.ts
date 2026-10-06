import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { PrismaClient } from "@prisma/client";

/** Keep the dev singleton only while its generated schema stays unchanged. */
export function reuseDevelopmentClient<T>(
  cached: T | undefined,
  previousSignature: string | undefined,
  signature: string,
  load: () => T,
): T {
  return cached !== undefined && previousSignature === signature
    ? cached
    : load();
}

/** Reload the resolved generated directory only; keep runtime and app state. */
export function freshGeneratedModule(
  requireModule: NodeRequire,
  entry: string,
): { PrismaClient: new () => PrismaClient } {
  const resolvedEntry = requireModule.resolve(entry);
  const directory = dirname(resolvedEntry) + sep;
  for (const filename of Object.keys(requireModule.cache)) {
    if (filename.startsWith(directory)) delete requireModule.cache[filename];
  }
  const generated = requireModule(resolvedEntry) as {
    PrismaClient: new () => PrismaClient;
  };
  if (typeof generated.PrismaClient !== "function")
    throw new Error("Generated Prisma client is unavailable.");
  return generated;
}

/** The entry is installed generated code, never a request-supplied path. */
export function developmentPrismaClient(
  cached: PrismaClient | undefined,
  previousSignature: string | undefined,
) {
  // Obtain the native binding at runtime: bundlers rewrite imported createRequire.
  const moduleApi = process.getBuiltinModule?.("module") as
    typeof import("node:module") | undefined;
  if (!moduleApi)
    throw new Error(
      "Development Prisma refresh requires Node.js 22.3 or newer.",
    );
  const requireModule = moduleApi.createRequire(
    join(process.cwd(), "package.json"),
  );
  const entry = requireModule.resolve(".prisma/client/index");
  const signature = createHash("sha256")
    .update(readFileSync(entry))
    .digest("hex");
  const client = reuseDevelopmentClient(
    cached,
    previousSignature,
    signature,
    () => {
      const { PrismaClient: FreshClient } = freshGeneratedModule(
        requireModule,
        entry,
      );
      return new FreshClient();
    },
  );
  // Publish the signature with the new instance only after a successful load.
  return { client, signature };
}
