import { useEffect, useRef } from "react";

/**
 * Syncs compositionKey state with window.location.hash.
 * Format: #compositionId (e.g. #doubleRing)
 *
 * - On mount: hash overrides localStorage if it's a valid composition
 * - On state change: pushes hash
 * - On hashchange (back/forward): updates state
 */
export function useHashRoute(
  compositionKey: string,
  setCompositionKey: (key: string) => void,
  isValid: (key: string) => boolean,
  defaultKey: string,
): void {
  const isInternalUpdate = useRef(false);

  // On mount: read hash and override state if valid
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && isValid(hash) && hash !== compositionKey) {
      isInternalUpdate.current = true;
      setCompositionKey(hash);
    } else if (!hash || !isValid(hash)) {
      // Set hash to current composition
      isInternalUpdate.current = true;
      window.history.replaceState(null, "", `#${compositionKey}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only

  // On state change: push hash
  useEffect(() => {
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      // Still update the hash to match state
      const currentHash = window.location.hash.slice(1);
      if (currentHash !== compositionKey) {
        window.history.pushState(null, "", `#${compositionKey}`);
      }
      return;
    }
    window.history.pushState(null, "", `#${compositionKey}`);
  }, [compositionKey]);

  // On hashchange (back/forward): update state
  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.slice(1);
      if (hash && isValid(hash) && hash !== compositionKey) {
        isInternalUpdate.current = true;
        setCompositionKey(hash);
      } else if (!hash) {
        isInternalUpdate.current = true;
        setCompositionKey(defaultKey);
      }
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, [compositionKey, setCompositionKey, isValid, defaultKey]);
}
