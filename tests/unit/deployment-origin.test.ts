import { describe, expect, it } from "vitest";
import { deploymentOrigin } from "@/lib/deployment-origin.mjs";

describe("explicit deployment origin", () => {
  it("preserves the local default and derives local aliases from the selected port", () => {
    expect(deploymentOrigin()).toEqual({
      origin: "http://127.0.0.1:3000",
      host: "127.0.0.1:3000",
      local: true,
      trustedOrigins: ["http://127.0.0.1:3000", "http://localhost:3000"],
    });
    expect(deploymentOrigin("http://localhost:3108/").trustedOrigins).toEqual([
      "http://localhost:3108",
      "http://127.0.0.1:3108",
    ]);
    expect(deploymentOrigin("http://[::1]:3000").local).toBe(true);
  });

  it("canonicalizes an explicitly selected public origin with no loopback trust", () => {
    expect(deploymentOrigin("https://DESK.example.com:443/")).toEqual({
      origin: "https://desk.example.com",
      host: "desk.example.com",
      local: false,
      trustedOrigins: ["https://desk.example.com"],
    });
    expect(deploymentOrigin("https://desk.example.com:8443").host).toBe(
      "desk.example.com:8443",
    );
  });

  it.each([
    "",
    " ",
    " https://desk.example.com",
    "https://desk.example.com\n",
    "http://desk.example.com",
    "//desk.example.com",
    "ftp://desk.example.com",
    "https://user:password@desk.example.com",
    "https://desk.example.com/path",
    "https://desk.example.com/..",
    "https://desk.example.com?",
    "https://desk.example.com#",
    "https://desk.example.com/?query=1",
    "https://desk.example.com/#fragment",
    "https://*.example.com",
    "https://desk.example.com,https://other.example.com",
    "https://desk.example.com\\@evil.example.com",
    "https://%64esk.example.com",
    "https://desk.example.com.",
    "https://bad_name.example.com",
    "https://-bad.example.com",
    "https://desk",
    "https://desk.local",
    "https://desk.localhost",
    "https://desk.internal",
    "https://10.0.0.1",
    "https://0.0.0.0",
    "http://127.1",
    "http://2130706433",
    "https://[2001:db8::1]",
    "https://desk.example.com:0",
    "https://desk.example.com:65536",
  ])("fails closed for unsafe or malformed configuration: %s", (origin) => {
    expect(() => deploymentOrigin(origin)).toThrow("Invalid BETTER_AUTH_URL");
  });

  it("does not include rejected credentials in the error", () => {
    try {
      deploymentOrigin(
        "https://private-user:private-password@desk.example.com",
      );
      expect.fail("origin should be rejected");
    } catch (error) {
      expect(String(error)).not.toContain("private-user");
      expect(String(error)).not.toContain("private-password");
    }
  });
});
