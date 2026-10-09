import type { CSSProperties } from "react";
export type Surface = "background" | "navigation" | "sidebar";
export type ColorMode = "light" | "dark";
export type SurfaceColors = Record<ColorMode, Partial<Record<Surface, string>>>;
export const defaultSurfaces: Record<ColorMode, Record<Surface, string>> = {
  light: { background: "#ffffff", navigation: "#f7f7f5", sidebar: "#f7f7f5" },
  dark: { background: "#111111", navigation: "#1b1b1b", sidebar: "#1b1b1b" },
};
export const surfaces: { id: Surface; label: string }[] = [
  { id: "background", label: "内容与对话背景" },
  { id: "navigation", label: "图标导航栏背景" },
  { id: "sidebar", label: "侧边栏背景" },
];
export const validColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
export function readSurfaceColors(): SurfaceColors {
  const result: SurfaceColors = { light: {}, dark: {} };
  try {
    const raw = JSON.parse(localStorage.getItem("oiagent-surfaces") || "null");
    for (const mode of ["light", "dark"] as const)
      for (const { id } of surfaces)
        if (validColor(raw?.[mode]?.[id])) result[mode][id] = raw[mode][id];
  } catch {
    /* Use theme defaults if preferences cannot be read. */
  }
  return result;
}
export function textForBackground(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  // Choose the higher-contrast black/white text, including mid-tone custom colors.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}
export function surfaceTokens(color?: string): CSSProperties {
  if (!validColor(color)) return {};
  const text = textForBackground(color);
  const muted = `color-mix(in srgb, ${text} 68%, ${color})`;
  const hover = `color-mix(in srgb, ${text} 10%, ${color})`;
  const active = `color-mix(in srgb, ${text} 18%, ${color})`;
  return {
    "--background": color,
    "--foreground": text,
    "--card": color,
    "--card-foreground": text,
    "--popover": color,
    "--popover-foreground": text,
    "--sidebar": color,
    "--sidebar-foreground": text,
    "--sidebar-accent": active,
    "--sidebar-accent-foreground": text,
    "--sidebar-primary": text,
    "--sidebar-primary-foreground": color,
    "--muted": hover,
    "--muted-foreground": muted,
    "--accent": active,
    "--accent-foreground": text,
    "--secondary": hover,
    "--secondary-foreground": text,
    "--border": `color-mix(in srgb, ${text} 20%, ${color})`,
    "--input": `color-mix(in srgb, ${text} 24%, ${color})`,
  } as CSSProperties;
}
export const editorThemes = [
  { value: "auto", label: "跟随应用" },
  { value: "vs", label: "Visual Studio 浅色" },
  { value: "vs-dark", label: "Visual Studio 深色" },
  { value: "hc-black", label: "高对比度深色" },
  { value: "hc-light", label: "高对比度浅色" },
] as const;
export type EditorTheme = (typeof editorThemes)[number]["value"];
export function resolvedEditorTheme(theme: EditorTheme, mode?: string) {
  return theme === "auto" ? (mode === "dark" ? "vs-dark" : "vs") : theme;
}
