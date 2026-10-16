import { describe, expect, it } from "vitest";
import { terminalPalette } from "../src/lib/terminalTheme";
import { defaultSurfaces } from "../src/lib/surfaceColors";
describe("terminal appearance", () => {
  it("follows the application surface and keeps custom backgrounds readable", () => {
    expect(terminalPalette("auto", "light").background).toBe(
      defaultSurfaces.light.background,
    );
    expect(terminalPalette("auto", "dark").background).toBe(
      defaultSurfaces.dark.background,
    );
    expect(terminalPalette("auto", "dark", "#ffffff")).toMatchObject({
      background: "#ffffff",
      foreground: "#000000",
    });
  });
  it("keeps an explicit terminal palette when the app theme changes", () => {
    for (const theme of ["light", "dark", "nord"] as const) {
      expect(terminalPalette(theme, "light", "#ffffff")).toEqual(
        terminalPalette(theme, "dark", "#111111"),
      );
    }
  });
});
