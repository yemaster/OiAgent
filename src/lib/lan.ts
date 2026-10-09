import type { Agent, Task } from "./types";
import { permissionOptions } from "./permissions";
export interface HostConfig {
  name: string;
  address: string;
  port: number;
  projects: string[];
  agents: string[];
  allowExecution: boolean;
}
export interface LanStatus {
  enabled: boolean;
  config: HostConfig;
  interfaces: { name: string; address: string }[];
  error: string;
  peers: { id: string; name: string; address: string }[];
  grants: {
    id: string;
    name: string;
    createdAt: string;
    projects: string[];
    allowExecution: boolean;
  }[];
  pending: { id: string; name: string; ip: string }[];
}
export interface RemoteDevice {
  id: string;
  name: string;
  address: string;
  online: boolean;
  error?: string;
  snapshot?: {
    name: string;
    allowExecution: boolean;
    agents: Agent[];
    projects: string[];
    tasks: Task[];
  };
}
export interface PairRequest {
  invite: {
    version: number;
    address: string;
    certificate: string;
    code: string;
    name: string;
  };
  id: string;
  ticket: string;
}
const devices = new Map<string, RemoteDevice>();
export function rememberDevices(values: RemoteDevice[]) {
  devices.clear();
  values.forEach((d) => devices.set(d.id, d));
}
export function remoteId(peerId: string, id: string) {
  return `lan:${peerId}:${id}`;
}
export function splitRemoteId(id: unknown) {
  if (typeof id !== "string" || !id.startsWith("lan:")) return undefined;
  const index = id.indexOf(":", 4);
  if (index < 0) return undefined;
  return { peerId: id.slice(4, index), id: id.slice(index + 1) };
}
export function remoteTask(task: Task, peerId: string): Task {
  const device = devices.get(peerId);
  return {
    ...task,
    id: remoteId(peerId, task.id),
    parentId: task.parentId ? remoteId(peerId, task.parentId) : undefined,
    terminalId: null,
    deviceId: peerId,
    deviceName: device?.snapshot?.name || device?.name || "局域网设备",
    deviceOnline: device?.online ?? true,
    deviceWritable: device?.snapshot?.allowExecution ?? true,
  };
}
export function remotePermissions(kind: string) {
  return permissionOptions(kind).filter(
    (o) =>
      ![
        "danger-full-access",
        "bypassPermissions",
        "yolo",
        ...(kind === "goose" ? ["auto"] : []),
      ].includes(o.value),
  );
}
