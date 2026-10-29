export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export const MASK_PLACEHOLDER = "<masked>";

const SECRET_KEY = /token|key|secret|pass|auth|credential|bearer|cookie|private/i;
const SECRET_VALUE = /^(sk-|ghp_|gho_|github_pat_|xox[abp]-|AKIA|eyJ[\w-]+\.|\$2[aby]\$)/;
const BEARER_VALUE = /^bearer\s+\S/i;

/** Replaces secret-looking strings (by key name or by value shape) with MASK_PLACEHOLDER. */
export function maskJson(value: Json): { value: Json; maskedPaths: string[] } {
  const maskedPaths: string[] = [];
  const walk = (node: Json, path: string, secretKey: boolean): Json => {
    if (typeof node === "string") {
      if (node !== "" && (secretKey || SECRET_VALUE.test(node) || BEARER_VALUE.test(node))) {
        maskedPaths.push(path);
        return MASK_PLACEHOLDER;
      }
      return node;
    }
    if (Array.isArray(node)) return node.map((item, index) => walk(item, `${path}[${index}]`, secretKey));
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([key, child]) => [
          key,
          walk(child, path === "" ? key : `${path}.${key}`, secretKey || SECRET_KEY.test(key)),
        ]),
      );
    }
    return node;
  };
  return { value: walk(value, "", false), maskedPaths };
}

function childOf(existing: Json | undefined, key: string | number): Json | undefined {
  if (typeof key === "number") return Array.isArray(existing) ? existing[key] : undefined;
  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) return undefined;
  return Object.hasOwn(existing, key) ? existing[key] : undefined;
}

/** Replaces every MASK_PLACEHOLDER in `incoming` with the value at the same path in `existing`. */
export function restoreMasked(
  incoming: Json,
  existing: Json | undefined,
): { value: Json; keptPaths: string[]; unresolvedPaths: string[] } {
  const keptPaths: string[] = [];
  const unresolvedPaths: string[] = [];
  const walk = (node: Json, current: Json | undefined, path: string): Json => {
    if (node === MASK_PLACEHOLDER) {
      if (current === undefined) {
        unresolvedPaths.push(path);
        return node;
      }
      keptPaths.push(path);
      return current;
    }
    if (Array.isArray(node)) return node.map((item, index) => walk(item, childOf(current, index), `${path}[${index}]`));
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([key, child]) => [
          key,
          walk(child, childOf(current, key), path === "" ? key : `${path}.${key}`),
        ]),
      );
    }
    return node;
  };
  return { value: walk(incoming, existing, ""), keptPaths, unresolvedPaths };
}
