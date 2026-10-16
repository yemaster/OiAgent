import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { useConversationNavigation } from "@/hooks/useConversationNavigation";
import type { TranscriptItem } from "@/lib/transcript";
const items: TranscriptItem[] = Array.from({ length: 400 }, (_, i) => ({
  kind: "message",
  key: `m${i}`,
  message: {
    role: i % 2 === 0 ? "user" : "assistant",
    text: `message ${i}`,
    timestamp: "t",
  },
}));
function Harness() {
  const nav = useConversationNavigation(items, true);
  return (
    <>
      <button onClick={() => nav.jump("m100")}>jump</button>
      <button onClick={nav.latest}>latest</button>
      <div aria-label="messages" ref={nav.scroll} onScroll={nav.onScroll}>
        <div>
          {nav.items.map((item) => (
            <div key={item.key} data-conversation-key={item.key}>
              {item.key}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
it("jumps to an older window without mounting the entire history, then returns to the latest", () => {
  render(<Harness />);
  const el = screen.getByLabelText("messages");
  expect(el.querySelectorAll("[data-conversation-key]")).toHaveLength(80);
  fireEvent.click(screen.getByText("jump"));
  expect(screen.getByText("m100")).toBeInTheDocument();
  expect(el.querySelectorAll("[data-conversation-key]").length).toBeLessThan(
    100,
  );
  fireEvent.click(screen.getByText("latest"));
  expect(screen.getByText("m399")).toBeInTheDocument();
  expect(screen.queryByText("m100")).not.toBeInTheDocument();
});
it("automatically prepends earlier history at the top", () => {
  render(<Harness />);
  const el = screen.getByLabelText("messages");
  Object.defineProperties(el, {
    scrollHeight: { configurable: true, value: 8000 },
    clientHeight: { configurable: true, value: 500 },
  });
  for (const node of el.querySelectorAll<HTMLElement>(
    "[data-conversation-key]",
  ))
    node.getBoundingClientRect = () => ({
      top: 0,
      bottom: 30,
      left: 0,
      right: 100,
      width: 100,
      height: 30,
      x: 0,
      y: 0,
      toJSON() {},
    });
  act(() => {
    el.scrollTop = 0;
    fireEvent.scroll(el);
  });
  expect(el.querySelectorAll("[data-conversation-key]")).toHaveLength(160);
  expect(screen.queryByText(/加载更早/)).not.toBeInTheDocument();
});
