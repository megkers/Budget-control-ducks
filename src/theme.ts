import type { ThemePref, ResolvedTheme, ThemeTokens } from "./types.js";

// ---- Theme tokens: dark / light (ref: Figma Design System page) ----
export function loadTheme(): ThemePref {
  try { return (localStorage.getItem("budgetTheme") || "dark") as ThemePref; } catch(e) { return "dark"; }
}
export function saveTheme(t: ThemePref): void {
  try { localStorage.setItem("budgetTheme", t); } catch(e) {}
}

export var THEMES: Record<ResolvedTheme, ThemeTokens> = {
  dark: {
    bg: "#0a0e17", surf: "#131825", surf2: "#0f1218", bord: "#1e2535",
    text1: "#e8eaf0", text2: "#D8DDE8", text3: "#9ca3af", muted: "#4a5568",
    blue: "#4A9EFF", green: "#7ed4a0", red: "#ff4444",
    blueBg: "#0f1f2a", blueBord: "#4A9EFF33",
    redFade: "#ff444455", orangeFade: "#FFB34755",
    greenBg: "#0f2a1a", greenBord: "#7ed4a033",
  },
  light: {
    bg: "#f5f6fb", surf: "#ffffff", surf2: "#e8ecf4", bord: "#dde1ea",
    text1: "#111827", text2: "#374151", text3: "#6b7280", muted: "#bec2ca",
    blue: "#3A95FF", green: "#34d399", red: "#ff4444",
    blueBg: "#eaf2ff", blueBord: "#3A95FF33",
    redFade: "#ff444418", orangeFade: "#FFB34718",
    greenBg: "#eafff0", greenBord: "#34d39933",
  },
};

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === "system") {
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch(e) { return "dark"; }
  }
  return pref === "light" ? "light" : "dark";
}
