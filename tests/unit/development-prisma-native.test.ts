import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The subprocess requires a compilation of the actual production helper. It
// runs in native Node, outside Vitest's module evaluator, against fake generated
// classes only. It never loads @prisma/client, a database driver or app services.
const nativeChecks = String.raw`
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const helper = require(process.argv[2]);
const fixture = process.argv[3];
const check = process.argv[4];
const moduleApi = process.getBuiltinModule("module");
assert.equal(typeof moduleApi?.createRequire, "function");

const generatedDir = path.join(fixture, "node_modules/.prisma/client");
const siblingDir = path.join(fixture, "node_modules/.prisma/client-other");
fs.mkdirSync(generatedDir, { recursive: true });
fs.mkdirSync(siblingDir, { recursive: true });
fs.writeFileSync(path.join(fixture, "package.json"), "{}");
const entry = path.join(generatedDir, "index.js");
const child = path.join(generatedDir, "schema.cjs");
const sibling = path.join(siblingDir, "index.js");
const generatedCode = [
  "const schema=require('./schema.cjs');",
  "globalThis.fixtureGeneratedLoads=(globalThis.fixtureGeneratedLoads ?? 0)+1;",
  "module.exports={PrismaClient:class {",
  "constructor(){ this.schema=schema; this.disconnections=0; globalThis.fixtureInstances=(globalThis.fixtureInstances ?? 0)+1; }",
  "$disconnect(){ this.disconnections++; }",
  "query(){ if(this.disconnections) throw new Error('fixture client disconnected'); return this.schema; }",
  "beginQuery(){ let complete; const result=new Promise((resolve,reject)=>{ complete=()=>{ try { resolve(this.query()); } catch(error){ reject(error); } }; }); return { result, complete }; }",
  "}};",
].join("\n");
function writeGenerated(version) {
  fs.writeFileSync(child, "module.exports=" + JSON.stringify(version) + ";");
  fs.writeFileSync(entry, generatedCode + "\n// generated schema revision: " + version + "\n");
}
writeGenerated("old-schema");
fs.writeFileSync(sibling, "module.exports={stable:true};");
process.chdir(fixture);
const req = moduleApi.createRequire(path.join(fixture, "package.json"));
const resolvedEntry = req.resolve(".prisma/client/index");
assert.equal(resolvedEntry, fs.realpathSync(entry));
assert.equal(req.cache, moduleApi.Module._cache);
const expectedSignature = () => createHash("sha256").update(fs.readFileSync(resolvedEntry)).digest("hex");
const unrelated = req(sibling);

async function main() {
  if (check === "cold-and-reuse") {
    const loaded = helper.developmentPrismaClient(undefined, undefined);
    assert.equal(loaded.client.query(), "old-schema");
    assert.equal(loaded.signature, expectedSignature());
    assert.equal(globalThis.fixtureGeneratedLoads, 1);
    assert.equal(globalThis.fixtureInstances, 1);
    const reused = helper.developmentPrismaClient(loaded.client, loaded.signature);
    assert.equal(reused.client, loaded.client);
    assert.equal(reused.signature, loaded.signature);
    assert.equal(globalThis.fixtureGeneratedLoads, 1);
    assert.equal(globalThis.fixtureInstances, 1);
    assert.equal(loaded.client.disconnections, 0);
    // A missing instance must still be created even if its signature is known.
    const restored = helper.developmentPrismaClient(undefined, loaded.signature);
    assert.notEqual(restored.client, loaded.client);
    assert.equal(restored.client.query(), "old-schema");
    assert.equal(globalThis.fixtureInstances, 2);
  } else if (check === "changed-schema-and-inflight") {
    const old = helper.developmentPrismaClient(undefined, undefined);
    const inflight = old.client.beginQuery();
    const oldGenerated = req(resolvedEntry);
    const oldChild = req(req.resolve(child));
    writeGenerated("new-schema");
    assert.equal(req(resolvedEntry), oldGenerated);
    assert.equal(req(req.resolve(child)), oldChild);
    assert.equal(new (req(resolvedEntry).PrismaClient)().schema, "old-schema");
    const fresh = helper.developmentPrismaClient(old.client, old.signature);
    assert.notEqual(fresh.client, old.client);
    assert.notEqual(fresh.signature, old.signature);
    assert.equal(fresh.signature, expectedSignature());
    assert.equal(fresh.client.query(), "new-schema");
    assert.notEqual(req(resolvedEntry), oldGenerated);
    assert.equal(req(req.resolve(child)), "new-schema");
    inflight.complete();
    assert.equal(await inflight.result, "old-schema");
    assert.equal(old.client.query(), "old-schema");
    assert.equal(old.client.disconnections, 0);
    assert.equal(fresh.client.disconnections, 0);
  } else if (check === "resolved-directory-boundary") {
    const old = helper.developmentPrismaClient(undefined, undefined);
    // Force a second lexical spelling even on platforms whose tmpdir is already
    // canonical. macOS also spells ordinary tmp paths as /var vs /private/var.
    const aliasDir = path.join(fixture, "generated-alias");
    fs.symlinkSync(fs.realpathSync(generatedDir), aliasDir, "dir");
    const aliasEntry = path.join(aliasDir, "index.js");
    assert.equal(req.resolve(aliasEntry), resolvedEntry);
    assert.notEqual(aliasEntry, resolvedEntry);
    assert.equal(req.cache[resolvedEntry].exports.PrismaClient, req(aliasEntry).PrismaClient);
    fs.writeFileSync(child, "module.exports='new-schema';");
    assert.equal(new (req(aliasEntry).PrismaClient)().schema, "old-schema");
    const fresh = helper.freshGeneratedModule(req, aliasEntry);
    assert.equal(new fresh.PrismaClient().query(), "new-schema");
    assert.equal(req.cache[resolvedEntry].exports, fresh);
    assert.equal(req.cache[req.resolve(child)].exports, "new-schema");
    assert.equal(old.client.query(), "old-schema");
    assert.equal(old.client.disconnections, 0);
  } else if (check === "failed-load-no-publication") {
    const retained = helper.developmentPrismaClient(undefined, undefined);
    let published = retained;
    const instances = globalThis.fixtureInstances;
    fs.writeFileSync(entry, "module.exports={PrismaClient:'invalid constructor'};");
    assert.throws(() => {
      published = helper.developmentPrismaClient(published.client, published.signature);
    }, /Generated Prisma client is unavailable/);
    assert.equal(published, retained);
    assert.equal(published.signature, retained.signature);
    assert.notEqual(published.signature, expectedSignature());
    assert.equal(globalThis.fixtureInstances, instances);
    assert.equal(retained.client.query(), "old-schema");
    assert.equal(retained.client.disconnections, 0);
    fs.writeFileSync(entry, "module.exports={PrismaClient:class { constructor(){ throw new Error('fixture constructor failed'); } }};");
    assert.throws(() => {
      published = helper.developmentPrismaClient(published.client, published.signature);
    }, /fixture constructor failed/);
    assert.equal(published, retained);
    assert.equal(retained.client.query(), "old-schema");
    assert.equal(retained.client.disconnections, 0);
    // Repair permits a later retry; a failed signature was never published.
    writeGenerated("recovered-schema");
    published = helper.developmentPrismaClient(published.client, published.signature);
    assert.notEqual(published.client, retained.client);
    assert.equal(published.client.query(), "recovered-schema");
    assert.equal(published.signature, expectedSignature());
    assert.equal(retained.client.query(), "old-schema");
  } else {
    throw new Error("Unknown native regression case");
  }
  // The client-other prefix must not be treated as part of the client directory.
  assert.equal(req(sibling), unrelated);
  assert.equal(req.cache[req.resolve(sibling)].exports, unrelated);
  process.stdout.write(JSON.stringify({ check, passed: true }));
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
`;

