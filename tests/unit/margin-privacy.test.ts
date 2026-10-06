// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InvestorDesk } from "@/components/InvestorDesk";
import { ScenarioStudio } from "@/components/studio/ScenarioStudio";
import { defaultPreferences } from "@/lib/studio";
import { monthlyPortfolioFixture } from "../fixtures/monthly-scenario";
vi.mock("@/components/studio/ValueChart", () => ({ ValueChart: () => null }));
vi.mock("@/components/studio/MonthlyChart", () => ({
  MonthlyChart: () => null,
}));
vi.mock("@/components/DeskModal", () => ({
  DeskModal: ({ children }: { children: React.ReactNode }) =>
    createElement("div", { role: "dialog" }, children),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("@/components/AmbientRadio", () => ({
  AmbientRadioControls: () => null,
  DialogRadioControl: () => null,
}));
vi.mock("@/components/SidebarAsteroids", () => ({
  SidebarAsteroids: () => null,
}));
vi.mock("@/components/SidebarRings", () => ({ SidebarRings: () => null }));
vi.mock("@/components/studio/Trajectory", () => ({ Trajectory: () => null }));
vi.mock("@/components/studio/useWorkspace", () => ({
  useWorkspace: () => ({
    identity: "privacy-picker",
    entries: [],
    loading: false,
    error: "",
    preferences: { ...defaultPreferences, privacy: true },
    reload: vi.fn(),
    updatePreferences: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("masks debt and financing interest in target preview prose while retaining the elapsed-day explanation", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-10-01T16:00:00Z");
  sessionStorage.clear();
  const host = document.createElement("div");
  host.dataset.privacy = "true";
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        createElement(ScenarioStudio, {
          portfolios: [
            {
              ...monthlyPortfolioFixture(),
              margin: {
                debt: 10000,
                aprPercent: 12,
                maintenancePercent: 30,
                dayCountBasis: 360,
              },
            },
          ],
          workspace: {
            identity: "margin-privacy",
            entries: [],
            loading: false,
            error: "",
            preferences: { ...defaultPreferences, privacy: true },
            reload: vi.fn(),
            updatePreferences: vi.fn(),
            save: vi.fn(),
            remove: vi.fn(),
          },
        }),
      ),
    );
    const click = (text: string) =>
      act(() =>
        [...host.querySelectorAll<HTMLButtonElement>("button")]
          .find((e) => e.textContent?.trim() === text)!
          .click(),
      );
    await click("Target progress");
    await click("New scenario");
    await act(() => {
      const days = [...host.querySelectorAll<HTMLInputElement>("input")].find(
        (e) =>
          e.closest("label")?.textContent?.trim().startsWith("Days forward"),
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(days, "30");
      days.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const prose = [...host.querySelectorAll("p")].find((e) =>
      e.textContent?.startsWith("Margin debt"),
    )!;
    expect(prose.textContent).toContain("$10,000.00");
    expect(prose.textContent).toContain("$100.48");
    expect(prose.textContent).toContain("30 Eastern calendar days");
    const currency = [...prose.querySelectorAll(".private-value")].map((e) =>
      e.textContent?.trim(),
    );
    expect(currency).toEqual(["$10,000.00", "$100.48"]);
    // Every currency-bearing text node must have the existing mask ancestor.
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.includes("$"))
        expect(node.parentElement?.closest(".private-value")).not.toBeNull();
    }
  } finally {
    await act(() => root.unmount());
    host.remove();
    sessionStorage.clear();
    vi.useRealTimers();
  }
});

it("masks each debt amount in the account picker while account names remain readable", async () => {
  const portfolio = monthlyPortfolioFixture();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        mode: "demo",
        guest: true,
        guestId: "privacy",
        user: null,
        portfolios: [
          {
            ...portfolio,
            name: "Alpha",
            margin: {
              debt: 12345.67,
              aprPercent: 12,
              maintenancePercent: 30,
              dayCountBasis: 360,
            },
          },
          {
            ...portfolio,
            id: "second",
            name: "Beta",
            positions: [],
            margin: {
              debt: 7654.32,
              aprPercent: 10,
              maintenancePercent: 25,
              dayCountBasis: 365,
            },
          },
        ],
      }),
    })),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(createElement(InvestorDesk)));
    await act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((e) => e.textContent?.trim() === "Manage margin")!
        .click(),
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Alpha");
    expect(dialog.textContent).toContain("Beta");
    const masks = [...dialog.querySelectorAll(".private-value")];
    expect(masks.map((el) => el.textContent)).toEqual([
      "$12,345.67",
      "$7,654.32",
    ]);
    for (const mask of masks)
      expect(mask.textContent).not.toMatch(/Alpha|Beta/);
    await act(() => masks[0].closest<HTMLButtonElement>("button")!.click());
    const warning = [...document.querySelectorAll('[role="status"]')].find(
      (el) => el.textContent?.startsWith("Modeled maintenance shortfall"),
    )!;
    expect(warning.textContent).toContain("$10,995.67");
    expect(warning.querySelector(".private-value")?.textContent?.trim()).toBe(
      "$10,995.67",
    );
    expect(warning.textContent).toContain("Saving does not liquidate");
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
