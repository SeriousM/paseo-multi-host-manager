import { MASK_PLACEHOLDER, maskJson } from "../../shared/mask";
import type { Json } from "../../shared/mask";
import { sameJson } from "../state/grid-model";
import { flattenDoc, getAt, removeAt } from "./doc-tree";
import type { Segment } from "./doc-tree";

/**
 * What the write does to one key:
 * - `kept`: a `<masked>` placeholder, the host keeps the value it stores there.
 * - `secretReplaced` / `secretAdded` / `secretRemoved`: a secret gets a new value, appears, or is deleted. The value is never shown.
 * - `unresolved`: a placeholder where the host stores nothing; the write would fail (`invalid_input`).
 */
export type PreviewKind = "unchanged" | "changed" | "added" | "removed" | "kept" | "secretReplaced" | "secretAdded" | "secretRemoved" | "unresolved";

export interface PreviewEntry {
  path: string;
  kind: PreviewKind;
  /** Display text of the stored value (`<masked>` for a secret); null when the key is new. */
  before: string | null;
  /** Display text of the written value (`<secret>` for a secret); null when the key is removed. */
  after: string | null;
}

export interface DocPreview {
  entries: PreviewEntry[];
  counts: Record<PreviewKind, number>;
  /** Why the write cannot be staged; null when it can. */
  blocked: string | null;
  /** Whether the write differs from what the host stores (kept placeholders do not count). */
  changed: boolean;
}

const VALUE_LIMIT = 60;
const SECRET_TEXT = "<secret>";

function show(value: Json): string {
  const text = JSON.stringify(value);
  return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT - 1)}…` : text;
}

/**
 * Every key the write will contain, compared with the document as the host returned it (`current`, secrets masked;
 * null when the host has no document). `draft` is the whole new document: the companion replaces the file with it, so a
 * key missing from `draft` is deleted.
 */
export function previewWrite(input: { current: Json | null; currentMaskedPaths: readonly string[]; draft: Json }): DocPreview {
  const stored = new Map(input.current === null ? [] : flattenDoc(input.current).map((leaf) => [leaf.path, leaf.value]));
  const storedSecret = new Set(input.currentMaskedPaths);
  const draftLeaves = flattenDoc(input.draft);
  const draftSecret = new Set(maskJson(input.draft).maskedPaths);
  const entries: PreviewEntry[] = [];

  for (const { path, value } of draftLeaves) {
    const before = stored.get(path);
    if (value === MASK_PLACEHOLDER) {
      entries.push(before === undefined ? { path, kind: "unresolved", before: null, after: MASK_PLACEHOLDER } : { path, kind: "kept", before: MASK_PLACEHOLDER, after: MASK_PLACEHOLDER });
    } else if (before === undefined) {
      const secret = draftSecret.has(path);
      entries.push({ path, kind: secret ? "secretAdded" : "added", before: null, after: secret ? SECRET_TEXT : show(value) });
    } else if (storedSecret.has(path)) {
      entries.push({ path, kind: "secretReplaced", before: MASK_PLACEHOLDER, after: SECRET_TEXT });
    } else if (sameJson(before, value)) {
      entries.push({ path, kind: "unchanged", before: show(before), after: show(value) });
    } else {
      entries.push({ path, kind: "changed", before: show(before), after: draftSecret.has(path) ? SECRET_TEXT : show(value) });
    }
  }
  const written = new Set(draftLeaves.map((leaf) => leaf.path));
  for (const [path, value] of stored) {
    if (written.has(path)) continue;
    entries.push(storedSecret.has(path) ? { path, kind: "secretRemoved", before: MASK_PLACEHOLDER, after: null } : { path, kind: "removed", before: show(value), after: null });
  }

  const counts: Record<PreviewKind, number> = { unchanged: 0, changed: 0, added: 0, removed: 0, kept: 0, secretReplaced: 0, secretAdded: 0, secretRemoved: 0, unresolved: 0 };
  for (const entry of entries) counts[entry.kind] += 1;
  const unresolved = entries.filter((entry) => entry.kind === "unresolved").map((entry) => entry.path || "(document)");
  const blocked = unresolved.length > 0 ? `This host stores nothing at ${unresolved.join(", ")}, so a <masked> placeholder there cannot be kept. Remove the key or type a value.` : null;
  return { entries, counts, blocked, changed: entries.some((entry) => entry.kind !== "unchanged" && entry.kind !== "kept") };
}

/** One line for the preview header, e.g. "Writes 12 keys: 2 changed, 1 new, 3 masked keys kept as on the host". */
export function summarizePreview(preview: DocPreview): string {
  const { counts } = preview;
  const written = preview.entries.length - counts.removed - counts.secretRemoved;
  const parts = [
    counts.changed + counts.secretReplaced > 0 ? `${counts.changed + counts.secretReplaced} changed` : null,
    counts.added + counts.secretAdded > 0 ? `${counts.added + counts.secretAdded} new` : null,
    counts.removed + counts.secretRemoved > 0 ? `${counts.removed + counts.secretRemoved} removed` : null,
    counts.kept > 0 ? `${counts.kept} masked kept as on the host` : null,
    counts.unresolved > 0 ? `${counts.unresolved} unresolved` : null,
  ].filter((part) => part !== null);
  return `Writes ${written} key${written === 1 ? "" : "s"}${parts.length > 0 ? `: ${parts.join(", ")}` : ": no change"}`;
}

export interface DocPastePlan {
  /** The clipboard values without the masked keys the target lacks. */
  values: Json;
  /** Masked keys dropped because the target stores nothing there (the contract rule: such a write would fail). */
  dropped: string[];
  /** Masked list elements the target lacks: dropping would shift the other elements, so they stay and block staging. */
  unresolved: string[];
}

/**
 * Prepares a clipboard document (secrets masked at the source) for the target's own document. A `<masked>` placeholder
 * stays where the target stores a value (it keeps its own); where the target has nothing, the key is dropped.
 * `target` is the target's document from `mhm.doc.read`, null when it has none.
 */
export function planDocPaste(clipValues: Json, target: Json | null): DocPastePlan {
  const dropped: string[] = [];
  const unresolved: string[] = [];
  let values = clipValues;
  const holes = flattenDoc(clipValues).filter((leaf) => leaf.value === MASK_PLACEHOLDER);
  for (const { segments, path } of holes) {
    if (target !== null && getAt(target, segments) !== undefined) continue;
    const last: Segment | undefined = segments[segments.length - 1];
    if (typeof last === "string") {
      values = removeAt(values, segments);
      dropped.push(path);
    } else {
      unresolved.push(path === "" ? "(document)" : path);
    }
  }
  return { values, dropped, unresolved };
}

/** Text for the paste note: which masked keys were dropped or cannot be resolved. Empty when there is nothing to say. */
export function pasteNote(plan: DocPastePlan, targetLabel: string): string {
  const notes = [];
  if (plan.dropped.length > 0) notes.push(`Left out ${plan.dropped.length} masked key${plan.dropped.length === 1 ? "" : "s"} that ${targetLabel} does not have (secrets are never copied): ${plan.dropped.join(", ")}.`);
  if (plan.unresolved.length > 0) notes.push(`Masked list element${plan.unresolved.length === 1 ? "" : "s"} without a counterpart on ${targetLabel}: ${plan.unresolved.join(", ")}. Remove ${plan.unresolved.length === 1 ? "it" : "them"} in the JSON view.`);
  return notes.join(" ");
}
