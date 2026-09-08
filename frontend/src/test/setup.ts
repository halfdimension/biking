import "@testing-library/jest-dom";

// jsdom does not implement ResizeObserver, which MapView now uses to keep the
// MapLibre canvas sized to its flex container. Provide a no-op stub so the
// component can construct one during tests without crashing.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}

// requestAnimationFrame exists in modern jsdom, but stub it defensively so the
// map-init effect's deferred resize does not throw if it is missing.
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    return setTimeout(() => cb(Date.now()), 0) as unknown as number;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number): void => {
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  }) as typeof cancelAnimationFrame;
}
