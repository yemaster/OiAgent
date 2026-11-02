import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ProgressCardLayout,
  ProgressSection,
} from "@/components/workspace/ProgressCardLayout";

vi.mock("motion/react", () => ({ useReducedMotion: () => false }));
afterEach(() => {
  vi.unstubAllGlobals();
});

it("coalesces size notifications into one frame and animates without React renders", () => {
  let resize!: (entries: unknown[]) => void;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: typeof resize) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const frames: FrameRequestCallback[] = [];
  const schedule = vi.fn((callback: FrameRequestCallback) =>
    frames.push(callback),
  );
  vi.stubGlobal("requestAnimationFrame", schedule);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const renderContent = vi.fn();
  function Content() {
    renderContent();
    return <ProgressSection>progress</ProgressSection>;
  }
  const view = render(
    <ProgressCardLayout>
      <Content />
    </ProgressCardLayout>,
  );
  const root = view.container.firstElementChild as HTMLDivElement;
  const section = root.querySelector("section")!;
  const cancel = vi.fn();
  root.animate = vi.fn(() => ({ cancel }) as unknown as Animation);
  section.animate = vi.fn(() => ({ cancel }) as unknown as Animation);
  const notify = (height: number) =>
    resize([{ borderBoxSize: [{ blockSize: height }] }]);
  act(() => {
    notify(100);
    notify(120);
    notify(140);
  });
  expect(schedule).toHaveBeenCalledTimes(1);
  act(() => frames.shift()!(0));
  expect(root.style.height).toBe("140px");
  expect(root.animate).not.toHaveBeenCalled();
  Object.defineProperty(root, "getBoundingClientRect", {
    value: () => ({ height: 140 }),
  });
  Object.defineProperty(section, "offsetTop", { value: 20 });
  act(() => {
    notify(160);
    notify(180);
  });
  expect(schedule).toHaveBeenCalledTimes(2);
  act(() => frames.shift()!(16));
  expect(root.style.height).toBe("180px");
  expect(root.animate).toHaveBeenCalledExactlyOnceWith(
    [{ height: "140px" }, { height: "180px" }],
    expect.objectContaining({ duration: 200 }),
  );
  expect(section.animate).toHaveBeenCalledOnce();
  expect(renderContent).toHaveBeenCalledOnce();
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledTimes(2);
});
