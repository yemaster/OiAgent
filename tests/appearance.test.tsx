import { beforeEach, expect, it } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import {
  readSurfaceColors,
  resolvedEditorTheme,
  textForBackground,
} from "@/lib/surfaceColors";
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
  localStorage.setItem("oiagent-theme", "light");
});
it("ignores malformed colors and resolves editor themes independently", () => {
  localStorage.setItem(
    "oiagent-surfaces",
    JSON.stringify({
      light: { background: "url(bad)", sidebar: "#aabbcc" },
      dark: { navigation: "#121212" },
    }),
  );
  expect(readSurfaceColors()).toEqual({
    light: { sidebar: "#aabbcc" },
    dark: { navigation: "#121212" },
  });
  expect(textForBackground("#ffffff")).toBe("#000000");
  expect(textForBackground("#000000")).toBe("#ffffff");
  expect(resolvedEditorTheme("vs", "dark")).toBe("vs");
  expect(resolvedEditorTheme("auto", "dark")).toBe("vs-dark");
  expect(resolvedEditorTheme("hc-light", "light")).toBe("hc-light");
});
it("applies distinct surface colors, saves light/dark separately, and resets only the active mode", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const rail = screen.getByRole("navigation", { name: "工具栏" });
  await user.click(within(rail).getByRole("button", { name: "设置偏好" }));
  const sidebar = screen.getByRole("complementary", { name: "侧边导航" });
  await user.click(within(sidebar).getByRole("button", { name: "界面设置" }));
  fireEvent.change(screen.getByLabelText("内容与对话背景", { exact: true }), {
    target: { value: "#fafafa" },
  });
  fireEvent.change(screen.getByLabelText("图标导航栏背景", { exact: true }), {
    target: { value: "#123456" },
  });
  fireEvent.change(screen.getByLabelText("侧边栏背景", { exact: true }), {
    target: { value: "#f0eadd" },
  });
  await waitFor(() =>
    expect(
      document.documentElement.style.getPropertyValue("--background"),
    ).toBe("#fafafa"),
  );
  expect(rail.style.getPropertyValue("--sidebar")).toBe("#123456");
  expect(sidebar.style.getPropertyValue("--sidebar")).toBe("#f0eadd");
  expect(rail.style.getPropertyValue("--sidebar-foreground")).toBe("#ffffff");
  await user.click(screen.getByRole("button", { name: "深色", exact: true }));
  expect(
    screen.getByLabelText("图标导航栏背景", { exact: true }),
  ).not.toHaveValue("#123456");
  fireEvent.change(screen.getByLabelText("图标导航栏背景", { exact: true }), {
    target: { value: "#223344" },
  });
  await user.click(screen.getByRole("button", { name: "恢复默认背景" }));
  expect(readSurfaceColors().dark).toEqual({});
  expect(readSurfaceColors().light.navigation).toBe("#123456");
  await user.click(screen.getByRole("button", { name: "浅色", exact: true }));
  expect(screen.getByLabelText("图标导航栏背景", { exact: true })).toHaveValue(
    "#123456",
  );
  await user.click(screen.getByRole("combobox", { name: "代码编辑器主题" }));
  await user.click(screen.getByRole("option", { name: "高对比度深色" }));
  expect(localStorage.getItem("oiagent-editor-theme")).toBe("hc-black");
});
