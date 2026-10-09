import type { ProviderProfile } from "./types";
export const blankProvider: ProviderProfile = {
  id: "",
  name: "",
  baseUrl: "",
  authType: "auth-token",
  defaultModel: "",
  haikuModel: "",
  sonnetModel: "",
  opusModel: "",
  fableModel: "",
  hasKey: false,
};
export interface ProviderDraft {
  sessionId: string;
  profile: ProviderProfile;
  apiKey: string;
  savedBaseUrl: string;
  savedAuthType: string;
}
export function providerDraft(
  profile: ProviderProfile = blankProvider,
): ProviderDraft {
  return {
    sessionId: crypto.randomUUID(),
    profile: { ...blankProvider, ...profile },
    apiKey: "",
    savedBaseUrl: profile.baseUrl,
    savedAuthType: profile.authType,
  };
}
export interface RemoteModel {
  id: string;
  name: string;
}
export interface ModelList {
  models: RemoteModel[];
  truncated: boolean;
}
export interface ConnectionTest {
  model: string;
  latencyMs: number;
}
export const providerTestModel = (p: ProviderProfile) =>
  p.defaultModel ||
  p.sonnetModel ||
  p.haikuModel ||
  p.opusModel ||
  p.fableModel ||
  "";
