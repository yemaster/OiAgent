import { useLayoutEffect, useState, type ReactNode } from "react";
import {
  AppearanceContext,
  accentChoices,
  type ChatSize,
} from "@/lib/appearance";
import {
  readSurfaceColors,
  validColor,
  surfaceTokens,
  editorThemes,
  type ColorMode,
  type Surface,
} from "@/lib/surfaceColors";
import { ThemeProvider, useTheme } from "next-themes";

function readChoice<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T,
): T {
  const value = localStorage.getItem(key) as T;
  return choices.includes(value) ? value : fallback;
}
function AppearanceValues({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const mode = resolvedTheme === "dark" ? "dark" : "light";
  const [surfaces, setSurfaces] = useState(readSurfaceColors);
  const [editorTheme, setEditorTheme] = useState(() =>
    readChoice(
      "oiagent-editor-theme",
      editorThemes.map((t) => t.value),
      "auto",
    ),
  );
  function setSurface(
    mode: ColorMode,
    surface: Surface,
    color: string | undefined,
  ) {
    if (color !== undefined && !validColor(color)) return;
    setSurfaces((old) => ({
      ...old,
      [mode]: { ...old[mode], [surface]: color },
    }));
  }
  function resetSurfaces(mode: ColorMode) {
    setSurfaces((old) => ({ ...old, [mode]: {} }));
  }
  useLayoutEffect(() => {
    localStorage.setItem("oiagent-surfaces", JSON.stringify(surfaces));
    localStorage.setItem("oiagent-editor-theme", editorTheme);
    const tokens = { ...surfaceTokens(surfaces[mode].background) } as Record<
      string,
      string
    >;
    for (const key of Object.keys(tokens))
      if (key.startsWith("--sidebar")) delete tokens[key];
    for (const [key, value] of Object.entries(tokens))
      document.documentElement.style.setProperty(key, value);
    return () => {
      for (const key of Object.keys(tokens))
        document.documentElement.style.removeProperty(key);
    };
  }, [mode, surfaces, editorTheme]);
  const [accent, setAccent] = useState(() =>
    readChoice(
      "oiagent-accent",
      accentChoices.map((c) => c.value),
      "neutral",
    ),
  );
  const [chatSize, setChatSize] = useState(() =>
    readChoice<ChatSize>("oiagent-chat-size", ["13", "14", "16"], "14"),
  );
  useLayoutEffect(() => {
    document.documentElement.dataset.accent = accent;
    document.documentElement.style.setProperty(
      "--chat-font-size",
      `${chatSize}px`,
    );
    localStorage.setItem("oiagent-accent", accent);
    localStorage.setItem("oiagent-chat-size", chatSize);
  }, [accent, chatSize]);
  return (
    <AppearanceContext.Provider
      value={{
        accent,
        chatSize,
        setAccent,
        setChatSize,
        surfaces,
        setSurface,
        resetSurfaces,
        editorTheme,
        setEditorTheme,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}
export function AppearanceProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      storageKey="oiagent-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AppearanceValues>{children}</AppearanceValues>
    </ThemeProvider>
  );
}
