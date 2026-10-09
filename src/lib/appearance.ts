import type {
  Surface,
  ColorMode,
  SurfaceColors,
  EditorTheme,
} from "./surfaceColors";
import { createContext, useContext } from "react";
export const accentChoices = [
  {
    value: "neutral",
    label: "石墨",
    swatch: "bg-neutral-600 dark:bg-neutral-300",
  },
  { value: "blue", label: "蓝色", swatch: "bg-blue-600 dark:bg-blue-400" },
  {
    value: "green",
    label: "绿色",
    swatch: "bg-emerald-700 dark:bg-emerald-400",
  },
  {
    value: "violet",
    label: "紫色",
    swatch: "bg-violet-600 dark:bg-violet-400",
  },
] as const;
export type Accent = (typeof accentChoices)[number]["value"];
export type ChatSize = "13" | "14" | "16";
export const AppearanceContext = createContext({
  accent: "neutral" as Accent,
  chatSize: "14" as ChatSize,
  surfaces: { light: {}, dark: {} } as SurfaceColors,
  setSurface: (
    _mode: ColorMode,
    _surface: Surface,
    _color: string | undefined,
  ) => {},
  resetSurfaces: (_mode: ColorMode) => {},
  editorTheme: "auto" as EditorTheme,
  setEditorTheme: (_theme: EditorTheme) => {},
  setAccent: (_value: Accent) => {},
  setChatSize: (_value: ChatSize) => {},
});
export const useAppearance = () => useContext(AppearanceContext);
