import { useEffect, useState } from "react";
import App from "./App.tsx";
import { SceneView } from "./scene/SceneView.tsx";

/** Minimal hash router: `#scene` → the Scene IR view, anything else → the app. */
export function Root() {
  const [isScene, setIsScene] = useState(() => window.location.hash.replace(/^#/, "") === "scene");
  useEffect(() => {
    const onHash = () => setIsScene(window.location.hash.replace(/^#/, "") === "scene");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return isScene ? <SceneView /> : <App />;
}
