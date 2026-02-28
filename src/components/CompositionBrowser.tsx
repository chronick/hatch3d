import { useState, useMemo, useCallback } from "react";
import { compositionRegistry } from "../compositions/registry";
import { is2DComposition, type CompositionDefinition } from "../compositions/types";
import { tagStyle } from "./styles";

const FAVORITES_KEY = "hatch3d-favorites";
const TREE_STATE_KEY = "hatch3d-tree-state";

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveFavorites(favs: Set<string>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
}

function loadTreeState(): Set<string> {
  try {
    const raw = localStorage.getItem(TREE_STATE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveTreeState(expanded: Set<string>) {
  localStorage.setItem(TREE_STATE_KEY, JSON.stringify([...expanded]));
}

interface TreeNode {
  children: Map<string, TreeNode>;
  compositions: [string, CompositionDefinition][];
}

function countCompositions(node: TreeNode): number {
  let count = node.compositions.length;
  for (const child of node.children.values()) {
    count += countCompositions(child);
  }
  return count;
}

function TreeView({
  node,
  path,
  depth,
  currentKey,
  onSelect,
  favorites,
  toggleFavorite,
  isDirExpanded,
  toggleDir,
  hasActiveFilter,
}: {
  node: TreeNode;
  path: string;
  depth: number;
  currentKey: string;
  onSelect: (key: string) => void;
  favorites: Set<string>;
  toggleFavorite: (id: string) => void;
  isDirExpanded: (dirKey: string) => boolean;
  toggleDir: (dirKey: string) => void;
  hasActiveFilter: boolean;
}) {
  const sortedDirs = [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b));
  const sortedComps = [...node.compositions].sort(([, a], [, b]) => a.name.localeCompare(b.name));

  return (
    <>
      {sortedDirs.map(([dirName, child]) => {
        const dirKey = path ? `${path}/${dirName}` : dirName;
        const expanded = isDirExpanded(dirKey);
        const itemCount = countCompositions(child);
        return (
          <div key={dirKey}>
            <div
              onClick={() => toggleDir(dirKey)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 4px",
                paddingLeft: depth * 12 + 4,
                cursor: "pointer",
                fontSize: 10,
                fontWeight: 600,
                opacity: 0.8,
                userSelect: "none",
              }}
            >
              <span style={{ fontSize: 8, width: 8, textAlign: "center", flexShrink: 0 }}>
                {expanded ? "\u25BE" : "\u25B8"}
              </span>
              <span style={{ flex: 1 }}>{dirName}</span>
              <span style={{
                fontSize: 8,
                opacity: 0.4,
                flexShrink: 0,
              }}>
                {itemCount}
              </span>
            </div>
            {expanded && (
              <TreeView
                node={child}
                path={dirKey}
                depth={depth + 1}
                currentKey={currentKey}
                onSelect={onSelect}
                favorites={favorites}
                toggleFavorite={toggleFavorite}
                isDirExpanded={isDirExpanded}
                toggleDir={toggleDir}
                hasActiveFilter={hasActiveFilter}
              />
            )}
          </div>
        );
      })}
      {sortedComps.map(([id, comp]) => (
        <div
          key={id}
          onClick={() => onSelect(id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 4px",
            paddingLeft: depth * 12 + 4,
            cursor: "pointer",
            background: currentKey === id ? "var(--fg)" : "transparent",
            color: currentKey === id ? "var(--bg-canvas)" : "var(--fg)",
            fontSize: 10,
          }}
        >
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {comp.name}
          </span>
          <span style={{
            fontSize: 8,
            opacity: 0.5,
            flexShrink: 0,
          }}>
            {is2DComposition(comp) ? "2D" : "3D"}
          </span>
          <span
            onClick={(e) => { e.stopPropagation(); toggleFavorite(id); }}
            style={{
              cursor: "pointer",
              fontSize: 10,
              opacity: favorites.has(id) ? 1 : 0.2,
              flexShrink: 0,
              color: currentKey === id ? "var(--bg-canvas)" : "var(--fg)",
            }}
          >
            {"\u2605"}
          </span>
        </div>
      ))}
    </>
  );
}

export function CompositionBrowser({
  currentKey,
  onSelect,
}: {
  currentKey: string;
  onSelect: (key: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [favorites, setFavorites] = useState(loadFavorites);
  const [expandedDirs, setExpandedDirs] = useState(loadTreeState);

  const allComps = useMemo(() => {
    const entries: [string, CompositionDefinition][] = [];
    for (const [id, comp] of compositionRegistry.getAll()) {
      entries.push([id, comp]);
    }
    return entries;
  }, []);

  // Collect all unique tags across compositions, sorted alphabetically
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    // Add dimension tags
    tags.add("3d");
    tags.add("2d");
    for (const [, comp] of allComps) {
      for (const tag of comp.tags || []) {
        tags.add(tag);
      }
    }
    return [...tags].sort();
  }, [allComps]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allComps.filter(([id, comp]) => {
      if (showFavoritesOnly && !favorites.has(id)) return false;
      // AND filter: composition must have ALL selected tags
      if (selectedTags.size > 0) {
        const compTags = new Set([
          ...(comp.tags || []),
          comp.category, // "3d" or "2d" as implicit tag
        ]);
        for (const tag of selectedTags) {
          if (!compTags.has(tag)) return false;
        }
      }
      if (q) {
        const searchable = [
          comp.name,
          comp.description || "",
          id,
          ...(comp.tags || []),
        ].join(" ").toLowerCase();
        return searchable.includes(q);
      }
      return true;
    });
  }, [allComps, search, selectedTags, showFavoritesOnly, favorites]);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavorites(next);
      return next;
    });
  }, []);

  const toggleDir = useCallback((dirKey: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirKey)) next.delete(dirKey);
      else next.add(dirKey);
      saveTreeState(next);
      return next;
    });
  }, []);

  const hasActiveFilter = search.trim() !== "" || selectedTags.size > 0 || showFavoritesOnly;

  // Build tree structure from filtered compositions
  const tree = useMemo(() => {
    const pathMap = compositionRegistry.getPathMap();
    const root: TreeNode = { children: new Map(), compositions: [] };

    for (const [id, comp] of filtered) {
      const dirPath = pathMap.get(id);
      if (!dirPath) {
        root.compositions.push([id, comp]);
        continue;
      }
      const parts = dirPath.split("/");
      let node = root;
      for (const part of parts) {
        if (!node.children.has(part)) {
          node.children.set(part, { children: new Map(), compositions: [] });
        }
        node = node.children.get(part)!;
      }
      node.compositions.push([id, comp]);
    }
    return root;
  }, [filtered]);

  // Collect all directory keys that contain matches (for auto-expand during filtering)
  const matchingDirKeys = useMemo(() => {
    if (!hasActiveFilter) return null;
    const keys = new Set<string>();
    const pathMap = compositionRegistry.getPathMap();
    for (const [id] of filtered) {
      const dirPath = pathMap.get(id);
      if (!dirPath) continue;
      // Add all ancestor paths too: "3d/geometric" → "3d", "3d/geometric"
      const parts = dirPath.split("/");
      let accum = "";
      for (const part of parts) {
        accum = accum ? `${accum}/${part}` : part;
        keys.add(accum);
      }
    }
    return keys;
  }, [filtered, hasActiveFilter]);

  const isDirExpanded = useCallback((dirKey: string) => {
    if (matchingDirKeys) return matchingDirKeys.has(dirKey);
    return expandedDirs.has(dirKey);
  }, [matchingDirKeys, expandedDirs]);

  const currentComp = compositionRegistry.get(currentKey);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Search bar */}
      <input
        type="text"
        placeholder="Search..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          padding: "4px 8px",
          fontSize: 10,
          fontFamily: "inherit",
          border: "1px solid var(--border)",
          background: "transparent",
          color: "var(--fg)",
          outline: "none",
          borderRadius: 0,
        }}
      />

      {/* Tag filter (multi-select, AND logic) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
        {allTags.map((tag) => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            style={{
              ...tagStyle,
              padding: "1px 5px",
              fontSize: 8,
              background: selectedTags.has(tag) ? "var(--fg)" : "transparent",
              color: selectedTags.has(tag) ? "var(--bg-canvas)" : "var(--fg)",
            }}
          >
            {tag}
          </button>
        ))}
        {selectedTags.size > 0 && (
          <button
            onClick={() => setSelectedTags(new Set())}
            style={{
              ...tagStyle,
              padding: "1px 5px",
              fontSize: 8,
              opacity: 0.5,
            }}
          >
            clear
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
          title="Show favorites only"
          style={{
            ...tagStyle,
            padding: "2px 6px",
            fontSize: 9,
            background: showFavoritesOnly ? "var(--fg)" : "transparent",
            color: showFavoritesOnly ? "var(--bg-canvas)" : "var(--fg)",
          }}
        >
          {"\u2605"}
        </button>
        <button
          onClick={() => setViewMode(viewMode === "list" ? "grid" : "list")}
          title={viewMode === "list" ? "Grid view" : "List view"}
          style={{
            ...tagStyle,
            padding: "2px 6px",
            fontSize: 9,
          }}
        >
          {viewMode === "list" ? "\u2261" : "\u25A6"}
        </button>
      </div>

      {/* Composition list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 300, overflowY: "auto" }}>
        {viewMode === "list" ? (
          <TreeView
            node={tree}
            path=""
            depth={0}
            currentKey={currentKey}
            onSelect={onSelect}
            favorites={favorites}
            toggleFavorite={toggleFavorite}
            isDirExpanded={isDirExpanded}
            toggleDir={toggleDir}
            hasActiveFilter={hasActiveFilter}
          />
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {filtered.map(([id, comp]) => (
              <button
                key={id}
                onClick={() => onSelect(id)}
                style={{
                  ...tagStyle,
                  background: currentKey === id ? "var(--fg)" : "transparent",
                  color: currentKey === id ? "var(--bg-canvas)" : "var(--fg)",
                  position: "relative",
                }}
              >
                {comp.name}
                <span style={{ fontSize: 8, marginLeft: 4, opacity: 0.5 }}>
                  {is2DComposition(comp) ? "2D" : "3D"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Description + tags */}
      {currentComp && (
        <div style={{
          fontSize: 9,
          color: "var(--fg-hint)",
          borderTop: "1px solid var(--border-light)",
          paddingTop: 6,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}>
          {currentComp.description && (
            <div>{currentComp.description}</div>
          )}
          {currentComp.tags && currentComp.tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {currentComp.tags.map((tag) => (
                <span
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  style={{
                    padding: "1px 5px",
                    fontSize: 8,
                    border: "1px solid var(--border-light)",
                    color: selectedTags.has(tag) ? "var(--fg)" : "var(--fg-hint)",
                    background: selectedTags.has(tag) ? "var(--border-light)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
