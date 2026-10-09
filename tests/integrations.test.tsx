import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { McpEditor } from "@/components/workspace/McpEditor";
function Fixture() {
  const [value, setValue] = useState(
    JSON.stringify({
      type: "local",
      command: ["uvx", "server"],
      environment: { TOKEN: "retained" },
      timeout: 1000,
      enabled: true,
    }),
  );
  return (
    <>
      <McpEditor kind="opencode" value={value} onChange={setValue} />
      <output data-testid="config">{value}</output>
    </>
  );
}
it("edits native command fields without losing credentials and advanced options", async () => {
  const user = userEvent.setup();
  render(<Fixture />);
  await user.clear(screen.getByLabelText("启动命令"));
  await user.type(screen.getByLabelText("启动命令"), "python");
  const result = JSON.parse(screen.getByTestId("config").textContent!);
  expect(result).toEqual({
    type: "local",
    command: ["python", "server"],
    environment: { TOKEN: "retained" },
    timeout: 1000,
    enabled: true,
  });
});
