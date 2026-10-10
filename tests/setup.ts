import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(() => cleanup());
Object.defineProperty(window, "matchMedia", {
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.releasePointerCapture = () => {};
// JSDOM does not implement DOMMatrixReadOnly. React Flow only reads m22
// for the viewport zoom in these interaction tests; no layout is asserted.
class DOMMatrixReadOnlyMock {
  m22: number;
  constructor(transform = "") {
    const matrix = transform
      .match(/^matrix\(([^)]+)\)$/)?.[1]
      .split(",")
      .map(Number);
    const scale = transform.match(/scale\(([-\d.]+)/)?.[1];
    this.m22 = matrix?.[3] ?? (scale ? Number(scale) : 1);
  }
}
vi.stubGlobal("DOMMatrixReadOnly", DOMMatrixReadOnlyMock);
