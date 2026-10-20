import { createContext } from "react";

/** Explicit editor navigation from previews; ordinary image clicks stay in a dialog. */
export const ImageEditorContext = createContext<
  ((project: string, path: string) => void) | undefined
>(undefined);
