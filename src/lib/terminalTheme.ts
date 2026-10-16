import type { ITheme } from "@xterm/xterm";
import { defaultSurfaces, textForBackground } from "./surfaceColors";
export const terminalThemes = [
  { value: "auto", label: "跟随应用" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "nord", label: "Nord" },
] as const;
export type TerminalTheme = (typeof terminalThemes)[number]["value"];
export function terminalPalette(
  choice: TerminalTheme,
  mode: string | undefined,
  surface?: string,
): ITheme {
  const dark =
    choice === "auto"
      ? surface
        ? textForBackground(surface) === "#ffffff"
        : mode === "dark"
      : choice !== "light";
  const background =
    choice === "auto" && surface
      ? surface
      : choice === "nord"
        ? "#2e3440"
        : defaultSurfaces[dark ? "dark" : "light"].background;
  const foreground =
    choice === "auto" && surface
      ? textForBackground(surface)
      : dark
        ? "#eceff4"
        : "#242424";
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: dark ? "#ffffff33" : "#00000022",
    black: dark ? "#4c566a" : "#242424",
    brightBlack: dark ? "#818a9b" : "#646464",
    red: dark ? "#e48789" : "#b42332",
    brightRed: dark ? "#f3a6a8" : "#bd2839",
    green: dark ? "#a3be8c" : "#36702b",
    brightGreen: dark ? "#b8d5a2" : "#36702b",
    yellow: dark ? "#ebcb8b" : "#886110",
    brightYellow: dark ? "#f7dea6" : "#886110",
    blue: dark ? "#81a1c1" : "#245da8",
    brightBlue: dark ? "#a0bfe0" : "#245da8",
    magenta: dark ? "#b48ead" : "#854490",
    brightMagenta: dark ? "#cfa7c7" : "#854490",
    cyan: dark ? "#88c0d0" : "#167080",
    brightCyan: dark ? "#a1d5e5" : "#167080",
    white: dark ? "#d8dee9" : "#777777",
    brightWhite: dark ? "#eceff4" : "#555555",
  };
}
