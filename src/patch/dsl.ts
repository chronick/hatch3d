/**
 * Patch DSL — the thin scripting surface that compiles to the JSON patch graph.
 *
 * The graph (graph.ts) is the validated wire format; this is the ergonomic layer
 * an agent (or human) writes, per the AIDL finding: let the model author a small
 * script, compile to a checked structure. Deliberately flat — every node is
 * named, so every intermediate signal is inspectable and measurable (which is
 * also the design's "every node inspectable" stance).
 *
 * Grammar (line-oriented):
 *   name = fn(pos, key: val, ...)     # assignment; fn is a composition id or an operator
 *   repeat N { <statements> }         # bounded iteration, threads the reused variable
 *   out(name @ "#color", name2)       # outputs; `@ "color"` wraps in a pen
 *   # comments with leading '#'
 *
 * Operators (reserved fn names): simplexScalar, simplexVector, density, gradient,
 * sdf, blend, distort, cull, thin, regionHatch, transform, clip, pen. Any other
 * fn name is a composition (generator node). For operators, the first positional
 * arg is the input node (`from`). Array literals (`translate: [10, -4]`) work.
 */

import type { PatchNode, PatchDoc } from "./graph.js";

const OPERATOR_OPS = new Set([
  "simplexScalar", "simplexVector", "density", "gradient", "sdf", "blend", "distort", "cull", "thin", "regionHatch", "transform", "clip", "pen",
]);

type ArgValue = string | number | number[];
type Arg = { key: string | null; value: ArgValue };

function parseValue(raw: string): ArgValue {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  if (t.startsWith("[") && t.endsWith("]")) {
    // Numeric array literal, e.g. translate: [10, -4]. Empty elements (a
    // trailing comma `[10,]`) become NaN so validation rejects them rather
    // than silently coercing "" → 0.
    return t.slice(1, -1).split(",").map((s) => {
      const el = s.trim();
      return el === "" ? NaN : Number(el);
    });
  }
  const n = Number(t);
  return Number.isNaN(n) ? t : n; // bare word → node ref (string)
}

/**
 * Split on top-level commas — commas inside quotes, parens, or brackets don't
 * split. So string values (`"rgb(255,0,0)"`) and array literals (`[10, 0]`)
 * survive intact.
 */
export function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') { inStr = !inStr; cur += ch; }
    else if (!inStr && (ch === "(" || ch === "[")) { depth++; cur += ch; }
    else if (!inStr && (ch === ")" || ch === "]")) { depth = Math.max(0, depth - 1); cur += ch; }
    else if (!inStr && ch === "," && depth === 0) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function parseArgs(argStr: string): Arg[] {
  const s = argStr.trim();
  if (!s) return [];
  return splitTopLevel(s).map((part) => {
    const seg = part.trim();
    const colon = seg.indexOf(":");
    // A colon inside a quoted string isn't a key separator.
    if (colon >= 0 && !seg.slice(0, colon).includes('"')) {
      return { key: seg.slice(0, colon).trim(), value: parseValue(seg.slice(colon + 1)) };
    }
    return { key: null, value: parseValue(seg) };
  });
}

function buildNode(id: string, fn: string, args: Arg[]): PatchNode {
  const named = new Map<string, ArgValue>();
  const positional: ArgValue[] = [];
  for (const a of args) {
    if (a.key) named.set(a.key, a.value);
    else positional.push(a.value);
  }
  const req = (k: string): ArgValue => {
    if (!named.has(k)) throw new Error(`patch DSL: ${fn}(...) missing required arg "${k}"`);
    return named.get(k)!;
  };
  const from = () => String(positional[0] ?? named.get("from") ?? err(`${fn}(...) needs an input node`));
  const asTuple = (v: ArgValue, k: string): [number, number] => {
    if (!Array.isArray(v) || v.length !== 2) throw new Error(`patch DSL: ${fn}(...) "${k}" must be [x, y]`);
    return [v[0], v[1]];
  };

  if (!OPERATOR_OPS.has(fn)) {
    // Generator: any composition id. All args are params.
    const params: Record<string, unknown> = {};
    for (const [k, v] of named) params[k] = v;
    return { op: "generator", id, composition: fn, ...(Object.keys(params).length ? { params } : {}) };
  }
  switch (fn) {
    case "simplexScalar": return { op: "simplexScalar", id, scale: Number(req("scale")), seed: Number(req("seed")) };
    case "simplexVector": return { op: "simplexVector", id, scale: Number(req("scale")), seed: Number(req("seed")) };
    case "density": return { op: "density", id, from: from(), cell: Number(req("cell")) };
    case "gradient": return { op: "gradient", id, from: from() };
    case "sdf": return { op: "sdf", id, from: from() };
    case "blend": return {
      op: "blend", id,
      a: String(positional[0] ?? req("a")),
      b: String(positional[1] ?? req("b")),
      mode: (named.has("mode") ? String(named.get("mode")) : "add") as "add" | "mul" | "max" | "min" | "mix",
      mix: named.has("mix") ? Number(named.get("mix")) : 0.5,
    };
    case "distort": return { op: "distort", id, from: from(), by: String(req("by")), amp: Number(req("amp")) };
    case "cull": return { op: "cull", id, from: from(), by: String(req("by")), min: Number(req("min")), max: Number(req("max")) };
    case "thin": return { op: "thin", id, from: from(), by: String(req("by")), strength: Number(req("strength")) };
    case "regionHatch": return { op: "regionHatch", id, from: from(), angleDeg: Number(req("angle")), pitch: Number(req("pitch")) };
    case "transform": {
      const node: PatchNode = { op: "transform", id, from: from() };
      if (named.has("translate")) node.translate = asTuple(named.get("translate")!, "translate");
      if (named.has("rotate")) node.rotateDeg = Number(named.get("rotate"));
      if (named.has("scale")) {
        const s = named.get("scale")!;
        node.scale = Array.isArray(s) ? asTuple(s, "scale") : Number(s);
      }
      return node;
    }
    case "clip": return { op: "clip", id, from: from(), hullOf: String(req("by")) };
    case "pen": return { op: "pen", id, from: from(), ...(named.has("color") ? { color: String(named.get("color")) } : {}), ...(named.has("name") ? { name: String(named.get("name")) } : {}), ...(named.has("width") ? { width: Number(named.get("width")) } : {}) };
    default: throw new Error(`patch DSL: unknown operator "${fn}"`);
  }
}

