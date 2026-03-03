/**
 * Export SVG content to PNG via offscreen canvas.
 */

export interface PngThemeColors {
  bg: string;
  stroke: string;
}

export const PNG_THEMES: Record<"light" | "dark", PngThemeColors> = {
  light: { bg: "#ffffff", stroke: "#1a1a1a" },
  dark: { bg: "#2a2a2f", stroke: "#e8e6e1" },
};

export const PNG_SCALE_OPTIONS = [
  { label: "1x", value: 1 },
  { label: "2x", value: 2 },
  { label: "3x", value: 3 },
  { label: "4x", value: 4 },
  { label: "6x", value: 6 },
  { label: "8x", value: 8 },
] as const;

export const DEFAULT_PNG_SCALE = 6;

/**
 * Renders SVG XML to a PNG blob with the given theme colors.
 * Replaces stroke="black" with the theme stroke color and adds a background.
 */
export function exportPng(
  svgContent: string,
  theme: PngThemeColors,
  scale: number = DEFAULT_PNG_SCALE,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Replace stroke="black" with theme color
    let themed = svgContent.replace(/stroke="black"/g, `stroke="${theme.stroke}"`);

    // Extract viewBox dimensions
    const vbMatch = themed.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    if (!vbMatch) {
      reject(new Error("Could not parse SVG viewBox"));
      return;
    }
    const vbW = parseFloat(vbMatch[1]);
    const vbH = parseFloat(vbMatch[2]);

    // Add background rect right after opening <svg...>
    const bgRect = `<rect width="${vbW}" height="${vbH}" fill="${theme.bg}"/>`;
    themed = themed.replace(/(viewBox="[^"]*">)/, `$1\n  ${bgRect}`);

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vbW * scale);
    canvas.height = Math.ceil(vbH * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Could not get canvas 2d context"));
      return;
    }

    const img = new Image();
    const svgBlob = new Blob([themed], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas toBlob returned null"));
        },
        "image/png",
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SVG as image"));
    };
    img.src = url;
  });
}
