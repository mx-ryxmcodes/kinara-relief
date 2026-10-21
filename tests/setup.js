// jsdom lacks ResizeObserver, which Recharts uses.
if (typeof window !== 'undefined') {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  await import('@testing-library/jest-dom/vitest');
}
