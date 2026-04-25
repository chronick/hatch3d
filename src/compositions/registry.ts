import type { CompositionDefinition } from "./types";

type Listener = () => void;

export class CompositionRegistry {
  private _map = new Map<string, CompositionDefinition>();
  private _pathMap = new Map<string, string>();
  private _listeners = new Set<Listener>();

  register(comp: CompositionDefinition): void {
    this._map.set(comp.id, comp);
    this._notify();
  }

  registerWithPath(comp: CompositionDefinition, dirPath: string): void {
    this._map.set(comp.id, comp);
    this._pathMap.set(comp.id, dirPath);
    this._notify();
  }

  registerAll(comps: CompositionDefinition[]): void {
    for (const comp of comps) {
      this._map.set(comp.id, comp);
    }
    this._notify();
  }

  getPathMap(): Map<string, string> {
    return this._pathMap;
  }

  get(id: string): CompositionDefinition | undefined {
    return this._map.get(id);
  }

  getAll(): Map<string, CompositionDefinition> {
    return this._map;
  }

  getAllMetadata() {
    const result: { id: string; name: string; description?: string; tags?: string[]; category: string; type: string }[] = [];
    for (const comp of this._map.values()) {
      const compType =
        comp.type === "2d" ? "2d" : comp.type === "layered" ? "layered" : "3d";
      result.push({
        id: comp.id,
        name: comp.name,
        description: comp.description,
        tags: comp.tags,
        category: comp.category,
        type: compType,
      });
    }
    return result;
  }

  has(id: string): boolean {
    return this._map.has(id);
  }

  get size(): number {
    return this._map.size;
  }

  /** Subscribe to registry changes (for React reactivity / future WASM dynamic loading) */
  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }
}

export const compositionRegistry = new CompositionRegistry();
