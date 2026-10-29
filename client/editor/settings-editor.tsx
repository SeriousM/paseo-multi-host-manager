import { useRpc } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { docReadRpc } from "../../shared/contracts";
import type { Json } from "../../shared/mask";
import { DialogFrame } from "../dialogs/dialog-frame";
import type { DialogProps } from "../dialogs/dialog-frame";
import { MONO } from "../grid/palette";
import { Badge, Button } from "../grid/primitives";
import { findHost } from "../state/grid-model";
import { docStatus, editorAccess, OPT_IN_EXPLANATION, stagedFor, toLoadedDoc } from "./access";
import type { LoadedDoc } from "./access";
import { DocFields } from "./doc-fields";
import { pasteNote, planDocPaste, previewWrite } from "./doc-preview";
import { parseDraft } from "./doc-tree";
import { PreviewPanel } from "./preview-panel";

export interface SettingsEditorProps extends DialogProps {
  hostId: string;
  pluginId: string;
  settingsId: string;
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; doc: LoadedDoc };

/** A document pasted from another host: schema version to write and the note about what was left out. */
interface Pasted {
  version: number;
  sourceLabel: string;
  note: string;
}

function Note({ color, text, bold = false }: { color: string; text: string; bold?: boolean }) {
  return <Text style={{ color, fontSize: 12, fontWeight: bold ? "600" : "400" }}>{text}</Text>;
}

/**
 * Editor of one plugin settings document on one host. It reads the document through the hub (`mhm.doc.read`, secrets
 * masked), shows what a write would do (`previewWrite`), and stages `writeSettingsDoc` with the revision it read, or
 * `restoreSettingsDoc`. The host's own multi-host-manager does the write and only if the host opted in; this view never
 * offers to switch that on. Nothing is sent before Apply, and a written document stays "validity unknown" until the
 * plugin is reloaded (a staged `reloadPlugin`).
 */