function err(msg: string): never {
  throw new Error(`patch DSL: ${msg}`);
}

const ASSIGN_RE = /^([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\((.*)\)\s*$/;
const REPEAT_RE = /^repeat\s+(\d+)\s*\{\s*$/;
const OUT_RE = /^out\s*\((.*)\)\s*$/;

interface ParseState {
  defined: Set<string>;
  penCounter: { n: number };
}

/** Parse a list of statement lines into nodes; tracks defined names for repeat threading. */
function parseBlock(lines: string[], start: number, endToken: string | null, state: ParseState): { nodes: PatchNode[]; next: number } {
  const nodes: PatchNode[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (endToken && line === endToken) return { nodes, next: i + 1 };
    if (!line || line.startsWith("#")) { i++; continue; }

    const rep = line.match(REPEAT_RE);
    if (rep) {
      const times = Number(rep[1]);
      const before = new Set(state.defined);
      const { nodes: body, next } = parseBlock(lines, i + 1, "}", state);
      // Thread = first body assignment that was already defined before the loop.
      const thread = body.map((n) => n.id).find((id) => before.has(id));
      if (!thread) throw new Error(`patch DSL: repeat block must reassign a pre-existing variable (found none)`);
      nodes.push({ op: "repeat", id: `repeat_${i}`, times, thread, body });
      i = next;
      continue;
    }

    if (OUT_RE.test(line)) { i++; continue; } // out handled by the top-level parser

    const m = line.match(ASSIGN_RE);
    if (!m) throw new Error(`patch DSL: cannot parse line ${i + 1}: "${line}"`);
    const [, name, fn, argStr] = m;
    nodes.push(buildNode(name, fn, parseArgs(argStr)));
    state.defined.add(name);
    i++;
  }
  if (endToken) throw new Error(`patch DSL: unclosed block, expected "${endToken}"`);
  return { nodes, next: i };
}

/** Compile DSL source into a validated-ready PatchDoc (still pass through parsePatchDoc). */
export function compileDSL(source: string, opts: { id?: string; page?: Partial<PatchDoc["page"]> } = {}): PatchDoc {
  const lines = source.split("\n");
  const state: ParseState = { defined: new Set(), penCounter: { n: 0 } };
  const { nodes } = parseBlock(lines, 0, null, state);

  // Parse the out(...) statement (there must be exactly one).
  const outLine = lines.map((l) => l.trim()).find((l) => OUT_RE.test(l));
  if (!outLine) throw new Error(`patch DSL: no out(...) statement`);
  const outArgs = outLine.match(OUT_RE)![1];
  const out: string[] = [];
  for (const item of splitTopLevel(outArgs).map((s) => s.trim()).filter(Boolean)) {
    const at = item.match(/^([A-Za-z_]\w*)\s*@\s*"([^"]*)"\s*$/);
    if (at) {
      // Wrap the referenced node in an auto-pen.
      const penId = `pen_${state.penCounter.n++}`;
      nodes.push({ op: "pen", id: penId, from: at[1], color: at[2] });
      out.push(penId);
    } else if (/^[A-Za-z_]\w*$/.test(item)) {
      out.push(item);
    } else {
      throw new Error(`patch DSL: bad out item "${item}"`);
    }
  }

  return {
    version: 1,
    id: opts.id ?? "patch",
    page: {
      size: opts.page?.size ?? "a3",
      orientation: opts.page?.orientation ?? "landscape",
      marginMm: opts.page?.marginMm ?? 15,
      widthPx: opts.page?.widthPx ?? 800,
      heightPx: opts.page?.heightPx ?? 800,
      strokeWidthMm: opts.page?.strokeWidthMm ?? 0.5,
    },
    camera: { theta: 0.6, phi: 0.35, dist: 8, ortho: false },
    nodes,
    out,
  };
}
