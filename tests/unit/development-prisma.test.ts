import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  freshGeneratedModule,
  reuseDevelopmentClient,
} from "@/server/services/development-prisma";
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
describe("Development generated Prisma schema refresh", () => {
  it("reuses the singleton for the same generated signature without creating extra clients", () => {
    const cached = { query: vi.fn(), disconnect: vi.fn() },
      load = vi.fn();
    expect(reuseDevelopmentClient(cached, "same", "same", load)).toBe(cached);
    expect(load).not.toHaveBeenCalled();
    expect(cached.disconnect).not.toHaveBeenCalled();
  });
  it.each([undefined, "old"])(
    "replaces old or unversioned cached clients on a generated revision: %s",
    (previous) => {
      const old = { query: vi.fn(), disconnect: vi.fn() },
        fresh = { query: vi.fn(), disconnect: vi.fn() },
        load = vi.fn(() => fresh);
      expect(reuseDevelopmentClient(old, previous, "new", load)).toBe(fresh);
      expect(load).toHaveBeenCalledOnce();
      expect(old.disconnect).not.toHaveBeenCalled();
      // Existing holders still have a usable client while newer requests use fresh.
      old.query();
      expect(old.query).toHaveBeenCalledOnce();
    },
  );
  it("loads on cold start and never treats a missing instance as a reusable signature", () => {
    const fresh = {},
      load = vi.fn(() => fresh);
    expect(reuseDevelopmentClient(undefined, "same", "same", load)).toBe(fresh);
    expect(load).toHaveBeenCalledOnce();
  });
  it("does not replace a retained client or claim refresh success if loading fails", () => {
    const retained = { disconnect: vi.fn() },
      load = vi.fn(() => {
        throw new Error("generated load failed");
      });
    expect(() => reuseDevelopmentClient(retained, "old", "new", load)).toThrow(
      "generated load failed",
    );
    expect(retained.disconnect).not.toHaveBeenCalled();
  });
  it("reloads the generated entry and its children while retaining unrelated and similarly named sibling caches", () => {
    const dir = mkdtempSync(join(tmpdir(), "investor-dev-prisma-"));
    directories.push(dir);
    writeFileSync(join(dir, "package.json"), "{}");
    mkdirSync(join(dir, "generated"));
    mkdirSync(join(dir, "generated-other"));
    const entry = join(dir, "generated/index.cjs"),
      child = join(dir, "generated/schema.cjs"),
      other = join(dir, "generated-other/index.cjs");
    writeFileSync(child, "module.exports = 'old-schema';");
    writeFileSync(
      entry,
      "const schema=require('./schema.cjs');module.exports={PrismaClient:class {constructor(){this.schema=schema;} }};",
    );
    writeFileSync(other, "module.exports={stable:true};");
    const req = createRequire(join(dir, "package.json"));
    const stale = req(entry),
      unrelated = req(other);
    const oldClient = new stale.PrismaClient();
    expect(oldClient.schema).toBe("old-schema");
    writeFileSync(child, "module.exports = 'new-schema';");
    expect(new (req(entry).PrismaClient)().schema).toBe("old-schema");
    const fresh = freshGeneratedModule(req, entry);
    expect(
      (new fresh.PrismaClient() as unknown as { schema: string }).schema,
    ).toBe("new-schema");
    expect(oldClient.schema).toBe("old-schema");
    expect(req(other)).toBe(unrelated);
    expect(req.cache[req.resolve(other)]?.exports).toBe(unrelated);
  });
  it("rejects a missing generated constructor instead of publishing a false success", () => {
    const dir = mkdtempSync(join(tmpdir(), "investor-dev-prisma-invalid-"));
    directories.push(dir);
    writeFileSync(join(dir, "package.json"), "{}");
    const entry = join(dir, "index.cjs");
    writeFileSync(entry, "module.exports = {}; ");
    const req = createRequire(join(dir, "package.json"));
    expect(() => freshGeneratedModule(req, entry)).toThrow(
      "Generated Prisma client is unavailable.",
    );
  });
});
