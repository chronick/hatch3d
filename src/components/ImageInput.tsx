import { memo, useCallback, useRef, useState } from "react";
import type { ImageSource } from "../compositions/types";

/**
 * File-picker + image decoder. Decodes the picked file to a greyscale
 * brightness grid (Float32Array in [0,1], row-major) at the requested
 * sample width, preserving aspect ratio. The grid is passed back to the
 * caller via `onChange`.
 */
export const ImageInput = memo(function ImageInput({
  label,
  value,
  sampleSize = 256,
  onChange,
}: {
  label: string;
  value: ImageSource | null;
  sampleSize?: number;
  onChange: (v: ImageSource | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        const bitmap = await createImageBitmap(file);
        const aspect = bitmap.width / bitmap.height;
        const w = sampleSize;
        const h = Math.max(1, Math.round(sampleSize / aspect));
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d canvas unavailable");
        ctx.drawImage(bitmap, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const px = img.data;
        const brightness = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const r = px[i * 4];
          const g = px[i * 4 + 1];
          const b = px[i * 4 + 2];
          // Rec. 601 luma.
          brightness[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        }
        bitmap.close();
        onChange({ brightness, width: w, height: h, name: file.name });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [sampleSize, onChange],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f && f.type.startsWith("image/")) handleFile(f);
    },
    [handleFile],
  );

  const clear = useCallback(() => {
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [onChange]);

  const status = error
    ? `error: ${error}`
    : loading
      ? "decoding…"
      : value
        ? `${value.name ?? "image"} · ${value.width}×${value.height}`
        : "no image";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>{label}</span>
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{
          border: "1px dashed var(--fg-muted)",
          borderRadius: 4,
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontSize: 11,
        }}
      >
        <div style={{ color: "var(--fg-muted)" }}>{status}</div>
        <div style={{ display: "flex", gap: 4 }}>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={onPick}
            style={{ fontSize: 11, flex: 1 }}
          />
          {value && (
            <button
              onClick={clear}
              style={{ fontSize: 11 }}
              title="Clear image"
            >
              clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
