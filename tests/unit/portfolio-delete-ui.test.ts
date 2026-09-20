// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  deleted: vi.fn(),
  saved: vi.fn(),
}));
vi.mock("@/lib/desk-types", () => ({ api: mocks.api }));
vi.mock("@/components/AmbientRadio", () => ({
  DialogRadioControl: () => null,
}));
import { PortfolioManager } from "@/components/studio/PortfolioManager";
import type { Portfolio } from "@/lib/desk-types";
import type { WorkspaceController } from "@/components/studio/useWorkspace";
import { defaultPreferences } from "@/lib/studio";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
const portfolio = { id: "p1", name: "My long horizon" } as Portfolio;
const workspace = {
  preferences: defaultPreferences,
  save: vi.fn(),
} as unknown as WorkspaceController;
function button(name: string) {
  const b = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
  );
  if (!b) throw Error(`Missing ${name}`);
  return b;
}
async function click(name: string) {
  await act(async () => {
    button(name).click();
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(PortfolioManager, {
        portfolios: [portfolio],
        workspace,
        close: vi.fn(),
        saved: mocks.saved,
        deleted: mocks.deleted,
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("portfolio deletion confirmation", () => {
  it("reconciles an absent portfolio after a committed deletion loses its response", async () => {
    mocks.api.mockRejectedValueOnce(new Error("Connection interrupted"));
    await click("Delete My long horizon");
    await click("Delete portfolio");
    expect(mocks.saved).toHaveBeenCalledOnce();
    expect(mocks.deleted).not.toHaveBeenCalled();
    await act(async () =>
      root.render(
        createElement(PortfolioManager, {
          portfolios: [],
          workspace,
          close: vi.fn(),
          saved: mocks.saved,
          deleted: mocks.deleted,
        }),
      ),
    );
    expect(mocks.deleted).toHaveBeenCalledExactlyOnceWith("p1", false);
  });
  it("opening and cancelling never sends a deletion, returns focus to the named action", async () => {
    await click("Delete My long horizon");
    expect(host.textContent).toContain("My long horizon");
    expect(host.textContent).toContain("Saved scenarios remain available");
    expect(document.activeElement).toBe(button("Keep portfolio"));
    await click("Keep portfolio");
    expect(document.activeElement).toBe(button("Delete My long horizon"));
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.deleted).not.toHaveBeenCalled();
  });
  it("submits only after confirmation, disables repeat and close while pending", async () => {
    let resolve!: (value: unknown) => void;
    mocks.api.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await click("Delete My long horizon");
    await click("Delete portfolio");
    expect(mocks.api).toHaveBeenCalledWith("/api/portfolios/p1", "DELETE", {
      name: "My long horizon",
    });
    expect(button("Keep portfolio").disabled).toBe(true);
    expect(button("Close dialog").disabled).toBe(true);
    expect(button("Deleting…").disabled).toBe(true);
    expect(mocks.deleted).not.toHaveBeenCalled();
    await act(async () => resolve({ deletedId: "p1" }));
    expect(mocks.deleted).toHaveBeenCalledExactlyOnceWith("p1");
  });
  it("keeps the confirmation on failure and supports retry", async () => {
    mocks.api
      .mockRejectedValueOnce(new Error("Could not delete; try again."))
      .mockResolvedValueOnce({ deletedId: "p1" });
    await click("Delete My long horizon");
    await click("Delete portfolio");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not delete",
    );
    expect(mocks.deleted).not.toHaveBeenCalled();
    expect(button("Delete portfolio").disabled).toBe(false);
    await click("Delete portfolio");
    expect(mocks.deleted).toHaveBeenCalledExactlyOnceWith("p1");
  });
});
