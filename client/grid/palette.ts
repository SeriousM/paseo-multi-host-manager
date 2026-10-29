import type { PluginTheme } from "@getpaseo/plugin";
import type { CellTone } from "../state/grid-model";

export const SIZES = {
  labelWidth: 280,
  columnWidth: 210,
  headerHeight: 112,
  sectionHeight: 30,
  rowHeight: 58,
  pluginRowHeight: 64,
} as const;

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
