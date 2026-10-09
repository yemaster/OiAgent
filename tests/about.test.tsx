import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { About } from "@/components/workspace/About";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi
    .fn()
    .mockResolvedValue({ version: "2.3.4", os: "macos", arch: "aarch64" }),
}));
it("shows the installed app version and opens only named project destinations", async () => {
  const user = userEvent.setup();
  render(<About />);
  expect(await screen.findByText("版本 2.3.4")).toBeVisible();
  expect(screen.getByText("macOS · aarch64")).toBeVisible();
  await user.click(screen.getByRole("link", { name: "反馈问题" }));
  expect(call).toHaveBeenCalledWith("open_project_link", { page: "issues" });
  expect(screen.queryByText(/Tauri · React/)).not.toBeInTheDocument();
});
