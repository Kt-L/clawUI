import React from "react";
import { DEFAULT_UI_SETTINGS, type UiSettings } from "../lib/ui-settings.ts";

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
  gatewayUrl: string;
  token: string;
  password: string;
  onGatewayUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  uiSettings: UiSettings;
  onUiSettingsChange: (next: UiSettings) => void;
  uiSettingsSchemes: Array<{ id: string; name: string; updatedAt: number }>;
  activeUiSettingsSchemeId: string;
  onApplyUiSettingsScheme: (schemeId: string) => void;
  onSaveUiSettingsScheme: (name: string) => void;
  onOverwriteUiSettingsScheme: (schemeId: string) => void;
  onDeleteUiSettingsScheme: (schemeId: string) => void;
  modelShortcutSchemes: Array<{
    slot: number;
    combo: {
      meta: boolean;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      key: string;
    };
    shortcutLabel: string;
    scheme: {
      slot: number;
      combo: {
        meta: boolean;
        ctrl: boolean;
        alt: boolean;
        shift: boolean;
        key: string;
      };
      model: string;
      thinkingLevel: string;
      updatedAt: number;
    } | null;
  }>;
  currentModelForShortcut: string;
  currentThinkingForShortcut: string;
  onSaveModelShortcutScheme: (slot: number) => void;
  onApplyModelShortcutScheme: (slot: number) => void;
  onChangeModelShortcutSchemeCombo: (
    slot: number,
    combo: {
      meta: boolean;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      key: string;
    },
  ) => void;
  onDeleteModelShortcutScheme: (slot: number) => void;
  onPreviewReplyDoneSound: (next: {
    enabled: boolean;
    volume: number;
    tone: UiSettings["playReplyDoneSoundTone"];
    source: UiSettings["playReplyDoneSoundSource"];
    customAudioDataUrl: UiSettings["playReplyDoneSoundCustomAudioDataUrl"];
  }) => void;
  agentSessionShortcutSchemes: Array<{
    slot: number;
    combo: {
      meta: boolean;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      key: string;
    };
    shortcutLabel: string;
    scheme: {
      slot: number;
      combo: {
        meta: boolean;
        ctrl: boolean;
        alt: boolean;
        shift: boolean;
        key: string;
      };
      agentId: string;
      agentLabel: string;
      updatedAt: number;
    } | null;
  }>;
  currentAgentIdForShortcut: string;
  currentAgentLabelForShortcut: string;
  onSaveAgentSessionShortcutScheme: (slot: number) => void;
  onApplyAgentSessionShortcutScheme: (slot: number) => void;
  onChangeAgentSessionShortcutSchemeCombo: (
    slot: number,
    combo: {
      meta: boolean;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      key: string;
    },
  ) => void;
  onDeleteAgentSessionShortcutScheme: (slot: number) => void;
};

type NumberFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
};

type ToggleFieldProps = {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
};

type ColorFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

const FONT_OPTIONS = [
  "Plus Jakarta Sans",
  "Space Grotesk",
  "Manrope",
  "IBM Plex Sans",
  "Inter",
  "Segoe UI",
  "Roboto",
  "Arial",
];

const BUILTIN_UI_SETTINGS_SCHEME_ID = "default";
const MAX_REPLY_DONE_CUSTOM_AUDIO_BYTES = 420 * 1024;

const TYPOGRAPHY_LAYOUT_DEFAULTS: Partial<UiSettings> = {
  fontFamily: DEFAULT_UI_SETTINGS.fontFamily,
  fontSize: DEFAULT_UI_SETTINGS.fontSize,
  lineHeight: DEFAULT_UI_SETTINGS.lineHeight,
  contentWidth: DEFAULT_UI_SETTINGS.contentWidth,
  sidebarWidth: DEFAULT_UI_SETTINGS.sidebarWidth,
  sidebarFontSize: DEFAULT_UI_SETTINGS.sidebarFontSize,
  messageGap: DEFAULT_UI_SETTINGS.messageGap,
  chatBubbleRadius: DEFAULT_UI_SETTINGS.chatBubbleRadius,
};

