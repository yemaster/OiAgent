import { expect, it } from "vitest";
import { normalizePermission, permissionOptions } from "@/lib/permissions";

it("offers Claude Auto Mode without normalizing it to another permission", () => {
  expect(permissionOptions("claude")).toContainEqual({
    value: "auto",
    label: "Auto · 自动审查操作",
  });
  expect(normalizePermission("claude", "auto")).toBe("auto");
});

it("keeps Qoder CN native permissions and excludes bypass on LAN", async () => {
  const { remotePermissions } = await import("@/lib/lan");
  const { agentCatalog } = await import("@/lib/agents");
  expect(agentCatalog.qodercn).toMatchObject({
    name: "Qoder CLI CN",
    history: true,
    structured: true,
    resume: true,
  });
  expect(normalizePermission("qodercn", "workspace-write")).toBe(
    "accept_edits",
  );
  expect(normalizePermission("qodercn", "auto")).toBe("auto");
  expect(
    remotePermissions("qodercn").map((option) => option.value),
  ).not.toContain("bypass_permissions");
});
