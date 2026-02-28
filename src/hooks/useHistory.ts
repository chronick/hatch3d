import { useRef, useCallback, useState } from "react";

/**
 * Generic undo/redo hook using debounced full-state snapshots.
 *
 * @param current  - The current state snapshot (must be JSON-serializable)
 * @param restore  - Called with a previous snapshot to restore it
 * @param debounceMs - How long to wait after last change before committing (default 500ms)
 */
export function useHistory<T>(
  current: T,
  restore: (snap: T) => void,
  debounceMs = 500,
) {
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);
  const lastPushed = useRef<string>(JSON.stringify(current));
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isRestoring = useRef(false);

  // Counter to force re-render so canUndo/canRedo stay current
  const [, setTick] = useState(0);
  const tick = useCallback(() => setTick((n) => n + 1), []);

  const MAX_UNDO = 50;

  // Check if current snapshot differs from last committed and start debounce
  const currentJson = JSON.stringify(current);
  if (!isRestoring.current && currentJson !== lastPushed.current) {
    clearTimeout(debounceTimer.current);
    const prevJson = lastPushed.current;
    debounceTimer.current = setTimeout(() => {
      // Push the *previous* state onto undo stack so we can get back to it
      undoStack.current.push(JSON.parse(prevJson) as T);
      if (undoStack.current.length > MAX_UNDO) {
        undoStack.current.shift();
      }
      lastPushed.current = JSON.stringify(current);
      redoStack.current = [];
      tick();
    }, debounceMs);
  }

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    clearTimeout(debounceTimer.current);

    const popped = undoStack.current.pop()!;
    redoStack.current.push(JSON.parse(lastPushed.current) as T);
    lastPushed.current = JSON.stringify(popped);

    isRestoring.current = true;
    restore(popped);
    // Clear restoring flag on next microtask so the render with restored
    // values doesn't get treated as a new change
    queueMicrotask(() => {
      isRestoring.current = false;
    });

    tick();
  }, [restore, tick]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    clearTimeout(debounceTimer.current);

    const popped = redoStack.current.pop()!;
    undoStack.current.push(JSON.parse(lastPushed.current) as T);
    lastPushed.current = JSON.stringify(popped);

    isRestoring.current = true;
    restore(popped);
    queueMicrotask(() => {
      isRestoring.current = false;
    });

    tick();
  }, [restore, tick]);

  return {
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}
