import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { WorkflowGraph } from "@/components/workflows/WorkflowGraph";
import { demoSnapshot } from "@/lib/demo";
import { newWorkflow, type WorkflowRun } from "@/lib/workflows";

const previousObserver = globalThis.ResizeObserver;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.stubGlobal("ResizeObserver", previousObserver);
});

it.each([false, true])(
  "keeps measured nodes visible after progress and selection updates (editable=%s)",
  async (editable) => {
    // Supply layout measurements, while keeping ResizeObserver quiet between updates.
    // A data refresh must not hide nodes and depend on another resize to restore them.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function () {
        return this.classList.contains("react-flow__node") ? 208 : 900;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function () {
        return this.classList.contains("react-flow__node") ? 160 : 480;
      },
    );
    const observers: { notify: () => void }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets = new Set<Element>();
        constructor(private callback: ResizeObserverCallback) {
          observers.push(this);
        }
        observe(target: Element) {
          this.targets.add(target);
        }
        unobserve(target: Element) {
          this.targets.delete(target);
        }
        disconnect() {
          this.targets.clear();
        }
        notify() {
          this.callback(
            [...this.targets].map((target) => ({
              target,
              contentRect: {
                width: (target as HTMLElement).offsetWidth,
                height: (target as HTMLElement).offsetHeight,
              },
            })) as ResizeObserverEntry[],
            this as unknown as ResizeObserver,
          );
        }
      },
    );
    const definition = newWorkflow(demoSnapshot.agents);
    const child = {
      ...demoSnapshot.tasks[0],
      id: "child",
      status: "running",
      preview: "检查项目",
    };
    const states: WorkflowRun["steps"] = [
      {
        status: "running",
        taskIds: [child.id],
        output: "",
        attempts: 1,
        repairs: 0,
        startedAt: null,
        finishedAt: null,
      },
    ];
    const onChange = vi.fn();
    const props = {
      definition,
      states,
      tasks: [child],
      agents: demoSnapshot.agents,
      onSelect: vi.fn(),
      onChange: editable ? onChange : undefined,
    };
    const view = render(<WorkflowGraph {...props} />);
    const node = screen.getByLabelText(`${definition.steps[0].title}，进行中`);
    await act(async () => observers.forEach((observer) => observer.notify()));
    await waitFor(() => expect(node).toBeVisible());
    for (let i = 0; i < 3; i++) {
      view.rerender(
        <WorkflowGraph
          {...props}
          tasks={[{ ...child, preview: `执行步骤 ${i}` }]}
          selectedId={i % 2 ? definition.steps[0].id : undefined}
        />,
      );
      expect(screen.getByText(`执行步骤 ${i}`)).toBeVisible();
      expect(node).toBeVisible();
    }
    expect(onChange).not.toHaveBeenCalled(); // Measurements must not modify the saved workflow.
  },
);
