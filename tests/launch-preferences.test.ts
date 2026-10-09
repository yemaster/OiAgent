import { beforeEach, expect, it } from "vitest";
import { demoSnapshot } from "@/lib/demo";
import {
  preferredAgent,
  preferredPermission,
  rememberLaunchChoice,
} from "@/lib/launchPreferences";
import { newTaskDraft } from "@/lib/newTask";

beforeEach(() => localStorage.clear());
const codex = {
  ...demoSnapshot.agents[0],
  id: "codex",
  kind: "codex",
  available: true,
};
const claude = { ...codex, id: "claude", kind: "claude" };
it("remembers agent and separate permissions across new task drafts", () => {
  rememberLaunchChoice("local", codex, "workspace-write");
  rememberLaunchChoice("local", claude, "auto");
  expect(preferredAgent([codex, claude])).toEqual(claude);
  expect(preferredPermission("local", codex)).toBe("workspace-write");
  expect(preferredPermission("local", claude)).toBe("auto");
  const draft = newTaskDraft(
    { ...demoSnapshot, agents: [codex, claude] },
    "all",
  );
  expect(draft).toMatchObject({
    agent: "claude",
    permission: "auto",
    prompt: "",
    envText: "",
  });
  expect(preferredAgent([codex, claude], "local", "codex")).toEqual(codex);
});
it("isolates devices, validates permissions and falls back when an agent disappears", () => {
  rememberLaunchChoice("local", claude, "bypassPermissions");
  expect(preferredPermission("peer", claude)).toBe("plan");
  rememberLaunchChoice("peer", claude, "bypassPermissions");
  expect(preferredPermission("peer", claude)).toBe("plan");
  expect(preferredPermission("local", claude)).toBe("bypassPermissions");
  expect(preferredAgent([codex, { ...claude, available: false }])).toEqual(
    codex,
  );
  localStorage.setItem("oiagent-launch-preferences", "broken");
  expect(preferredAgent([codex, claude])).toEqual(codex);
  expect(preferredPermission("local", claude, "removed-mode")).toBe("plan");
});
