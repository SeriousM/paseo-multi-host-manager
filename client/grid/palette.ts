import type { PluginTheme } from "@getpaseo/plugin";
import type { CellTone } from "../state/grid-model";

/**
 * Fixed row heights keep the label column aligned with the host columns; they follow from TYPE (two text lines plus
 * padding for a row, five for a host header, or four plus a button). Column widths come from `gridLayout`.
 */
export const SIZES = {
  labelWidth: 290,
  minColumnWidth: 220,
  maxColumnWidth: 420,
  headerHeight: 160,
  sectionHeight: 36,
  rowHeight: 76,
  pluginRowHeight: 84,
} as const;

/** Type scale: body 15, secondary 13. Monospace values one step smaller, since the face runs wider. */
export const TYPE = { title: 18, heading: 16, body: 15, control: 14, mono: 14, secondary: 13, badge: 12 } as const;

/** Font size with a line height of 1.4: one call per text style, so the scale and its spacing change together. */
export function font(size: number): { fontSize: number; lineHeight: number } {
  return { fontSize: size, lineHeight: Math.round(size * 1.4) };
}

export const MONO = { fontFamily: "monospace" } as const;

/** `color` with `alpha` (0..1) for hex and rgb() theme colors; other notations come back unchanged. */
export function tint(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
    return `#${digits}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
  }
  const rgb = /^rgb\(\s*([^)]+)\)$/i.exec(color.trim());
  return rgb ? `rgba(${rgb[1]}, ${alpha})` : color;
}

/** Background and border of a cell per tone, after the mockup's legend: source, valid target, staged, applied, failed. */
export function toneStyle(theme: PluginTheme, tone: CellTone): { backgroundColor: string; borderColor: string; borderStyle: "solid" | "dashed" } {
  const { colors } = theme;
  switch (tone) {
    case "source":
      return { backgroundColor: tint(colors.accent, 0.22), borderColor: colors.accent, borderStyle: "solid" };
    case "baseline":
      return { backgroundColor: tint(colors.accent, 0.14), borderColor: tint(colors.accent, 0.6), borderStyle: "solid" };
    case "differs":
      return { backgroundColor: tint(colors.accent, 0.07), borderColor: colors.accent, borderStyle: "dashed" };
    case "staged":
      return { backgroundColor: tint(colors.statusWarning, 0.14), borderColor: tint(colors.statusWarning, 0.5), borderStyle: "solid" };
    case "applying":
      return { backgroundColor: tint(colors.accent, 0.25), borderColor: colors.accent, borderStyle: "solid" };
    case "applied":
      return { backgroundColor: tint(colors.statusSuccess, 0.18), borderColor: tint(colors.statusSuccess, 0.5), borderStyle: "solid" };
    case "failed":
      return { backgroundColor: tint(colors.statusDanger, 0.16), borderColor: tint(colors.statusDanger, 0.6), borderStyle: "solid" };
    case "attention":
      return { backgroundColor: tint(colors.statusWarning, 0.06), borderColor: colors.statusWarning, borderStyle: "dashed" };
    case "plain":
      return { backgroundColor: "transparent", borderColor: "transparent", borderStyle: "solid" };
  }
}

export type Severity = "ok" | "warn" | "bad" | "muted" | "accent";

export function severityColor(theme: PluginTheme, severity: Severity): string {
  const { colors } = theme;
  switch (severity) {
    case "ok":
      return colors.statusSuccess;
    case "warn":
      return colors.statusWarning;
    case "bad":
      return colors.statusDanger;
    case "accent":
      return colors.accent;
    case "muted":
      return colors.foregroundMuted;
  }
}