function runNativeCheck(check: string) {
  const directory = mkdtempSync(join(tmpdir(), "investor-native-prisma-"));
  try {
    const source = readFileSync(
      resolve("src/server/services/development-prisma.ts"),
      "utf8",
    );
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const helper = join(directory, "development-prisma.cjs");
    const runner = join(directory, "native-check.cjs");
    writeFileSync(helper, compiled);
    writeFileSync(runner, nativeChecks);
    const output = execFileSync(
      process.execPath,
      [runner, helper, join(directory, "fixture"), check],
      {
        encoding: "utf8",
        timeout: 10000,
        // Prevent parent-process Node loader hooks from replacing native CJS.
        env: { ...process.env, NODE_OPTIONS: "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(JSON.parse(output)).toEqual({ check, passed: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("actual development Prisma helper in native Node (fake generated modules, no DB)", () => {
  it("creates the cold client and reuses an unchanged generated-file SHA", () => {
    runNativeCheck("cold-and-reuse");
  });

  it("refreshes changed entry and child code while an old client and its in-flight work stay usable", () => {
    runNativeCheck("changed-schema-and-inflight");
  });

  it("normalizes an aliased temporary entry and preserves a similarly named sibling cache", () => {
    runNativeCheck("resolved-directory-boundary");
  });

  it("throws before publishing an invalid replacement and permits a repaired retry", () => {
    runNativeCheck("failed-load-no-publication");
  });
});
