import type { Json } from "../../shared/mask";

/** Path segment: an object key or an array index. */
export type Segment = string | number;

/** A value without children: a primitive, null, or an empty object or array. */
export interface Leaf {
  /** Same notation as `maskedPaths` (`a.b[0].c`); empty for a document that is itself a leaf. */
  path: string;
  segments: Segment[];
  value: Json;
}

export function pathOf(segments: readonly Segment[]): string {
  return segments.reduce<string>((path, segment) => (typeof segment === "number" ? `${path}[${segment}]` : path === "" ? segment : `${path}.${segment}`), "");
}

function isObject(node: Json | undefined): node is { [key: string]: Json } {
  return node !== undefined && node !== null && typeof node === "object" && !Array.isArray(node);
}

export function flattenDoc(value: Json): Leaf[] {
  const leaves: Leaf[] = [];
  const walk = (node: Json, segments: Segment[]) => {
    if (Array.isArray(node) && node.length > 0) {
      node.forEach((child, index) => walk(child, [...segments, index]));
    } else if (isObject(node) && Object.keys(node).length > 0) {
      for (const [key, child] of Object.entries(node)) walk(child, [...segments, key]);
    } else {
      leaves.push({ path: pathOf(segments), segments, value: node });
    }
  };
  walk(value, []);
  return leaves;
}

/** The value at `segments`, or undefined when the document has nothing there. */
export function getAt(value: Json | undefined, segments: readonly Segment[]): Json | undefined {
  let node = value;
  for (const segment of segments) {
    if (typeof segment === "number") node = Array.isArray(node) ? node[segment] : undefined;
    else node = isObject(node) && Object.hasOwn(node, segment) ? node[segment] : undefined;
    if (node === undefined) return undefined;
  }
  return node;
}

/** A copy of `value` with the node at `segments` replaced. A path the document lacks leaves it unchanged. */
export function setAt(value: Json, segments: readonly Segment[], next: Json): Json {
  if (segments.length === 0) return next;
  const [head, ...rest] = segments;
  if (typeof head === "number") {
    if (!Array.isArray(value) || head >= value.length) return value;
    return value.map((child, index) => (index === head ? setAt(child, rest, next) : child));
  }
  if (!isObject(value) || !Object.hasOwn(value, head)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === head ? setAt(child, rest, next) : child]));
}

/** A copy of `value` without the member or element at `segments`. */
export function removeAt(value: Json, segments: readonly Segment[]): Json {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  if (rest.length > 0) {
    if (typeof head === "number") return Array.isArray(value) ? value.map((child, index) => (index === head ? removeAt(child, rest) : child)) : value;
    return isObject(value) ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === head ? removeAt(child, rest) : child])) : value;
  }
  if (typeof head === "number") return Array.isArray(value) ? value.filter((_, index) => index !== head) : value;
  return isObject(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== head)) : value;
}

export type ParsedDraft = { ok: true; value: Json } | { ok: false; message: string };

/** Parses the JSON editor's text. */
export function parseDraft(text: string): ParsedDraft {
  try {
    // JSON.parse yields JSON by construction.
    const value: Json = JSON.parse(text);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
