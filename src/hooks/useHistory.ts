import { useRef, useCallback, useState, useEffect } from "react";

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
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // canUndo/canRedo are promoted to useState scalars. Reading ref.current
  // during render is forbidden by react-hooks/refs, so we snapshot the
  // stack lengths into state whenever the stacks mutate.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const refreshCan = useCallback(() => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  const MAX_UNDO = 50;

  // currentJson is computed outside the effect so it can be used as a
  // stable, value-based dependency. React's dep comparison uses Object.is,
  // so identical JSON across renders won't re-run the effect — even when
  // `current` is a fresh object reference each render.
  const currentJson = JSON.stringify(current);

  useEffect(() => {
    // Bail out when the JSON matches what we last committed. This is the
    // invariant that keeps restored renders from pushing snapshots: undo/
    // redo sets lastPushed.current to the restored JSON BEFORE calling
    // restore(), so the effect fired by the restored render sees equality
    // and schedules nothing.
    if (currentJson === lastPushed.current) return;

    const prevJson = lastPushed.current;
    debounceTimer.current = setTimeout(() => {
      undoStack.current.push(JSON.parse(prevJson) as T);
      if (undoStack.current.length > MAX_UNDO) {
        undoStack.current.shift();
      }
      lastPushed.current = currentJson;
      redoStack.current = [];
      refreshCan();
    }, debounceMs);

    return () => clearTimeout(debounceTimer.current);
  }, [currentJson, debounceMs, refreshCan]);

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    clearTimeout(debounceTimer.current);

    const popped = undoStack.current.pop()!;
    redoStack.current.push(JSON.parse(lastPushed.current) as T);
    // Set lastPushed to the restored snapshot BEFORE calling restore().
    // When restore() causes a re-render, the effect's equality check
    // (currentJson === lastPushed.current) will bail out — that's how
    // we prevent the restored render from pushing onto the undo stack.
    lastPushed.current = JSON.stringify(popped);

    restore(popped);
    refreshCan();
  }, [restore, refreshCan]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    clearTimeout(debounceTimer.current);

    const popped = redoStack.current.pop()!;
    undoStack.current.push(JSON.parse(lastPushed.current) as T);
    lastPushed.current = JSON.stringify(popped);

    restore(popped);
    refreshCan();
  }, [restore, refreshCan]);

  return { undo, redo, canUndo, canRedo };
}
