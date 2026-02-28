import { useState, useMemo, useCallback } from "react";
import { compositionRegistry } from "../compositions/registry";
import { is2DComposition, type CompositionDefinition } from "../compositions/types";
import { tagStyle } from "./styles";

const FAVORITES_KEY = "hatch3d-favorites";

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

export function CompositionBrowser({
  currentKey,
  onSelect,
}: {
  currentKey: string;
  onSelect: (key: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [favorites, setFavorites] = useState(loadFavorites);

  const allComps = useMemo(() => {
    const entries: [string, CompositionDefinition][] = [];
    for (const [id, comp] of compositionRegistry.getAll()) {
      entries.push([id, comp]);
    }
    return entries;
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const [, comp] of allComps) {
      cats.add(comp.category);
    }
    return ["all", ...Array.from(cats).sort()];
  }, [allComps]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allComps.filter(([id, comp]) => {
      // Favorites filter
      if (showFavoritesOnly && !favorites.has(id)) return false;
      // Category filter
      if (categoryFilter !== "all" && comp.category !== categoryFilter) return false;
      // Search filter
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
  }, [allComps, search, categoryFilter, showFavoritesOnly, favorites]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, [string, CompositionDefinition][]>();
    for (const entry of filtered) {
      const cat = entry[1].category;
      let arr = map.get(cat);
      if (!arr) { arr = []; map.set(cat, arr); }
      arr.push(entry);
    }
    return map;
  }, [filtered]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavorites(next);
      return next;
    });
  }, []);

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

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{
            padding: "2px 4px",
            fontSize: 9,
            fontFamily: "inherit",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--fg)",
            cursor: "pointer",
            borderRadius: 0,
            flex: 1,
            minWidth: 0,
          }}
        >
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat === "all" ? "All categories" : cat}
            </option>
          ))}
        </select>
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
          // Grouped list view
          Array.from(grouped.entries()).map(([category, comps]) => (
            <div key={category}>
              <div style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "var(--fg-hint)",
                padding: "4px 0 2px 0",
              }}>
                {category}
              </div>
              {comps.map(([id, comp]) => (
                <div
                  key={id}
                  onClick={() => onSelect(id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 4px",
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
            </div>
          ))
        ) : (
          // Grid view
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
                  onClick={() => setSearch(tag)}
                  style={{
                    padding: "1px 5px",
                    fontSize: 8,
                    border: "1px solid var(--border-light)",
                    color: "var(--fg-hint)",
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
