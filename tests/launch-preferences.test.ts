import { beforeEach, expect, it } from "vitest";
import { demoSnapshot } from "@/lib/demo";
import {
  preferredAgent,
  preferredPermission,
  rememberLaunchChoice,
  rememberComposerChoice,
  preferredComposer,
} from "@/lib/launchPreferences";
import { blankProvider } from "@/lib/providers";
import { readModelOptions } from "@/lib/modelOptions";
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

it("restores API, model and native tuning per agent without copying prompts or raw flags", () => {
  const profile = { ...blankProvider, id: "team", name: "Team" };
  rememberLaunchChoice("local", codex, "workspace-write");
  rememberComposerChoice("local", codex, {
    model: "codex-custom",
    options: { effort: "high", serviceTier: "priority" },
  });
  rememberComposerChoice("local", claude, {
    providerId: profile.id,
    model: "",
  });
  const snapshot = {
    ...demoSnapshot,
    agents: [codex, claude],
    providers: [profile],
  };
  expect(newTaskDraft(snapshot, "all")).toMatchObject({
    agent: claude.id,
    providerId: "team",
    model: "",
    prompt: "",
    envText: "",
    argsText: "",
  });
  const codexDraft = newTaskDraft(snapshot, "/project", {
    ...demoSnapshot.tasks[0],
    agentId: codex.id,
  });
  expect(codexDraft.model).toBe("codex-custom");
  expect(readModelOptions("codex", codexDraft.argsText?.split("\n"))).toEqual({
    effort: "high",
    serviceTier: "priority",
  });
  expect(preferredComposer("local", claude, [])).toMatchObject({
    providerId: "local",
    model: "",
  });
  expect(preferredComposer("remote", codex)).toMatchObject({
    model: "",
    providerId: "local",
    options: { effort: "", serviceTier: "" },
  });
});
it("merges sequential picker changes and remembers returning to native defaults", () => {
  const qoder = { ...codex, id: "qoder", kind: "qodercn" };
  rememberComposerChoice("local", qoder, { model: "qoder-model" });
  rememberComposerChoice("local", qoder, {
    options: { effort: "max", serviceTier: "", contextWindow: 200000 },
  });
  expect(preferredComposer("local", qoder)).toMatchObject({
    model: "qoder-model",
    options: { effort: "max", contextWindow: 200000 },
  });
  rememberComposerChoice("local", qoder, {
    options: { effort: "", serviceTier: "" },
  });
  expect(preferredComposer("local", qoder)).toEqual({
    model: "qoder-model",
    providerId: "local",
    options: { effort: "", serviceTier: "" },
  });
  rememberComposerChoice("local", qoder, { model: "" });
  expect(preferredComposer("local", qoder).model).toBe("");
});
it("never shares local API choices or unsupported tuning with a remote device", () => {
  const profile = { ...blankProvider, id: "team" };
  rememberComposerChoice("local", claude, { providerId: "team" });
  rememberComposerChoice("peer", claude, {
    providerId: "team",
    model: "peer-model",
    options: { effort: "max", serviceTier: "priority", contextWindow: 1 },
  });
  expect(preferredComposer("peer", claude, [profile])).toEqual({
    providerId: "local",
    model: "peer-model",
    options: { effort: "", serviceTier: "" },
  });
  expect(preferredComposer("local", claude, [profile]).providerId).toBe("team");
  expect(preferredComposer("local", codex, [profile]).model).toBe("");
});
