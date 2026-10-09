import { permissionOptions } from "./permissions";
import { remotePermissions } from "./lan";
import type { Agent } from "./types";

const key = "oiagent-launch-preferences";
type Preferences = {
  version: 1;
  agents: Record<string, string>;
  permissions: Record<string, string>;
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