const CHAT_CONTROLS_DEFAULTS: Partial<UiSettings> = {
  modelBadgeScale: DEFAULT_UI_SETTINGS.modelBadgeScale,
  composerActionScale: DEFAULT_UI_SETTINGS.composerActionScale,
  footerStatsFontSize: DEFAULT_UI_SETTINGS.footerStatsFontSize,
  toolCallFontSize: DEFAULT_UI_SETTINGS.toolCallFontSize,
  autoScrollAssistantResponses: DEFAULT_UI_SETTINGS.autoScrollAssistantResponses,
  showMessageTimestamp: DEFAULT_UI_SETTINGS.showMessageTimestamp,
  messageTimestampFontSize: DEFAULT_UI_SETTINGS.messageTimestampFontSize,
  playReplyDoneSound: DEFAULT_UI_SETTINGS.playReplyDoneSound,
  playReplyDoneSoundVolume: DEFAULT_UI_SETTINGS.playReplyDoneSoundVolume,
  playReplyDoneSoundTone: DEFAULT_UI_SETTINGS.playReplyDoneSoundTone,
  playReplyDoneSoundSource: DEFAULT_UI_SETTINGS.playReplyDoneSoundSource,
  playReplyDoneSoundCustomAudioDataUrl: DEFAULT_UI_SETTINGS.playReplyDoneSoundCustomAudioDataUrl,
  playReplyDoneSoundCustomAudioName: DEFAULT_UI_SETTINGS.playReplyDoneSoundCustomAudioName,
  showToolActivity: DEFAULT_UI_SETTINGS.showToolActivity,
  enableAnimations: DEFAULT_UI_SETTINGS.enableAnimations,
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatThinkingLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "Off";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatShortcutUpdatedAt(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "recently";
  }
}

function normalizeShortcutKeyInput(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const key = normalized.slice(-1);
  return /^[a-z0-9]$/.test(key) ? key : null;
}

function normalizeShortcutEventKey(code: string, key: string): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toLowerCase();
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return code.slice(6);
  }
  return normalizeShortcutKeyInput(key);
}

const COLOR_SYSTEM_DEFAULTS: Partial<UiSettings> = {
  panelOpacity: DEFAULT_UI_SETTINGS.panelOpacity,
  backgroundPatternStrength: DEFAULT_UI_SETTINGS.backgroundPatternStrength,
  accentColor: DEFAULT_UI_SETTINGS.accentColor,
  accentSoftColor: DEFAULT_UI_SETTINGS.accentSoftColor,
  userBubbleColor: DEFAULT_UI_SETTINGS.userBubbleColor,
  assistantBubbleColor: DEFAULT_UI_SETTINGS.assistantBubbleColor,
};

const MARKDOWN_DEFAULTS: Partial<UiSettings> = {
  markdownHeadingColor: DEFAULT_UI_SETTINGS.markdownHeadingColor,
  markdownLinkColor: DEFAULT_UI_SETTINGS.markdownLinkColor,
  markdownBoldColor: DEFAULT_UI_SETTINGS.markdownBoldColor,
  markdownItalicColor: DEFAULT_UI_SETTINGS.markdownItalicColor,
  markdownCodeBg: DEFAULT_UI_SETTINGS.markdownCodeBg,
  markdownCodeText: DEFAULT_UI_SETTINGS.markdownCodeText,
  markdownQuoteBg: DEFAULT_UI_SETTINGS.markdownQuoteBg,
  markdownQuoteBorderColor: DEFAULT_UI_SETTINGS.markdownQuoteBorderColor,
};

function clampNumber(raw: string, fallback: number, min?: number, max?: number): number {
  if (!raw.trim()) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (typeof min === "number" && value < min) {
    return min;
  }
  if (typeof max === "number" && value > max) {
    return max;
  }
  return value;
}

function NumberField(props: NumberFieldProps) {
  return (
    <label className="field-block">
      <span className="field-label">
        {props.label}: {props.value}
        {props.suffix ?? ""}
      </span>
      <div className="field-inline dual-inputs">
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onChange={(e) => props.onChange(Number(e.target.value))}
          className="ui-range"
        />
        <input
          type="number"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onChange={(e) =>
            props.onChange(clampNumber(e.target.value, props.value, props.min, props.max))
          }
          className="ui-input compact"
        />
      </div>
    </label>
  );
}

