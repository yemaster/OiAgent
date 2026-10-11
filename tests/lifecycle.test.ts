import { expect, it } from "vitest";
import { automaticClose, type CloseInfo } from "@/lib/lifecycle";
const info: CloseInfo = {
  behavior: "ask",
  trayAvailable: true,
  running: 0,
  pending: "close",
};
it("asks by default and never hides without a working tray", () => {
  expect(automaticClose(info, 0)).toBeNull();
  expect(
    automaticClose({ ...info, behavior: "tray", trayAvailable: false }, 0),
  ).toBeNull();
  expect(
    automaticClose({ ...info, behavior: "tray", pending: null }, 0),
  ).toBeNull();
});
it("keeps edits and work alive in the tray, but explicit Quit is not redirected to the tray", () => {
  expect(automaticClose({ ...info, behavior: "tray", running: 3 }, 2)).toBe(
    "tray",
  );
  expect(
    automaticClose({ ...info, behavior: "tray", pending: "quit" }, 0),
  ).toBeNull();
});
it("requires confirmation before a remembered quit could lose work", () => {
  expect(automaticClose({ ...info, behavior: "quit" }, 0)).toBe("quit");
  expect(
    automaticClose({ ...info, behavior: "quit", running: 1 }, 0),
  ).toBeNull();
  expect(automaticClose({ ...info, behavior: "quit" }, 1)).toBeNull();
});
