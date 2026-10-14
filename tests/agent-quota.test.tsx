import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AgentQuota } from "@/components/workspace/AgentQuota";
import { call } from "@/lib/api";
import { demoSnapshot } from "@/lib/demo";
vi.mock("@/lib/api", () => ({ call: vi.fn() }));
it("hides unavailable limits and displays genuine zero usage accessibly", async () => {
  const agent = { ...demoSnapshot.agents[0], available: true, custom: false };
  vi.mocked(call).mockResolvedValueOnce(null);
  const view = render(<AgentQuota agent={agent} />);
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("agent_quota", { id: agent.id }),
  );
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  vi.mocked(call).mockResolvedValueOnce({
    updatedAt: 100,
    windows: [
      {
        label: "5 小时",
        usedPercent: 0,
        resetsAt: null,
        remaining: null,
        unit: null,
      },
    ],
  });
  view.rerender(<AgentQuota agent={{ ...agent, version: "new" }} />);
  expect(
    await screen.findByRole("progressbar", { name: "5 小时配额已用" }),
  ).toHaveAttribute("aria-valuenow", "0");
  vi.mocked(call).mockRejectedValueOnce(new Error("not logged in"));
  view.rerender(<AgentQuota agent={{ ...agent, version: "another" }} />);
  await waitFor(() =>
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(),
  );
});