export function SettingsEditor({ theme, controller, onClose, hostId, pluginId, settingsId }: SettingsEditorProps) {
  const { state, dispatch, policy } = controller;
  const { colors } = theme;
  const host = findHost(state, hostId);
  const access = editorAccess(host, pluginId);
  const readDoc = useRpc(docReadRpc);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [draft, setDraft] = useState<Json | null>(null);
  const [mode, setMode] = useState<"fields" | "json">("fields");
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [pasted, setPasted] = useState<Pasted | null>(null);
  const seq = useRef(0);

  const replaceDraft = useCallback((value: Json | null) => {
    setDraft(value);
    setText(JSON.stringify(value, null, 2));
    setTextError(null);
  }, []);

  /** Reads the document again; `resetDraft` replaces the user's edits with what the host stores. */
  const reload = useCallback(
    async (resetDraft: boolean) => {
      const mine = ++seq.current;
      setLoad({ status: "loading" });
      let next: Load;
      try {
        const result = toLoadedDoc(await readDoc({ ...policy, host: hostId, pluginId, settingsId }));
        next = result.ok ? { status: "ready", doc: result.doc } : { status: "error", message: result.message };
      } catch (error) {
        next = { status: "error", message: error instanceof Error ? error.message : String(error) };
      }
      if (mine !== seq.current) return;
      setLoad(next);
      if (next.status === "ready" && resetDraft) {
        replaceDraft(next.doc.values);
        setPasted(null);
      }
    },
    [hostId, pluginId, policy, readDoc, replaceDraft, settingsId],
  );

  const accessOk = access.ok;
  useEffect(() => {
    if (accessOk) void reload(true);
    // Load once per document; later reloads are explicit.
  }, [accessOk, hostId, pluginId, settingsId]);

  const staged = host ? stagedFor(state.staged, host, pluginId, settingsId) : { doc: null, reload: null };
  const status = docStatus(staged.doc);
  const reloadStatus = docStatus(staged.reload);

  // After an applied write the host stores new bytes: show them, but keep the status of the staged item.
  const docItemStatus = staged.doc?.status;
  const previousStatus = useRef(docItemStatus);
  useEffect(() => {
    if (previousStatus.current !== "ok" && docItemStatus === "ok") void reload(true);
    previousStatus.current = docItemStatus;
  }, [docItemStatus]);

  const doc = load.status === "ready" ? load.doc : null;
  const preview = doc && draft !== null ? previewWrite({ current: doc.values, currentMaskedPaths: doc.maskedPaths, draft }) : null;
  const clip = state.clipboard;
  const pasteSource = clip?.kind === "doc" && clip.pluginId === pluginId && clip.settingsId === settingsId && clip.sourceHost !== host?.id ? clip : null;
  const version = pasted?.version ?? doc?.version ?? null;
  const versionNote = pasted && doc?.version != null && doc.version !== pasted.version ? `The source's document is schema v${pasted.version}, this host stores v${doc.version}. The write uses v${pasted.version}.` : "";
  const notes = [pasted?.note ?? "", versionNote].filter((note) => note !== "");
  const canStage = access.ok && doc !== null && draft !== null && version !== null && preview !== null && preview.changed && preview.blocked === null && textError === null && !state.applying;
  const pending = state.staged.filter((entry) => entry.status !== "ok").length;
  const label = host?.label ?? hostId;

  function stageWrite() {
    if (!host || !doc || draft === null || version === null) return;
    dispatch({ type: "stage", inputs: [{ op: "writeSettingsDoc", host: host.id, pluginId, settingsId, expectedRevision: doc.revision, version, values: draft }] });
  }

  function stageRestore() {
    if (!host || !doc) return;
    dispatch({ type: "stage", inputs: [{ op: "restoreSettingsDoc", host: host.id, pluginId, settingsId, expectedRevision: doc.revision }] });
  }

  function stageReload() {
    if (host) dispatch({ type: "stage", inputs: [{ op: "reloadPlugin", host: host.id, pluginId }] });
  }

  function pasteFromClipboard() {
    if (!pasteSource || !doc) return;
    const plan = planDocPaste(pasteSource.values, doc.values);
    replaceDraft(plan.values);
    setPasted({ version: pasteSource.version, sourceLabel: findHost(state, pasteSource.sourceHost)?.label ?? pasteSource.sourceHost, note: pasteNote(plan, label) });
    setMode("fields");
  }

  function editText(next: string) {
    setText(next);
    const parsed = parseDraft(next);
    if (parsed.ok) {
      setDraft(parsed.value);
      setTextError(null);
    } else {
      setTextError(parsed.message);
    }
  }

  const footer = (
    <>
      <Button theme={theme} variant="primary" label="Stage changes" disabled={!canStage} onPress={stageWrite} />
      {pending > 0 && !state.applying ? <Button theme={theme} label={`Apply ${pending} staged`} onPress={() => void controller.apply()} /> : null}
    </>
  );

  return (
    <DialogFrame theme={theme} title={`Edit ${pluginId}/${settingsId} on ${label}`} onClose={onClose} footer={footer}>
      <View style={{ gap: 10 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          Document <Text style={MONO}>{settingsId}</Text> of {pluginId}, stored on {label}. Read and written by the multi-host-manager instance on that host. The plugin validates it when it reloads, not when it is written.
        </Text>

        {access.ok ? null : (
          <View style={{ gap: 4, borderWidth: 1, borderColor: colors.statusWarning, borderRadius: 8, padding: 10 }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Badge theme={theme} label="read-only" severity="warn" />
              <Text style={{ color: colors.foreground, fontSize: 12, flexShrink: 1 }}>{access.reason}</Text>
            </View>
            {access.optIn ? <Note color={colors.foregroundMuted} text={OPT_IN_EXPLANATION} /> : null}
          </View>
        )}

        {access.ok && load.status === "loading" ? <Note color={colors.foregroundMuted} text="Reading the document..." /> : null}
        {access.ok && load.status === "error" ? (
          <View style={{ gap: 6, alignItems: "flex-start" }}>
            <Note color={colors.statusDanger} text={`Could not read the document: ${load.message}`} />
            <Button theme={theme} label="Retry" onPress={() => void reload(true)} />
          </View>
        ) : null}

        {access.ok && doc ? (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Badge theme={theme} label={doc.values === null ? "no document yet" : `schema v${doc.version ?? "?"}`} />
              <Badge theme={theme} label={`revision ${doc.revision === "missing" ? "none" : doc.revision.slice(0, 8)}`} />
              {doc.maskedPaths.length > 0 ? <Badge theme={theme} label={`${doc.maskedPaths.length} masked`} severity="warn" /> : null}
              {doc.hasBackup ? <Badge theme={theme} label="backup available" severity="ok" /> : null}
              <View style={{ flex: 1 }} />
              <Button theme={theme} label="Reload document" onPress={() => void reload(false)} />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {pasteSource ? <Button theme={theme} label={`Paste from ${findHost(state, pasteSource.sourceHost)?.label ?? pasteSource.sourceHost}`} onPress={pasteFromClipboard} /> : null}
              {draft !== null && doc.values !== null ? <Button theme={theme} label="Discard edits" onPress={() => { replaceDraft(doc.values); setPasted(null); }} /> : null}
              {doc.hasBackup ? <Button theme={theme} variant="danger" label="Restore from backup" disabled={state.applying} onPress={stageRestore} /> : null}
            </View>
            {pasted ? <Note color={colors.foregroundMuted} text={`Loaded from ${pasted.sourceLabel}'s clipboard copy; nothing is written until you stage and apply.`} /> : null}

            {draft === null ? (
              <Note color={colors.foregroundMuted} text="This host stores no document yet. Copy one from another host's cell, then paste it here, or let the plugin create its own." />
            ) : (
              <>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button theme={theme} label="Fields" active={mode === "fields"} disabled={textError !== null} onPress={() => setMode("fields")} />
                  <Button
                    theme={theme}
                    label="JSON"
                    active={mode === "json"}
                    onPress={() => {
                      setText(JSON.stringify(draft, null, 2));
                      setMode("json");
                    }}
                  />
                </View>
                {mode === "fields" ? (
                  <DocFields
                    theme={theme}
                    draft={draft}
                    maskedPaths={doc.maskedPaths}
                    unresolvedPaths={preview?.entries.filter((entry) => entry.kind === "unresolved").map((entry) => entry.path) ?? []}
                    onChange={setDraft}
                  />
                ) : (
                  <View style={{ gap: 4 }}>
                    <TextInput
                      value={text}
                      onChangeText={editText}
                      multiline
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      style={{ ...MONO, minHeight: 220, color: colors.foreground, borderColor: textError ? colors.statusDanger : colors.border, borderWidth: 1, borderRadius: 6, padding: 8, fontSize: 12, textAlignVertical: "top" }}
                    />
                    {textError ? <Note color={colors.statusDanger} text={`Invalid JSON: ${textError}`} /> : <Note color={colors.foregroundMuted} text={'Secrets read "<masked>"; keep that text to keep the stored value, replace it to set a new one.'} />}
                  </View>
                )}
                {preview ? <PreviewPanel theme={theme} preview={preview} notes={notes} /> : null}
              </>
            )}
          </>
        ) : null}

        {status.phase !== "none" ? (
          <View style={{ gap: 6, borderWidth: 1, borderColor: status.phase === "written" ? colors.statusSuccess : status.phase === "staged" || status.phase === "applying" ? colors.border : colors.statusDanger, borderRadius: 8, padding: 10 }}>
            <Note color={colors.foreground} bold text={status.message} />
            {status.keptMaskedPaths.length > 0 ? <Note color={colors.foregroundMuted} text={`Kept the host's own value at: ${status.keptMaskedPaths.join(", ")}.`} /> : null}
            {status.backedUp ? <Note color={colors.foregroundMuted} text="The previous document was backed up (Restore from backup)." /> : null}
            {status.phase === "staged" ? (
              <View style={{ flexDirection: "row" }}>
                <Button theme={theme} label="Unstage" disabled={state.applying} onPress={() => staged.doc && dispatch({ type: "unstage", id: staged.doc.item.id })} />
              </View>
            ) : null}
            {status.phase === "conflict" ? (
              <>
                <Note color={colors.foregroundMuted} text={`Current revision on the host: ${status.currentRevision?.slice(0, 8) ?? "unknown"}. "Reload and retry" keeps your edits and compares them with the new document; stage again afterwards.`} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button theme={theme} variant="primary" label="Reload and retry" onPress={() => void reload(false)} />
                  <Button theme={theme} label="Reload, discard my edits" onPress={() => void reload(true)} />
                </View>
              </>
            ) : null}
            {status.phase === "unknown" ? (
              <View style={{ flexDirection: "row" }}>
                <Button theme={theme} label="Reload document" onPress={() => void reload(true)} />
              </View>
            ) : null}
            {status.phase === "written" ? (
              <>
                <Note color={colors.foregroundMuted} text="Reloading the plugin makes it read the document. Whether it accepts the values is only visible in the plugin itself." />
                {staged.reload ? (
                  <Note color={reloadStatus.phase === "failed" ? colors.statusDanger : colors.foregroundMuted} text={staged.reload.status === "ok" ? "Plugin reloaded. Validity is still unverified from here." : staged.reload.status === "pending" ? "Reload staged. It is sent with Apply." : staged.reload.status === "applying" ? "Reloading the plugin..." : reloadStatus.message || "Reload did not finish."} />
                ) : (
                  <View style={{ flexDirection: "row" }}>
                    <Button theme={theme} variant="primary" label="Reload plugin" disabled={state.applying} onPress={stageReload} />
                  </View>
                )}
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    </DialogFrame>
  );
}
