import type { GridHost } from "../state/types";
import { SIZES } from "./palette";

export interface GridLayout {
  /** Width of every host column. */
  columnWidth: number;
  /** Width of the panel next to a lone hub column that explains how to add hosts; 0 when there is none. */
  panelWidth: number;
  /** Width of the horizontally scrolling part: host columns plus the panel. */
  contentWidth: number;
}

/** The panel's narrowest width; below it the row scrolls instead. */
export const PANEL_MIN_WIDTH = 320;

/**
 * Host columns share the width next to the label column, each between SIZES.minColumnWidth and maxColumnWidth. With
 * more hosts than fit at the minimum the columns keep that width and the area scrolls sideways. `available` is the
 * screen's width (0 before it was measured); `hubOnly` adds the explanation panel next to the hub column.
 */
export function gridLayout(available: number, hostCount: number, hubOnly: boolean): GridLayout {
  const room = Math.max(0, available - SIZES.labelWidth - 1);
  if (hubOnly) {
    const columnWidth = SIZES.minColumnWidth + 40;
    const panelWidth = Math.max(PANEL_MIN_WIDTH, room - columnWidth);
    return { columnWidth, panelWidth, contentWidth: columnWidth + panelWidth };
  }
  const share = hostCount > 0 ? Math.floor(room / hostCount) : SIZES.minColumnWidth;
  const columnWidth = Math.min(SIZES.maxColumnWidth, Math.max(SIZES.minColumnWidth, share));
  return { columnWidth, panelWidth: 0, contentWidth: columnWidth * hostCount };
}

/** The hub answered and has no saved hosts: the grid has one column and the panel explains why. */
export function hubOnly(hosts: readonly GridHost[]): boolean {
  return hosts.length === 1 && hosts[0].isHub && hosts[0].result.ok;
}
