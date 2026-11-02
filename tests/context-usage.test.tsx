import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ContextUsage } from "@/components/workspace/ContextUsage";

it("shows Qoder's native ratio even when absolute tokens are withheld", async () => {
  render(
    <ContextUsage
      model="qoder"
      usage={{
        input: null,
        output: null,
        cached: null,
        window: 200000,
        ratio: 0.33815,
      }}
      compressing={false}
      onCompact={vi.fn()}
    />,
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "34",
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "上下文用量" }));
  expect(screen.getByText("200,000")).toBeVisible();
  expect(screen.queryByText("0 tokens")).not.toBeInTheDocument();
  expect(screen.getByText("Agent 仅上报上下文占用比例")).toBeVisible();
});

it("shows latest occupancy without counting cached input twice and discloses details", async () => {
  render(
    <ContextUsage
      model="test"
      usage={{ input: 18000, output: 2000, cached: 12000, window: 200000 }}
      compressing={false}
      onCompact={vi.fn()}
    />,
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "10",
  );
  expect(screen.queryByText("上下文容量")).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "上下文用量" }));
  expect(screen.getByText("20,000 tokens")).toBeVisible();
  expect(screen.getByText("200,000")).toBeVisible();
  expect(screen.getByText("12,000")).toBeVisible();
});
it("does not fabricate a percentage without capacity or usage", async () => {
  const view = render(
    <ContextUsage
      model="test"
      usage={{ input: 100, output: null, cached: null, window: null }}
      compressing={false}
      onCompact={vi.fn()}
    />,
  );
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  expect(screen.getByText("100 tokens")).toBeVisible();
  view.rerender(
    <ContextUsage
      model="test"
      compressing={false}
      disabledReason="当前 Agent 未提供压缩接口"
      onCompact={vi.fn()}
    />,
  );
  expect(screen.getByText("上下文 —")).toBeVisible();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "上下文用量" }));
  expect(screen.getByRole("button", { name: "压缩上下文" })).toBeDisabled();
  expect(screen.getByText("当前 Agent 未提供压缩接口")).toBeVisible();
});
it("prevents duplicate requests and leaves a failed compaction retryable", async () => {
  let reject!: (reason: Error) => void;
  const compress = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const user = userEvent.setup();
  render(
    <ContextUsage model="test" compressing={false} onCompact={compress} />,
  );
  await user.click(screen.getByRole("button", { name: "上下文用量" }));
  await user.click(screen.getByRole("button", { name: "压缩上下文" }));
  expect(screen.getByRole("button", { name: "正在压缩上下文" })).toBeDisabled();
  expect(compress).toHaveBeenCalledTimes(1);
  reject(new Error("连接失败"));
  expect(await screen.findByRole("alert")).toHaveTextContent("连接失败");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "压缩上下文" })).toBeEnabled(),
  );
});
