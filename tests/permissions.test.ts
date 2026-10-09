import { expect, it } from "vitest";
import { normalizePermission, permissionOptions } from "@/lib/permissions";

it("offers Claude Auto Mode without normalizing it to another permission", () => {
  expect(permissionOptions("claude")).toContainEqual({
    value: "auto",
    label: "Auto · 自动审查操作",
  });
  expect(normalizePermission("claude", "auto")).toBe("auto");
});
