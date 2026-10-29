import type { PluginHostProps } from "@getpaseo/plugin/client";
import type { MhmController } from "./state/hooks";

/** Props every part of the screen gets: the host's chrome and the controller (state, dispatch, commands). */
export interface MhmSurfaceProps {
  theme: PluginHostProps["theme"];
  layout: PluginHostProps["layout"];
  controller: MhmController;
}
