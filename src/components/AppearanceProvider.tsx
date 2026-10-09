import { useLayoutEffect, useState, type ReactNode } from "react";
import {
  AppearanceContext,
  accentChoices,
  type ChatSize,
} from "@/lib/appearance";
import { ThemeProvider } from "next-themes";

function readChoice<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T,
): T {
  const value = localStorage.getItem(key) as T;
  return choices.includes(value) ? value : fallback;
}
export function AppearanceProvider({ children }: { children: ReactNode }) {
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
    <ThemeProvider
      attribute="class"
      storageKey="oiagent-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AppearanceContext.Provider
        value={{ accent, chatSize, setAccent, setChatSize }}
      >
        {children}
      </AppearanceContext.Provider>
    </ThemeProvider>
  );
}
