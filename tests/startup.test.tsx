import { StrictMode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "@/App";
import * as api from "@/lib/api";
import { demoSnapshot } from "@/lib/demo";
import type { Snapshot } from "@/lib/types";

it("shows saved tasks and allows navigation while background indexing is pending", async () => {
  localStorage.setItem("oiagent-onboarded", "true");
  let finish!: (snapshot: Snapshot) => void;
  const background = new Promise<Snapshot>((resolve) => {
    finish = resolve;
  });
  const originalCall = api.call;
  const spy = vi
    .spyOn(api, "call")
    .mockImplementation(async (command, args) => {
      if (command === "get_snapshot") {
        return args?.cached ? structuredClone(demoSnapshot) : background;
      }
      return originalCall(command, args);
    });
  const user = userEvent.setup();
  try {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole("heading", { name: "当前任务" });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("get_snapshot", {
        scan: true,
        cached: false,
      }),
    );
    expect(screen.getByText("正在同步…")).toBeVisible();
    await user.click(
      within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
        "button",
        { name: "历史记录", exact: true },
      ),
    );
    await screen.findByRole("heading", { name: "历史记录" });
    await act(async () => finish(structuredClone(demoSnapshot)));
    await waitFor(() =>
      expect(screen.queryByText("正在同步…")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "历史记录" })).toBeVisible();
  } finally {
    finish(structuredClone(demoSnapshot));
    spy.mockRestore();
  }
});
