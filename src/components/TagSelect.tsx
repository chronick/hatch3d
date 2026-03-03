import { useState, useRef, useEffect, useCallback, memo } from "react";

export const TagSelect = memo(function TagSelect({
  allTags,
  selectedTags,
  onToggleTag,
  onClearAll,
}: {
  allTags: string[];
  selectedTags: Set<string>;
  onToggleTag: (tag: string) => void;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const filtered = query
    ? allTags.filter(t => t.toLowerCase().includes(query.toLowerCase()))
    : allTags;

  const handleToggle = useCallback((tag: string) => {
    onToggleTag(tag);
  }, [onToggleTag]);

  const selectedArr = allTags.filter(t => selectedTags.has(t));

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Compact input showing selected pills */}
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 3,
          padding: "3px 6px",
          minHeight: 24,
          border: "1px solid var(--border)",
          cursor: "pointer",
          fontSize: 9,
        }}
      >
        {selectedArr.length === 0 && (
          <span style={{ color: "var(--fg-faint)" }}>Filter by tag...</span>
        )}
        {selectedArr.map(tag => (
          <span
            key={tag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              padding: "1px 5px",
              background: "var(--fg)",
              color: "var(--bg-canvas)",
              fontSize: 8,
            }}
          >
            {tag}
            <span
              onClick={(e) => { e.stopPropagation(); handleToggle(tag); }}
              style={{ cursor: "pointer", opacity: 0.7, fontSize: 9 }}
            >
              &times;
            </span>
          </span>
        ))}
        {selectedArr.length > 0 && (
          <span
            onClick={(e) => { e.stopPropagation(); onClearAll(); }}
            style={{ color: "var(--fg-faint)", cursor: "pointer", marginLeft: "auto", fontSize: 8 }}
          >
            clear
          </span>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 10,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderTop: "none",
            maxHeight: 180,
            overflowY: "auto",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Type to filter..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "4px 6px",
              fontSize: 9,
              fontFamily: "inherit",
              border: "none",
              borderBottom: "1px solid var(--border)",
              background: "transparent",
              color: "var(--fg)",
              outline: "none",
            }}
          />
          {filtered.map(tag => (
            <div
              key={tag}
              onClick={() => handleToggle(tag)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 6px",
                cursor: "pointer",
                fontSize: 9,
                color: "var(--fg)",
              }}
            >
              <span style={{ width: 12, textAlign: "center", fontSize: 10 }}>
                {selectedTags.has(tag) ? "\u2713" : ""}
              </span>
              <span>{tag}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: "6px", fontSize: 9, color: "var(--fg-faint)", textAlign: "center" }}>
              No matching tags
            </div>
          )}
        </div>
      )}
    </div>
  );
});
