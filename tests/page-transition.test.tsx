import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePageTransition } from "@/hooks/usePageTransition";

const preference = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", () => ({ useReducedMotion: () => preference.reduced }));

function View({ location }: { location: string }) {
  const ref = usePageTransition(location);
  return (
    <div ref={ref}>
      <input aria-label="draft" defaultValue="" />
    </div>
  );
}

afterEach(() => {
  preference.reduced = false;
  vi.restoreAllMocks();
});

it("cancels superseded transitions without remounting content or leaving styles", () => {
  const animations: { cancel: ReturnType<typeof vi.fn> }[] = [];
  const animate = vi.fn(() => {
    const animation = { cancel: vi.fn() };
    animations.push(animation);
    return animation;
  });
  // jsdom has no Web Animations API.
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "animate",
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  try {
    const page = render(<View location="tasks" />);
    expect(animate).not.toHaveBeenCalled();
    const draft = screen.getByRole("textbox");
    fireEvent.change(draft, { target: { value: "unsent message" } });
    page.rerender(<View location="project-a" />);
    page.rerender(<View location="project-b" />);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox")).toBe(draft);
    expect(draft).toHaveValue("unsent message");
    expect(draft.parentElement?.getAttribute("style")).toBeNull();
    page.rerender(<View location="project-b" />);
    expect(animate).toHaveBeenCalledTimes(2);
    preference.reduced = true;
    page.rerender(<View location="project-c" />);
    expect(animations[1].cancel).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledTimes(2);
    preference.reduced = false;
    page.rerender(<View location="project-d" />);
    page.unmount();
    expect(animations[2].cancel).toHaveBeenCalledOnce();
  } finally {
    if (original)
      Object.defineProperty(HTMLElement.prototype, "animate", original);
    else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  }
});

it("keeps navigation functional without the Web Animations API", () => {
  const page = render(<View location="tasks" />);
  page.rerender(<View location="project" />);
  expect(screen.getByRole("textbox")).toBeInTheDocument();
});
