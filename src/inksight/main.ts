/**
 * InkSight — client-side SVG → structured report.
 *
 * DOM glue only: drops the file text into `analyzeSvg` (src/stats/analyze.ts —
 * the same deterministic core `npm run stats` runs) and paints the view-model
 * built by report.ts, alongside the raw `StatsReport` JSON an agent would
 * actually consume and a rendered thumbnail for a multimodal cross-check.
 *
 * Everything runs in the browser; nothing is uploaded. The dropped markup is
 * never injected into this document — the thumbnail goes through an object-URL
 * in an `<img>`, where scripts in the SVG do not execute, and every text node
 * comes from `textContent`.
 */

import { analyzeSvg, type StatsReport } from "../stats/analyze";
import {
  buildReportModel,
  SCOPE_NOTE,
  type HeatmapModel,
  type LayerRow,
  type ReportModel,
  type StatRow,
  type WarningItem,
} from "./report";
import "./inksight.css";

const drop = document.getElementById("drop") as HTMLDivElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const out = document.getElementById("output") as HTMLElement;

let thumbUrl: string | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function panel(title: string, ...children: Node[]): HTMLElement {
  const section = el("section", "panel");
  section.append(el("h2", undefined, title), ...children);
  return section;
}

function statTable(rows: StatRow[]): HTMLTableElement {
  const table = el("table");
  const body = el("tbody");
  for (const r of rows) {
    const tr = el("tr");
    tr.append(el("td", "label", r.label), el("td", "value", r.value));
    body.append(tr);
  }
  table.append(body);
  return table;
}

function layerTable(rows: LayerRow[]): HTMLElement {
  const wrap = el("div", "scroll");
  const table = el("table");
  const head = el("thead");
  const headRow = el("tr");
  for (const h of ["layer", "paths", "vertices", "arc length", "ink density"]) {
    headRow.append(el("th", undefined, h));
  }
  head.append(headRow);

  const body = el("tbody");
  for (const r of rows) {
    const tr = el("tr");
    const idCell = el("td", "value");
    const swatch = el("span", "swatch");
    // CSSOM assignment: an unparseable stroke value is dropped, never injected.
    swatch.style.backgroundColor = r.swatch;
    swatch.title = r.stroke ?? "inherited (black)";
    idCell.append(swatch, document.createTextNode(r.id));
    tr.append(
      idCell,
      el("td", "num", r.paths),
      el("td", "num", r.vertices),
      el("td", "num", r.arcLength),
      el("td", "num", r.inkDensity),
    );
    body.append(tr);
  }
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

function heatGrid(model: HeatmapModel): HTMLElement {
  const grid = el("div", "heat");
  grid.style.gridTemplateColumns = `repeat(${model.cols}, 1fr)`;
  for (const cell of model.cells) {
    const box = el("div");
    box.style.backgroundColor = cell.shade;
    box.title = cell.title;
    grid.append(box);
  }
  const wrap = el("div");
  const legend = el(
    "p",
    "legend",
    model.stats.map((s) => `${s.label} ${s.value}`).join("   ·   "),
  );
  wrap.append(grid, legend);
  return wrap;
}

function warningList(items: WarningItem[]): HTMLElement {
  const list = el("ul", "warnings");
  for (const item of items) list.append(el("li", item.level, item.text));
  return list;
}

function jsonPanel(report: StatsReport): HTMLElement {
  const section = el("section", "panel");
  const header = el("div", "head-row");
  const copy = el("button", undefined, "copy");
  const json = JSON.stringify(report, null, 2);
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(json).then(
      () => {
        copy.textContent = "copied";
        setTimeout(() => (copy.textContent = "copy"), 1200);
      },
      () => (copy.textContent = "copy failed"),
    );
  });
  header.append(el("h2", undefined, "StatsReport JSON"), copy);
  section.append(header, el("pre", undefined, json));
  return section;
}

function thumbnail(text: string): HTMLElement {
  if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  thumbUrl = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  const img = el("img", "thumb");
  img.alt = "Rendered preview of the dropped SVG";
  img.src = thumbUrl;
  const fallback = el("p", "note", "Browser could not render this file as an image.");
  fallback.hidden = true;
  img.addEventListener("error", () => {
    img.hidden = true;
    fallback.hidden = false;
  });
  const wrap = el("div");
  wrap.append(img, fallback);
  return wrap;
}

function errorPanel(message: string): HTMLElement {
  return panel(
    "Not measurable",
    el("p", "error", message),
    el("p", "note", SCOPE_NOTE),
  );
}

function reportPanels(model: ReportModel): Node[] {
  const columns = el("div", "grid-2");
  const left = el("div");
  left.append(el("h2", undefined, "Page"), statTable(model.summary));
  const right = el("div");
  right.append(el("h2", undefined, "Totals"), statTable(model.totals));
  columns.append(left, right);

  const summary = el("section", "panel");
  summary.append(columns);

  return [
    summary,
    panel("Layers", layerTable(model.layers)),
    panel("Density grid", heatGrid(model.heatmap)),
    panel("Warnings", warningList(model.warnings)),
  ];
}

function render(name: string, text: string): void {
  out.replaceChildren();
  out.hidden = false;
  out.append(panel(name, thumbnail(text)));

  let report: StatsReport;
  try {
    report = analyzeSvg(text, { input: name });
  } catch (err) {
    out.append(errorPanel(err instanceof Error ? err.message : String(err)));
    return;
  }
  out.append(...reportPanels(buildReportModel(report)), jsonPanel(report));
}

function load(file: File): void {
  void file.text().then((text) => render(file.name, text));
}

drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const file = e.dataTransfer?.files?.[0];
  if (file) load(file);
});
// A drop anywhere else would navigate away from the page and lose the report.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) load(file);
});
