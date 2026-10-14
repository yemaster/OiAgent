import { expect, it } from "vitest";
import {
  closeEditorTab,
  editorGroups,
  initialEditorLayout,
  mergeEditorGroups,
  moveEditorTab,
  reconcileEditorLayout,
} from "@/lib/editorGroups";

it("splits in both directions, moves mixed tabs without duplicates, and collapses empty groups", () => {
  let layout = initialEditorLayout(
    ["page", "task:a", "file:b", "extension:c"],
    "task:a",
  );
  layout = moveEditorTab(layout, "task:a", "group-0", "right");
  expect(layout.root.kind === "split" && layout.root.direction).toBe(
    "horizontal",
  );
  layout = moveEditorTab(layout, "file:b", "group-1", "bottom");
  expect(editorGroups(layout.root).map((g) => g.tabs)).toEqual([
    ["page", "extension:c"],
    ["task:a"],
    ["file:b"],
  ]);
  layout = moveEditorTab(layout, "extension:c", "group-1", undefined, "task:a");
  expect(
    editorGroups(layout.root).find((g) => g.id === "group-1")?.tabs,
  ).toEqual(["extension:c", "task:a"]);
  layout = closeEditorTab(layout, "file:b");
  expect(editorGroups(layout.root)).toHaveLength(2);
  layout = closeEditorTab(layout, "task:a");
  expect(
    editorGroups(layout.root).find((g) => g.id === "group-1")?.active,
  ).toBe("extension:c");
  layout = closeEditorTab(layout, "extension:c");
  expect(editorGroups(layout.root).map((g) => g.tabs)).toEqual([["page"]]);
});

it("opens into the focused group, focuses existing tabs in their own group and preserves other selections", () => {
  let layout = initialEditorLayout(["page", "task:a", "file:b"], "task:a");
  layout = moveEditorTab(layout, "task:a", "group-0", "left");
  layout = reconcileEditorLayout(
    layout,
    ["page", "task:a", "file:b", "task:d"],
    "task:d",
  );
  expect(editorGroups(layout.root)[0].tabs).toEqual(["task:a", "task:d"]);
  layout = reconcileEditorLayout(
    layout,
    ["page", "task:a", "file:b", "task:d"],
    "file:b",
  );
  expect(editorGroups(layout.root).map((g) => g.active)).toEqual([
    "task:d",
    "file:b",
  ]);
  layout = closeEditorTab(layout, "file:b");
  expect(editorGroups(layout.root).map((g) => g.active)).toEqual([
    "task:d",
    "page",
  ]);
  layout = mergeEditorGroups(layout, "group-1");
  expect(editorGroups(layout.root)).toHaveLength(1);
  expect(editorGroups(layout.root)[0].tabs).toEqual([
    "task:a",
    "task:d",
    "page",
  ]);
});

it("does not split the only tab into an empty group and keeps within-group sorting separate from visit history", () => {
  let layout = initialEditorLayout(["page", "task:a", "task:b"], "task:a");
  layout = moveEditorTab(layout, "task:b", "group-0", "right");
  expect(moveEditorTab(layout, "task:b", "group-1", "bottom")).toBe(layout);
  const before = editorGroups(layout.root)[0];
  layout = moveEditorTab(layout, "task:a", "group-0", undefined, "page");
  expect(editorGroups(layout.root)[0].history).toEqual(before.history);
  layout = reconcileEditorLayout(layout, ["page", "task:a"], "task:a");
  expect(editorGroups(layout.root)).toHaveLength(1);
  expect(editorGroups(layout.root)[0].tabs).toEqual(["task:a", "page"]);
});
