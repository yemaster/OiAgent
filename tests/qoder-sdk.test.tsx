import { expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QoderSdk } from "@/components/workspace/QoderSdk";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ call: vi.fn(), desktop: true }));
const status = {
  version: "1.0.56",
  autoUpdate: true,
  runtimeReady: true,
  checkedAt: 100,
  error: null,
};
beforeEach(() => vi.mocked(call).mockReset());
it("automatically checks installed SDKs, retains failures and lets the user retry", async () => {
  vi.mocked(call)
    .mockResolvedValueOnce(status)
    .mockResolvedValueOnce({ ...status, error: "网络不可用" })
    .mockResolvedValueOnce({ ...status, version: "1.0.57" });
  render(<QoderSdk />);
  expect(await screen.findByRole("alert")).toHaveTextContent("网络不可用");
  expect(screen.getByText("1.0.56")).toBeInTheDocument();
  expect(call).toHaveBeenNthCalledWith(2, "qoder_sdk_status", {
    check: true,
    update: false,
  });
  await userEvent.click(screen.getByRole("button", { name: "检查更新" }));
  expect(await screen.findByText("1.0.57")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("honors persisted opt-out and saves toggles", async () => {
  vi.mocked(call)
    .mockResolvedValueOnce({ ...status, autoUpdate: false })
    .mockResolvedValueOnce(status);
  render(<QoderSdk />);
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  expect(call).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("switch", { name: "自动更新 SDK" }),
  ).not.toBeChecked();
  await userEvent.click(screen.getByRole("switch"));
  expect(call).toHaveBeenLastCalledWith("qoder_sdk_status", {
    check: true,
    update: false,
    autoUpdate: true,
  });
  await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
});
