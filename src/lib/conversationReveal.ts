import { createContext } from "react";

/** A sidebar link reveals its destination without opening conversation search. */
export const ConversationRevealContext = createContext<{
  key: string;
  dismiss: () => void;
} | null>(null);
