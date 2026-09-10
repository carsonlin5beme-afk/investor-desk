export type ThemePreference = "light" | "dark" | "system";
export const themeCookie = "investor-desk-theme";

// A paint hint mirrors the existing workspace preference; it is never written
// back into workspace records or used to overwrite a saved profile preference.
export function applyThemePreference(preference: ThemePreference) {
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  try {
    document.cookie = `${themeCookie}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    /* Restricted storage still permits an in-memory appearance. */
  }
}

// Runs in the document head before content paints, including landing/auth pages.
// Only the three fixed enum values can affect the DOM; no stored text is emitted.
export const themeBootstrap = `(function(){var p="dark";try{var m=document.cookie.match(/(?:^|;\\s*)investor-desk-theme=(light|dark|system)(?:;|$)/);if(m)p=m[1]}catch(e){}var r=document.documentElement;r.dataset.themePreference=p;r.dataset.theme=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p})()`;
