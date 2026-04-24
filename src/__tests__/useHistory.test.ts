import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHistory } from "../hooks/useHistory";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Harness wraps useHistory with a piece of state that mirrors how App.tsx
 * uses it: current is a fresh object reference each render, restore()
 * replaces state in-place. This ensures tests exercise the real round-trip
 * through React re-renders rather than a synthetic in-memory model.
 */
function makeHarness(initial: { v: number } = { v: 0 }) {
  let state = initial;
  const restore = (snap: { v: number }) => {
    state = snap;
  };
  const hook = renderHook(
    ({ cur }: { cur: { v: number } }) => useHistory(cur, restore, 100),
    { initialProps: { cur: state } },
  );
  return {
    get state() {
      return state;
    },
    setState(next: { v: number }) {
      state = next;
      hook.rerender({ cur: state });
    },
    rerender() {
      hook.rerender({ cur: state });
    },
    result: hook.result,
  };
}

describe("useHistory", () => {
  it("deep-equal no-op: identical JSON does not push a second snapshot", () => {
    const h = makeHarness({ v: 0 });

    // First meaningful change
    h.setState({ v: 1 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(h.result.current.canUndo).toBe(true);

    // Now simulate a parent re-render that creates a new object with the
    // SAME JSON (common when parent spreads state: {...state}). The effect
    // dep is [currentJson], so a ref-only change must NOT schedule a push.
    h.setState({ v: 1 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // Perform one undo — if the no-op fired, we'd need two undos to get back.
    act(() => {
      h.result.current.undo();
    });
    expect(h.state).toEqual({ v: 0 });
    expect(h.result.current.canUndo).toBe(false);
  });

  it("undo/redo round-trip leaves exactly one undo entry and empty redo", () => {
    const h = makeHarness({ v: 0 });

    h.setState({ v: 1 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      h.result.current.undo();
    });
    expect(h.state).toEqual({ v: 0 });
    expect(h.result.current.canUndo).toBe(false);
    expect(h.result.current.canRedo).toBe(true);

    act(() => {
      h.result.current.redo();
    });
    expect(h.state).toEqual({ v: 1 });
    // After round-trip: the restored render must NOT push onto undoStack.
    // If isRestoring timing is wrong, canRedo would stay true (because a
    // spurious push would clear redoStack AND add to undoStack — we'd have
    // canUndo && !canRedo but the state below verifies the exact shape).
    expect(h.result.current.canUndo).toBe(true);
    expect(h.result.current.canRedo).toBe(false);
  });

  it("canUndo becomes true within the same render cycle after a debounced push", () => {
    const h = makeHarness({ v: 0 });

    expect(h.result.current.canUndo).toBe(false);

    h.setState({ v: 1 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // No extra rerender call: canUndo must already be true in the most
    // recent hook result. (If we relied on a stale ref-length read, this
    // would still be false until the next unrelated render.)
    expect(h.result.current.canUndo).toBe(true);
  });
});
