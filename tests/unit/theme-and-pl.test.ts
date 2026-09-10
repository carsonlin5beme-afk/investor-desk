// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { defaultPreferences, validateWorkspaceValue } from "@/lib/studio";
import { themeBootstrap } from "@/lib/theme";
import {
  DemoEquityProvider,
  DemoOptionsProvider,
  sampleSymbols,
} from "@/server/providers/demo";
import { quoteStatus } from "@/lib/quote-status";

describe("appearance initialization preserves explicit preferences", () => {
  it.each([undefined, "light", "dark", "system", "invalid"])(
    "boots safely with %s preference before app hydration",
    (preference) => {
      document.cookie = "investor-desk-theme=; Max-Age=0; Path=/";
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: false }),
      });
      if (preference) document.cookie = `investor-desk-theme=${preference}`;
      window.eval(themeBootstrap);
      expect(document.documentElement.dataset.theme).toBe(
        preference === "light" || preference === "system" ? "light" : "dark",
      );
    },
  );
  it("defaults only missing preferences to dark and preserves explicit Light/System workspace values", () => {
    expect(defaultPreferences.theme).toBe("dark");
    for (const theme of ["light", "system"])
      expect(
        validateWorkspaceValue("preferences", { ...defaultPreferences, theme }),
      ).toMatchObject({ theme });
  });
});

describe("PL is an illustrative sample through the existing providers", () => {
  it("returns demo equity and both standard option rights with matching fresh quote metadata", async () => {
    const equity = await new DemoEquityProvider().getQuote("PL");
    expect(equity).toMatchObject({ symbol: "PL", source: "demo", mark: 12 });
    expect(sampleSymbols.find((row) => row.symbol === "PL")?.name).toBe(
      "Planet Labs PBC",
    );
    const options = new DemoOptionsProvider(),
      dates = await options.getExpirations("PL"),
      chain = await options.getOptionChain("PL", dates[0]);
    expect(dates.length).toBeGreaterThan(0);
    expect(chain.length).toBeGreaterThan(0);
    for (const right of ["CALL", "PUT"]) {
      const contract = chain.find((row) => row.right === right)!;
      expect(
        await options.getOptionQuote(contract.contractSymbol),
      ).toMatchObject({
        underlying: "PL",
        right,
        multiplier: 100,
        source: "demo",
      });
    }
    expect(
      quoteStatus({ symbol: "PL", source: equity!.source, hasQuote: true })
        .label,
    ).toBe("Sample prices only");
  });
  it("keeps unsupported sample symbols unavailable without network fallback", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(
      await new DemoEquityProvider().getQuote("UNKNOWNFIXTURE"),
    ).toBeNull();
    expect(
      await new DemoOptionsProvider().getExpirations("UNKNOWNFIXTURE"),
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
    expect(
      quoteStatus({ source: "demo", symbol: "UNKNOWNFIXTURE", hasQuote: false })
        .message,
    ).toContain("Try PL");
  });
});
