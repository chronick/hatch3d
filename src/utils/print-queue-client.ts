/**
 * Print queue client — sends compositions to the CF print queue.
 * Only active when VITE_PRINT_QUEUE_URL is set (local dev via .env.local).
 */

const QUEUE_URL = import.meta.env.VITE_PRINT_QUEUE_URL as string | undefined;
const QUEUE_TOKEN = import.meta.env.VITE_PRINT_QUEUE_TOKEN as string | undefined;

export const isPrintQueueEnabled = Boolean(QUEUE_URL && QUEUE_TOKEN);

export interface QueuePayload {
  compositionKey: string;
  presetName?: string;
  svgContent: string;
  pngBlob?: Blob;
  values: Record<string, unknown>;
  camera?: { theta: number; phi: number; dist: number } | null;
  tags?: string[];
}

export async function sendToQueue(payload: QueuePayload): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!QUEUE_URL || !QUEUE_TOKEN) {
    return { ok: false, error: "Print queue not configured" };
  }

  const headers = {
    Authorization: `Bearer ${QUEUE_TOKEN}`,
  };

  const itemId = `hatch3d-${new Date().toISOString().slice(0, 10)}-${payload.compositionKey}-${Date.now().toString(36)}`;
  const svgKey = `plotter/${itemId}.svg`;
  const pngKey = `plotter/${itemId}.png`;

  // 1. Upload SVG to R2
  const svgRes = await fetch(`${QUEUE_URL}/image/${svgKey}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "image/svg+xml" },
    body: payload.svgContent,
  });

  if (!svgRes.ok) {
    return { ok: false, error: `SVG upload failed: ${svgRes.status}` };
  }

  // 2. Upload PNG to R2 (if available)
  if (payload.pngBlob) {
    const pngRes = await fetch(`${QUEUE_URL}/image/${pngKey}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "image/png" },
      body: payload.pngBlob,
    });

    if (!pngRes.ok) {
      return { ok: false, error: `PNG upload failed: ${pngRes.status}` };
    }
  }

  // 3. Add to print queue
  const title = payload.presetName || payload.compositionKey;
  const config = JSON.stringify({
    composition: payload.compositionKey,
    presetName: payload.presetName,
    values: payload.values,
    camera: payload.camera,
    svg_key: svgKey,
    tags: payload.tags || [],
  });

  const queueRes = await fetch(`${QUEUE_URL}/print-queue`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: itemId,
      title,
      composition: payload.compositionKey,
      svg_key: svgKey,
      png_key: payload.pngBlob ? pngKey : undefined,
      config,
      source: "hatch3d",
    }),
  });

  if (!queueRes.ok) {
    const err = await queueRes.json().catch(() => ({ error: "Unknown error" }));
    return { ok: false, error: (err as { error: string }).error };
  }

  const result = await queueRes.json() as { ok: boolean; id: string };
  return { ok: true, id: result.id };
}
