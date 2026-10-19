import { permissionOptions } from "./permissions";
import { remotePermissions } from "./lan";
import type { Agent, ProviderProfile } from "./types";
import { emptyModelOptions, type ModelOptions } from "./modelOptions";

export type ComposerChoices = {
  model: string;
  providerId: string;
  options: ModelOptions;
};

const key = "oiagent-launch-preferences";
type Preferences = {
  version: 1;
  agents: Record<string, string>;
  permissions: Record<string, string>;
  composers?: Record<string, Partial<ComposerChoices>>;
};
function read(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (
      value?.version === 1 &&
      value.agents &&
      value.permissions &&
      typeof value.agents === "object" &&
      typeof value.permissions === "object" &&
      Object.values(value.agents).every((v) => typeof v === "string") &&
      Object.values(value.permissions).every((v) => typeof v === "string")
    )
      return value;
  } catch {
    /* Missing or invalid preferences use current program defaults. */
  }
  return { version: 1, agents: {}, permissions: {} };
}
export function preferredAgent(
  agents: Agent[],
  deviceId = "local",
  contextId?: string,
) {
  const saved = read().agents[`device:${deviceId}`];
  return (
    agents.find((a) => a.available && a.id === contextId) ||
    agents.find((a) => a.available && a.id === saved) ||
    agents.find((a) => a.available)
  );
}
export function preferredPermission(
  deviceId: string,
  agent?: Pick<Agent, "id" | "kind">,
  explicit?: string,
) {
  const options = (
    deviceId === "local" ? permissionOptions : remotePermissions
  )(agent?.kind || "");
  const saved =
    explicit ??
    read().permissions[JSON.stringify([deviceId, agent?.id, agent?.kind])];
  return options.find((o) => o.value === saved)?.value || options[0].value;
}
/** Persist only explicit UI selections, never prompts, credentials or launch arguments. */
export function rememberLaunchChoice(
  deviceId: string,
  agent: Agent,
  permission: string,
) {
  const preferences = read();
  preferences.agents[`device:${deviceId}`] = agent.id;
  preferences.permissions[JSON.stringify([deviceId, agent.id, agent.kind])] =
    preferredPermission(deviceId, agent, permission);
  localStorage.setItem(key, JSON.stringify(preferences));
}

const composerKey = (deviceId: string, agent: Pick<Agent, "id" | "kind">) =>
  JSON.stringify([deviceId, agent.id, agent.kind]);
function modelOptions(value: Partial<ModelOptions> | undefined): ModelOptions {
  return {
    effort: typeof value?.effort === "string" ? value.effort : "",
    serviceTier:
      typeof value?.serviceTier === "string" ? value.serviceTier : "",
    ...(typeof value?.contextWindow === "number" &&
    Number.isSafeInteger(value.contextWindow) &&
    value.contextWindow > 0
      ? { contextWindow: value.contextWindow }
      : {}),
  };
}
export function preferredComposer(
  deviceId: string,
  agent?: Pick<Agent, "id" | "kind">,
  profiles: ProviderProfile[] = [],
): ComposerChoices {
  const saved = agent
    ? read().composers?.[composerKey(deviceId, agent)]
    : undefined;
  const providerId =
    deviceId === "local" &&
    agent?.kind === "claude" &&
    profiles.some((p) => p.id === saved?.providerId)
      ? saved!.providerId!
      : "local";
  return {
    // A removed API profile must not leave its model name attached to the local API.
    model:
      agent?.kind === "claude" &&
      saved?.providerId &&
      saved.providerId !== "local"
        ? ""
        : typeof saved?.model === "string"
          ? saved.model
          : "",
    providerId,
    options:
      deviceId === "local"
        ? modelOptions(saved?.options)
        : { ...emptyModelOptions },
  };
}
/** Only picker values are persisted, never raw flags, environment variables, or credentials. */
export function rememberComposerChoice(
  deviceId: string,
  agent: Pick<Agent, "id" | "kind">,
  patch: Partial<ComposerChoices>,
) {
  const preferences = read();
  const entryKey = composerKey(deviceId, agent);
  const previous = preferences.composers?.[entryKey];
  preferences.agents[`device:${deviceId}`] = agent.id;
  preferences.composers = {
    ...preferences.composers,
    [entryKey]: {
      model: patch.model ?? previous?.model ?? "",
      providerId:
        deviceId === "local" && agent.kind === "claude"
          ? (patch.providerId ?? previous?.providerId ?? "local")
          : "local",
      options:
        deviceId === "local"
          ? modelOptions(patch.options ?? previous?.options)
          : { ...emptyModelOptions },
    },
  };
  localStorage.setItem(key, JSON.stringify(preferences));
}
