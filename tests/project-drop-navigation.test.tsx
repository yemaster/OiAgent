import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "@/App";
const drop = vi.hoisted((): { open: (path: string) => void } => ({
  open: () => {},
}));
vi.mock("@/hooks/useProjectDrop", () => ({
  useProjectDrop: (open: (path: string) => void) => {
    drop.open = open;
    return false;
  },
}));
it("opens a local project composer while retaining tabs and the unsent prompt", async () => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(
    screen.getByRole("button", {
      name: /^打开会话：检查 API 错误处理与重试逻辑/,
    }),
  );
  await screen.findByRole("heading", { name: "检查 API 错误处理与重试逻辑" });
  await act(async () => drop.open("/tmp/dropped-project"));
  expect(await screen.findByRole("textbox", { name: "任务内容" })).toHaveValue(
    "",
  );
  expect(
    screen.getByRole("tab", { name: "当前页面：dropped-project" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    screen.getByRole("tab", { name: /检查 API 错误处理与重试逻辑/ }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "选择项目" })).toHaveTextContent(
    "dropped-project",
  );
  await user.type(
    screen.getByRole("textbox", { name: "任务内容" }),
    "保留待发送内容",
  );
  await act(async () => drop.open("/tmp/another-project"));
  expect(screen.getByRole("textbox", { name: "任务内容" })).toHaveValue(
    "保留待发送内容",
  );
  expect(screen.getByRole("button", { name: "选择项目" })).toHaveTextContent(
    "another-project",
  );
});
