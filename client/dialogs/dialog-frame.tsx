import { Modal } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Button } from "../grid/primitives";
import type { MhmSurfaceProps } from "../surface";
import { font, TYPE } from "../grid/palette";

/** Props of every dialog: chrome, controller, and how to close it (the DialogHost passes `closeDialog`). */
export interface DialogProps extends MhmSurfaceProps {
  onClose: () => void;
}

/** Modal with a title, a body and a footer row of buttons; the shared frame for the dialogs of 8b and 8c. */
export function DialogFrame({ theme, title, onClose, children, footer, closeLabel = "Close" }: Pick<DialogProps, "theme" | "onClose"> & { title: string; children: ReactNode; footer?: ReactNode; closeLabel?: string }) {
  return (
    <Modal title={title} open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Modal.Content>
        {children}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          {footer}
          <Button theme={theme} label={closeLabel} onPress={onClose} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

/** Placeholder body for parts another work package fills in. */
export function Pending({ theme, text }: Pick<DialogProps, "theme"> & { text: string }) {
  return <Text style={{ color: theme.colors.foregroundMuted, ...font(TYPE.body) }}>{text}</Text>;
}