function ToggleField(props: ToggleFieldProps) {
  return (
    <label className="toggle-row">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function ColorField(props: ColorFieldProps) {
  const swatchValue = /^#([0-9a-f]{6})$/i.test(props.value) ? props.value : "#4d6fa5";
  return (
    <label className="field-block">
      <span className="field-label">{props.label}</span>
      <div className="field-inline color-field-row">
        <input
          type="color"
          value={swatchValue}
          onChange={(e) => props.onChange(e.target.value)}
          className="ui-color"
        />
        <input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="ui-input compact"
          placeholder="#4d6fa5"
        />
      </div>
    </label>
  );
}

export default function SettingsModal(props: SettingsModalProps) {
  const [schemeNameDraft, setSchemeNameDraft] = React.useState("");
  const [customSoundError, setCustomSoundError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!props.open) {
      setSchemeNameDraft("");
      setCustomSoundError(null);
    }
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  const patch = (next: Partial<UiSettings>) => {
    props.onUiSettingsChange({ ...props.uiSettings, ...next });
  };

  const patchReplyDoneSound = (
    next: Partial<
      Pick<
        UiSettings,
        | "playReplyDoneSound"
        | "playReplyDoneSoundVolume"
        | "playReplyDoneSoundTone"
        | "playReplyDoneSoundSource"
        | "playReplyDoneSoundCustomAudioDataUrl"
        | "playReplyDoneSoundCustomAudioName"
      >
    >,
  ) => {
    const merged = { ...props.uiSettings, ...next };
    props.onUiSettingsChange(merged);
    props.onPreviewReplyDoneSound({
      enabled: merged.playReplyDoneSound,
      volume: merged.playReplyDoneSoundVolume,
      tone: merged.playReplyDoneSoundTone,
      source: merged.playReplyDoneSoundSource,
      customAudioDataUrl: merged.playReplyDoneSoundCustomAudioDataUrl,
    });
  };

  const handleCustomSoundChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    if (!file.type.startsWith("audio/")) {
      setCustomSoundError("Only audio files are supported.");
      return;
    }
    if (file.size > MAX_REPLY_DONE_CUSTOM_AUDIO_BYTES) {
      setCustomSoundError(`File too large. Max ${formatBytes(MAX_REPLY_DONE_CUSTOM_AUDIO_BYTES)}.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setCustomSoundError("Failed to read this file.");
    };
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result.trim() : "";
      if (!result.startsWith("data:audio/") || !result.includes(";base64,")) {
        setCustomSoundError("This file could not be used as an audio notification.");
        return;
      }
      setCustomSoundError(null);
      patchReplyDoneSound({
        playReplyDoneSoundSource: "custom",
        playReplyDoneSoundCustomAudioDataUrl: result,
        playReplyDoneSoundCustomAudioName: file.name.trim().slice(0, 120),
      });
    };
    reader.readAsDataURL(file);
  };

  const canOverwriteOrDeleteScheme = props.activeUiSettingsSchemeId !== BUILTIN_UI_SETTINGS_SCHEME_ID;
  const canSaveScheme = schemeNameDraft.trim().length > 0;
  const canSaveModelShortcutScheme = props.currentModelForShortcut.trim().length > 0;

  const handleSaveScheme = () => {
    const nextName = schemeNameDraft.trim();
    if (!nextName) {
      return;
    }
    props.onSaveUiSettingsScheme(nextName);
    setSchemeNameDraft("");
  };

  return (
    <div className="modal-backdrop">
      <div className="settings-modal">
        <header className="modal-header">
          <div>
            <h2 className="modal-title">Settings</h2>
            <p className="modal-subtitle">Gateway connection and deep UI customization.</p>
          </div>
          <div className="modal-header-actions">
            <button
              type="button"
              onClick={() => props.onApplyUiSettingsScheme(BUILTIN_UI_SETTINGS_SCHEME_ID)}
              className="ui-btn ui-btn-light"
            >
              Reset Defaults
            </button>
            <button type="button" onClick={props.onClose} className="ui-btn ui-btn-primary">
              Close
            </button>
          </div>
        </header>

        <div className="modal-body">
          <div className="settings-grid">
            <section className="setting-card setting-card-wide">
              <div className="setting-head">
                <h3 className="setting-title">Settings Schemes</h3>
              </div>
              <div className="setting-fields">
                <label className="field-block">
                  <span className="field-label">Apply saved scheme</span>
                  <select
                    value={props.activeUiSettingsSchemeId}
                    onChange={(e) => props.onApplyUiSettingsScheme(e.target.value)}
                    className="ui-input scheme-select"
                  >
                    <option value={BUILTIN_UI_SETTINGS_SCHEME_ID}>Default</option>
                    {props.uiSettingsSchemes.map((scheme) => (
                      <option key={scheme.id} value={scheme.id}>
                        {scheme.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="scheme-save-row">
                  <label className="field-block">
                    <span className="field-label">Save current settings as new scheme</span>
                    <input
                      value={schemeNameDraft}
                      onChange={(e) => setSchemeNameDraft(e.target.value)}
                      className="ui-input"
                      placeholder="e.g. Focus mode"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleSaveScheme}
                    className="ui-btn ui-btn-primary"
                    disabled={!canSaveScheme}
                  >
                    Save New
                  </button>
                </div>
                <div className="scheme-actions">
                  <button
                    type="button"
                    onClick={() => props.onOverwriteUiSettingsScheme(props.activeUiSettingsSchemeId)}
                    className="ui-btn ui-btn-light"
                    disabled={!canOverwriteOrDeleteScheme}
                  >
                    Overwrite Selected
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!canOverwriteOrDeleteScheme) {
                        return;
                      }
                      const target = props.uiSettingsSchemes.find(
                        (scheme) => scheme.id === props.activeUiSettingsSchemeId,
                      );
                      const confirmed = window.confirm(
                        `Delete settings scheme "${target?.name ?? "selected"}"?`,
                      );
                      if (confirmed) {
                        props.onDeleteUiSettingsScheme(props.activeUiSettingsSchemeId);
                      }
                    }}
                    className="ui-btn ui-btn-light"
                    disabled={!canOverwriteOrDeleteScheme}
                  >
                    Delete Selected
                  </button>
                </div>
              </div>
            </section>

            <section className="setting-card setting-card-wide">
              <div className="setting-head">
                <h3 className="setting-title">Model Shortcut Schemes</h3>
              </div>
              <div className="setting-fields">
                <div className="field-block">
                  <span className="field-label">Current model + thinking combination</span>
                  <span className="field-label shortcut-current-line">
                    {canSaveModelShortcutScheme
                      ? `${props.currentModelForShortcut} · thinking ${formatThinkingLabel(props.currentThinkingForShortcut)}`
                      : "No active model found in current session yet."}
                  </span>
                  <span className="field-label">
                    Keep up to 5 schemes. Each scheme supports Cmd/Control/Option/Shift + letter or
                    number.
                  </span>
                </div>
                <div className="shortcut-scheme-list">
                  {props.modelShortcutSchemes.map((entry) => {
                    const scheme = entry.scheme;
                    const combo = entry.combo;
                    const updateCombo = (patch: Partial<typeof combo>) => {
                      props.onChangeModelShortcutSchemeCombo(entry.slot, { ...combo, ...patch });
                    };
                    return (
                      <div key={entry.slot} className="shortcut-scheme-row">
                        <div className="shortcut-scheme-summary">
                          <div className="shortcut-scheme-top">
                            <span className="shortcut-scheme-key">{entry.shortcutLabel}</span>
                            <label className="field-inline shortcut-key-config">
                              <span className="field-label">Key</span>
                              <input
                                value={combo.key.toUpperCase()}
                                onChange={(e) => {
                                  const normalized = normalizeShortcutKeyInput(e.target.value);
                                  if (normalized) {
                                    updateCombo({ key: normalized });
                                  }
                                }}
                                onKeyDown={(e) => {
                                  const normalized = normalizeShortcutEventKey(e.code, e.key);
                                  if (!normalized) {
                                    return;
                                  }
                                  e.preventDefault();
                                  updateCombo({ key: normalized });
                                }}
                                className="ui-input compact shortcut-key-capture"
                                disabled={!scheme}
                                maxLength={1}
                                spellCheck={false}
                                autoComplete="off"
                                autoCapitalize="off"
                                title="Focus and press a letter or number key"
                                aria-label={`Shortcut key for slot ${entry.slot}`}
                              />
                            </label>
                          </div>
                          <div className="shortcut-combo-editor">
                            <label className="shortcut-modifier-toggle">
                              <input
                                type="checkbox"
                                checked={combo.meta}
                                onChange={(e) => updateCombo({ meta: e.target.checked })}
                                disabled={!scheme}
                              />
                              Cmd
                            </label>
                            <label className="shortcut-modifier-toggle">
                              <input
                                type="checkbox"
                                checked={combo.ctrl}
                                onChange={(e) => updateCombo({ ctrl: e.target.checked })}
                                disabled={!scheme}
                              />
                              Control
                            </label>
                            <label className="shortcut-modifier-toggle">
                              <input
                                type="checkbox"
                                checked={combo.alt}
                                onChange={(e) => updateCombo({ alt: e.target.checked })}
                                disabled={!scheme}
                              />
                              Option
                            </label>
                            <label className="shortcut-modifier-toggle">
                              <input
                                type="checkbox"
                                checked={combo.shift}
                                onChange={(e) => updateCombo({ shift: e.target.checked })}
                                disabled={!scheme}
                              />
                              Shift
                            </label>
                          </div>
                          {scheme ? (
                            <div className="shortcut-scheme-copy">
                              <span className="shortcut-scheme-model">{scheme.model}</span>
                              <span className="field-label">
                                Thinking: {formatThinkingLabel(scheme.thinkingLevel)} · Saved{" "}
                                {formatShortcutUpdatedAt(scheme.updatedAt)}
                              </span>
                            </div>
                          ) : (
                            <span className="field-label">No scheme saved for this slot.</span>
                          )}
                        </div>
                        <div className="scheme-actions shortcut-scheme-actions">
                          <button
                            type="button"
                            onClick={() => props.onSaveModelShortcutScheme(entry.slot)}
                            className="ui-btn ui-btn-primary"
                            disabled={!canSaveModelShortcutScheme}
                          >
                            Save Current
                          </button>
                          <button
                            type="button"
                            onClick={() => props.onApplyModelShortcutScheme(entry.slot)}
                            className="ui-btn ui-btn-light"
                            disabled={!scheme}
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            onClick={() => props.onDeleteModelShortcutScheme(entry.slot)}
                            className="ui-btn ui-btn-light"
                            disabled={!scheme}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="setting-card setting-card-wide">
              <div className="setting-head">
                <h3 className="setting-title">Agent Session Shortcuts</h3>
              </div>
              <div className="setting-fields">
                <div className="field-block">
                  <span className="field-label">Current agent</span>
                  <span className="field-label shortcut-current-line">
                    {props.currentAgentIdForShortcut
                      ? `${props.currentAgentLabelForShortcut} (${props.currentAgentIdForShortcut})`
                      : "No active agent found in current session yet."}
                  </span>
                  <span className="field-label">
                    Keep up to 5 shortcuts. Each shortcut creates a new session with the bound agent.
                    Supports Cmd/Control/Option/Shift + letter or number.
                  </span>
                </div>
                <div className="shortcut-scheme-list">
                  {props.agentSessionShortcutSchemes.map((entry) => {
                    const scheme = entry.scheme;
                    const combo = entry.combo;
                    const updateCombo = (patch: Partial<typeof combo>) => {
                      props.onChangeAgentSessionShortcutSchemeCombo(entry.slot, { ...combo, ...patch });
                    };
                    return (
                      <div key={entry.slot} className="shortcut-scheme-row">
                        <div className="shortcut-scheme-summary">
                          <div className="shortcut-scheme-top">
                            <span className="shortcut-scheme-key">{entry.shortcutLabel}</span>
                            <label className="field-inline shortcut-key-config">
                              <span className="field-label">Key</span>
                              <input
                                value={combo.key.toUpperCase()}
                                onChange={(e) => {
                                  const normalized = normalizeShortcutKeyInput(e.target.value);
                                  if (normalized) {
                                    updateCombo({ key: normalized });
                                  }
                                }}
                                onKeyDown={(e) => {
                                  const normalized = normalizeShortcutEventKey(e.code, e.key);
                                  if (!normalized) {
                                    return;
                                  }
                                  e.preventDefault();
                                  updateCombo({ key: normalized });
                                }}
                                className="ui-input compact shortcut-key-capture"
                                disabled={!scheme}
                                maxLength={1}
                                spellCheck={false}
                                autoComplete="off"
                                autoCapitalize="off"
                                title="Focus and press a letter or number key"
                                aria-label={`Agent shortcut key for slot ${entry.slot}`}
                              />
                            </label>
                          </div>
                          <div className="shortcut-combo-editor">
                            <label className="shortcut-modifier-toggle">
                              <input
                                type="checkbox"
                                checked={combo.meta}
                                onChange={(e) => updateCombo({ meta: e.target.checked })}
                                disabled={!scheme}
                              />
                              Cmd
                            </label>
                            <label className="shortcut-modifier-toggle">
                              <input
                                type="checkbox"
                                checked={combo.ctrl}
                                onChange={(e) => updateCombo({ ctrl: e.target.checked })}
                                disabled={!scheme}
                              />
                              Control
                            </label>
                            <label className="shortcut-modifier-toggle">
                              <input
                                type="checkbox"
                                checked={combo.alt}
                                onChange={(e) => updateCombo({ alt: e.target.checked })}
                                disabled={!scheme}
                              />
                              Option
                            </label>
                            <label className="shortcut-modifier-toggle">
                              <input
                                type="checkbox"
                                checked={combo.shift}
                                onChange={(e) => updateCombo({ shift: e.target.checked })}
                                disabled={!scheme}
                              />
                              Shift
                            </label>
                          </div>
                          {scheme ? (
                            <div className="shortcut-scheme-copy">
                              <span className="shortcut-scheme-model">{scheme.agentLabel}</span>
                              <span className="field-label">
                                Agent: {scheme.agentId} · Saved{" "}
                                {formatShortcutUpdatedAt(scheme.updatedAt)}
                              </span>
                            </div>
                          ) : (
                            <span className="field-label">No agent shortcut saved for this slot.</span>
                          )}
                        </div>
                        <div className="scheme-actions shortcut-scheme-actions">
                          <button
                            type="button"
                            onClick={() => props.onSaveAgentSessionShortcutScheme(entry.slot)}
                            className="ui-btn ui-btn-primary"
                            disabled={!props.currentAgentIdForShortcut}
                          >
                            Save Current
                          </button>
                          <button
                            type="button"
                            onClick={() => props.onApplyAgentSessionShortcutScheme(entry.slot)}
                            className="ui-btn ui-btn-light"
                            disabled={!scheme}
                          >
                            Create Session
                          </button>
                          <button
                            type="button"
                            onClick={() => props.onDeleteAgentSessionShortcutScheme(entry.slot)}
                            className="ui-btn ui-btn-light"
                            disabled={!scheme}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="setting-card">
              <h3 className="setting-title">Gateway</h3>
              <div className="setting-fields">
                <label className="field-block">
                  <span className="field-label">WebSocket URL</span>
                  <input
                    value={props.gatewayUrl}
                    onChange={(e) => props.onGatewayUrlChange(e.target.value)}
                    className="ui-input"
                    placeholder="ws://127.0.0.1:18789"
                  />
                </label>
                <label className="field-block">
                  <span className="field-label">Token</span>
                  <input
                    value={props.token}
                    onChange={(e) => props.onTokenChange(e.target.value)}
                    className="ui-input"
                    placeholder="gateway token"
                  />
                </label>
                <label className="field-block">
                  <span className="field-label">Password</span>
                  <input
                    value={props.password}
                    onChange={(e) => props.onPasswordChange(e.target.value)}
                    className="ui-input"
                    type="password"
                    placeholder="optional"
                  />
                </label>
              </div>
            </section>

            <section className="setting-card">
              <div className="setting-head">
                <h3 className="setting-title">Typography & Layout</h3>
                <button
                  type="button"
                  onClick={() => patch(TYPOGRAPHY_LAYOUT_DEFAULTS)}
                  className="ui-btn ui-btn-light section-reset-btn"
                >
                  Reset Section
                </button>
              </div>
              <div className="setting-fields">
                <label className="field-block">
                  <span className="field-label">Font family</span>
                  <input
                    value={props.uiSettings.fontFamily}
                    onChange={(e) => patch({ fontFamily: e.target.value.trim() || "Plus Jakarta Sans" })}
                    list="clawui-fonts"
                    className="ui-input"
                    placeholder="e.g. Plus Jakarta Sans, Inter"
                  />
                  <datalist id="clawui-fonts">
                    {FONT_OPTIONS.map((font) => (
                      <option key={font} value={font} />
                    ))}
                  </datalist>
                </label>

                <NumberField
                  label="Base font size"
                  value={props.uiSettings.fontSize}
                  min={10}
                  max={32}
                  step={1}
                  suffix="px"
                  onChange={(value) => patch({ fontSize: value })}
                />
                <NumberField
                  label="Line height"
                  value={props.uiSettings.lineHeight}
                  min={1.1}
                  max={2.8}
                  step={0.01}
                  onChange={(value) => patch({ lineHeight: value })}
                />
                <NumberField
                  label="Content width"
                  value={props.uiSettings.contentWidth}
                  min={420}
                  max={1400}
                  step={10}
                  suffix="px"
                  onChange={(value) => patch({ contentWidth: value })}
                />
                <NumberField
                  label="Sidebar width"
                  value={props.uiSettings.sidebarWidth}
                  min={220}
                  max={420}
                  step={2}
                  suffix="px"
                  onChange={(value) => patch({ sidebarWidth: value })}
                />
                <NumberField
                  label="Sidebar font size"
                  value={props.uiSettings.sidebarFontSize}
                  min={10}
                  max={18}
                  step={1}
                  suffix="px"
                  onChange={(value) => patch({ sidebarFontSize: value })}
                />
                <NumberField
                  label="Message gap"
                  value={props.uiSettings.messageGap}
                  min={8}
                  max={30}
                  step={1}
                  suffix="px"
                  onChange={(value) => patch({ messageGap: value })}
                />
                <NumberField
                  label="Bubble radius"
                  value={props.uiSettings.chatBubbleRadius}
                  min={10}
                  max={28}
                  step={1}
                  suffix="px"
                  onChange={(value) => patch({ chatBubbleRadius: value })}
                />
              </div>
            </section>

            <section className="setting-card">
              <div className="setting-head">
                <h3 className="setting-title">Chat Controls</h3>
                <button
                  type="button"
                  onClick={() => patch(CHAT_CONTROLS_DEFAULTS)}
                  className="ui-btn ui-btn-light section-reset-btn"
                >
                  Reset Section
                </button>
              </div>
              <div className="setting-fields">
                <NumberField
                  label="Model badge scale"
                  value={props.uiSettings.modelBadgeScale}
                  min={0.8}
                  max={1.8}
                  step={0.05}
                  suffix="x"
                  onChange={(value) => patch({ modelBadgeScale: value })}
                />
                <NumberField
                  label="Composer action scale"
                  value={props.uiSettings.composerActionScale}
                  min={0.8}
                  max={1.8}
                  step={0.05}
                  suffix="x"
                  onChange={(value) => patch({ composerActionScale: value })}
                />
                <NumberField
                  label="Footer stats font"
                  value={props.uiSettings.footerStatsFontSize}
                  min={10}
                  max={18}
                  step={1}
                  suffix="px"
                  onChange={(value) => patch({ footerStatsFontSize: value })}
                />
                <NumberField
                  label="Tool activity font"
                  value={props.uiSettings.toolCallFontSize}
                  min={10}
                  max={18}
                  step={1}
                  suffix="px"
                  onChange={(value) => patch({ toolCallFontSize: value })}
                />
                <NumberField
                  label="Message timestamp font"
                  value={props.uiSettings.messageTimestampFontSize}
                  min={9}
                  max={18}
                  step={1}
                  suffix="px"
                  onChange={(value) => patch({ messageTimestampFontSize: value })}
                />

                <ToggleField
                  label="Auto-scroll while assistant responds"
                  checked={props.uiSettings.autoScrollAssistantResponses}
                  onChange={(value) => patch({ autoScrollAssistantResponses: value })}
                />
                <ToggleField
                  label="Show message timestamps"
                  checked={props.uiSettings.showMessageTimestamp}
                  onChange={(value) => patch({ showMessageTimestamp: value })}
                />
                <ToggleField
                  label="Play sound when reply completes"
                  checked={props.uiSettings.playReplyDoneSound}
                  onChange={(value) => patchReplyDoneSound({ playReplyDoneSound: value })}
                />
                <NumberField
                  label="Reply done volume"
                  value={props.uiSettings.playReplyDoneSoundVolume}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  onChange={(value) => patchReplyDoneSound({ playReplyDoneSoundVolume: value })}
                />
                <label className="field-block">
                  <span className="field-label">Reply done sound source</span>
                  <select
                    value={props.uiSettings.playReplyDoneSoundSource}
                    onChange={(e) =>
                      patchReplyDoneSound({
                        playReplyDoneSoundSource: e.target.value as UiSettings["playReplyDoneSoundSource"],
                      })}
                    className="ui-input"
                  >
                    <option value="tone">Built-in tone</option>
                    <option value="custom">Custom audio file</option>
                  </select>
                </label>
                <label className="field-block">
                  <span className="field-label">
                    {props.uiSettings.playReplyDoneSoundSource === "tone"
                      ? "Reply done tone"
                      : "Fallback tone (if custom audio fails)"}
                  </span>
                  <select
                    value={props.uiSettings.playReplyDoneSoundTone}
                    onChange={(e) =>
                      patchReplyDoneSound({
                        playReplyDoneSoundTone: e.target.value as UiSettings["playReplyDoneSoundTone"],
                      })}
                    className="ui-input"
                  >
                    <option value="glass">Glass Chime</option>
                    <option value="crystal">Crystal Ping</option>
                    <option value="marimba">Marimba Tap</option>
                    <option value="bell">Warm Bell</option>
                    <option value="harp">Harp Pluck</option>
                    <option value="wood">Wood Block</option>
                    <option value="synth">Synth Pop</option>
                    <option value="orb">Orb Glow</option>
                  </select>
                </label>
                {props.uiSettings.playReplyDoneSoundSource === "custom" && (
                  <>
                    <label className="field-block">
                      <span className="field-label">
                        Upload notification audio (max {formatBytes(MAX_REPLY_DONE_CUSTOM_AUDIO_BYTES)})
                      </span>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={handleCustomSoundChange}
                        className="ui-input"
                      />
                    </label>
                    <div className="field-inline">
                      <span className="field-label">
                        {props.uiSettings.playReplyDoneSoundCustomAudioName
                          ? `Selected: ${props.uiSettings.playReplyDoneSoundCustomAudioName}`
                          : "No custom audio selected."}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomSoundError(null);
                          patchReplyDoneSound({
                            playReplyDoneSoundCustomAudioDataUrl: "",
                            playReplyDoneSoundCustomAudioName: "",
                          });
                        }}
                        className="ui-btn ui-btn-light"
                        disabled={!props.uiSettings.playReplyDoneSoundCustomAudioDataUrl}
                      >
                        Clear
                      </button>
                    </div>
                    {customSoundError && <span className="field-label">{customSoundError}</span>}
                  </>
                )}
                <ToggleField
                  label="Show tool activity panel"
                  checked={props.uiSettings.showToolActivity}
                  onChange={(value) => patch({ showToolActivity: value })}
                />
                <ToggleField
                  label="Enable UI animations"
                  checked={props.uiSettings.enableAnimations}
                  onChange={(value) => patch({ enableAnimations: value })}
                />
              </div>
            </section>

            <section className="setting-card">
              <div className="setting-head">
                <h3 className="setting-title">Color System</h3>
                <button
                  type="button"
                  onClick={() => patch(COLOR_SYSTEM_DEFAULTS)}
                  className="ui-btn ui-btn-light section-reset-btn"
                >
                  Reset Section
                </button>
              </div>
              <div className="setting-fields">
                <NumberField
                  label="Panel opacity"
                  value={props.uiSettings.panelOpacity}
                  min={75}
                  max={100}
                  step={1}
                  suffix="%"
                  onChange={(value) => patch({ panelOpacity: value })}
                />
                <NumberField
                  label="Background pattern strength"
                  value={props.uiSettings.backgroundPatternStrength}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  onChange={(value) => patch({ backgroundPatternStrength: value })}
                />

                <ColorField
                  label="Accent"
                  value={props.uiSettings.accentColor}
                  onChange={(value) => patch({ accentColor: value })}
                />
                <ColorField
                  label="Accent soft"
                  value={props.uiSettings.accentSoftColor}
                  onChange={(value) => patch({ accentSoftColor: value })}
                />
                <ColorField
                  label="User bubble"
                  value={props.uiSettings.userBubbleColor}
                  onChange={(value) => patch({ userBubbleColor: value })}
                />
                <ColorField
                  label="Assistant bubble"
                  value={props.uiSettings.assistantBubbleColor}
                  onChange={(value) => patch({ assistantBubbleColor: value })}
                />
              </div>
            </section>

            <section className="setting-card">
              <div className="setting-head">
                <h3 className="setting-title">Markdown Readability</h3>
                <button
                  type="button"
                  onClick={() => patch(MARKDOWN_DEFAULTS)}
                  className="ui-btn ui-btn-light section-reset-btn"
                >
                  Reset Section
                </button>
              </div>
              <div className="setting-fields">
                <ColorField
                  label="Heading color"
                  value={props.uiSettings.markdownHeadingColor}
                  onChange={(value) => patch({ markdownHeadingColor: value })}
                />
                <ColorField
                  label="Link color"
                  value={props.uiSettings.markdownLinkColor}
                  onChange={(value) => patch({ markdownLinkColor: value })}
                />
                <ColorField
                  label="Bold text color"
                  value={props.uiSettings.markdownBoldColor}
                  onChange={(value) => patch({ markdownBoldColor: value })}
                />
                <ColorField
                  label="Italic text color"
                  value={props.uiSettings.markdownItalicColor}
                  onChange={(value) => patch({ markdownItalicColor: value })}
                />
                <ColorField
                  label="Code background"
                  value={props.uiSettings.markdownCodeBg}
                  onChange={(value) => patch({ markdownCodeBg: value })}
                />
                <ColorField
                  label="Code text"
                  value={props.uiSettings.markdownCodeText}
                  onChange={(value) => patch({ markdownCodeText: value })}
                />
                <ColorField
                  label="Quote background"
                  value={props.uiSettings.markdownQuoteBg}
                  onChange={(value) => patch({ markdownQuoteBg: value })}
                />
                <ColorField
                  label="Quote border"
                  value={props.uiSettings.markdownQuoteBorderColor}
                  onChange={(value) => patch({ markdownQuoteBorderColor: value })}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
