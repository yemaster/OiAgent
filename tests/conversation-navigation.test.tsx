import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
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
function Harness({
  rows = items,
  active = true,
  mounted = true,
}: {
  rows?: TranscriptItem[];
  active?: boolean;
  mounted?: boolean;
}) {
  const nav = useConversationNavigation(rows, active);
  return (
    <>
      <button onClick={() => nav.jump("m100")}>jump</button>
      <button onClick={nav.latest}>latest</button>
      {mounted && (
        <div
          aria-label="messages"
          ref={nav.attachScroll}
          onScroll={nav.onScroll}
        >
          <div>
            {nav.items.map((item) => (
              <div key={item.key} data-conversation-key={item.key}>
                {item.key}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

it("restores the reading window after its hidden DOM and data are released", () => {
  const geometry = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const parent = this.closest('[aria-label="messages"]');
      const index =
        parent && this.hasAttribute("data-conversation-key")
          ? Array.from(
              parent.querySelectorAll("[data-conversation-key]"),
            ).indexOf(this)
          : -1;
      const top = index >= 0 ? index * 30 - parent!.scrollTop : 0;
      return {
        top,
        bottom: top + 30,
        left: 0,
        right: 100,
        width: 100,
        height: 30,
        x: 0,
        y: top,
        toJSON() {},
      };
    });
  const view = render(<Harness />);
  fireEvent.click(screen.getByText("jump"));
  const el = screen.getByLabelText("messages");
  measure(el);
  el.scrollTop = 360;
  fireEvent.scroll(el);
  const before = el.textContent;
  view.rerender(<Harness active={false} mounted={false} rows={[]} />);
  expect(screen.queryByLabelText("messages")).not.toBeInTheDocument();
  // The first returning render contains only a loading placeholder.
  view.rerender(<Harness rows={[]} />);
  const restored = screen.getByLabelText("messages");
  measure(restored);
  view.rerender(<Harness />);
  expect(restored.textContent).toBe(before);
  expect(restored.scrollTop).toBe(360);
  fireEvent.click(screen.getByText("latest"));
  expect(screen.getByText("m399")).toBeInTheDocument();
  geometry.mockRestore();
});
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

function measure(el: HTMLElement) {
  Object.defineProperties(el, {
    scrollHeight: {
      configurable: true,
      get: () => el.querySelectorAll("[data-conversation-key]").length * 30,
    },
    clientHeight: { configurable: true, value: 300 },
  });
  for (const node of el.querySelectorAll<HTMLElement>(
    "[data-conversation-key]",
  )) {
    node.getBoundingClientRect = () => {
      const index = Array.from(
        el.querySelectorAll("[data-conversation-key]"),
      ).indexOf(node);
      const top = index * 30 - el.scrollTop;
      return {
        top,
        bottom: top + 30,
        left: 0,
        right: 100,
        width: 100,
        height: 30,
        x: 0,
        y: top,
        toJSON() {},
      };
    };
  }
}
it("pages in both directions without retaining the full DOM and freezes history during streaming", () => {
  const view = render(<Harness />);
  const el = screen.getByLabelText("messages");
  for (let page = 0; page < 4; page++) {
    measure(el);
    act(() => {
      el.scrollTop = 0;
      fireEvent.scroll(el);
    });
    expect(
      el.querySelectorAll("[data-conversation-key]").length,
    ).toBeLessThanOrEqual(160);
  }
  expect(screen.getByText("m0")).toBeInTheDocument();
  const before = el.textContent;
  view.rerender(
    <Harness
      rows={[
        ...items,
        {
          kind: "message",
          key: "new",
          message: { role: "assistant", text: "new", timestamp: "t" },
        },
      ]}
    />,
  );
  expect(el.textContent).toBe(before);
  for (let page = 0; page < 5; page++) {
    measure(el);
    act(() => {
      el.scrollTop = el.scrollHeight - el.clientHeight - 1;
      fireEvent.scroll(el);
    });
    expect(
      el.querySelectorAll("[data-conversation-key]").length,
    ).toBeLessThanOrEqual(160);
  }
  expect(screen.getByText("new")).toBeInTheDocument();
  expect(el.querySelectorAll("[data-conversation-key]")).toHaveLength(80);
});
