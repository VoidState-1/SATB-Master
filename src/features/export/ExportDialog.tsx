import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Download, FileMusic, Music2, X } from "lucide-react";
import { resolveAuxiliaryTrackColor, type ProjectDocument } from "../../domain/project";
import {
  DEFAULT_MIDI_EXPORT_OPTIONS,
  type MidiExportOptions,
  type MidiExportPreferences,
} from "../../domain/midi";
import {
  DEFAULT_MUSICXML_EXPORT_OPTIONS,
  type MusicXmlExportOptions,
  type MusicXmlExportPreferences,
} from "../../domain/musicxml";
import "./midiExport.css";

export type ExportFormat = "musicxml" | "midi";

const EXPORT_FORMAT_STORAGE_KEY = "satb_master_export_format";
const MIDI_EXPORT_STORAGE_KEY = "satb_master_midi_export_options";
const MUSICXML_EXPORT_STORAGE_KEY = "satb_master_musicxml_export_options";

function loadSavedFormat(): ExportFormat {
  try {
    const raw = localStorage.getItem(EXPORT_FORMAT_STORAGE_KEY);
    if (raw === "midi" || raw === "musicxml") return raw;
  } catch {
    // Ignore fallback
  }
  return "musicxml";
}

function loadSavedMidiOptions(): MidiExportPreferences {
  try {
    const raw = localStorage.getItem(MIDI_EXPORT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        layout:
          parsed.layout === "single-track"
            ? "single-track"
            : parsed.layout === "piano-grand-staff"
              ? "piano-grand-staff"
              : "satb-separate",
        timbre:
          parsed.timbre === "choir"
            ? "choir"
            : parsed.timbre === "project"
              ? "project"
              : "piano",
        includeChords:
          typeof parsed.includeChords === "boolean"
            ? parsed.includeChords
            : true,
        includeAuxiliaryTracks: parsed.includeAuxiliaryTracks !== false,
      };
    }
  } catch {
    // Ignore fallback
  }
  return DEFAULT_MIDI_EXPORT_OPTIONS;
}

function loadSavedMusicXmlOptions(): MusicXmlExportPreferences {
  try {
    const raw = localStorage.getItem(MUSICXML_EXPORT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        layout:
          parsed.layout === "single-staff"
            ? "single-staff"
            : parsed.layout === "satb-separate"
              ? "satb-separate"
              : "grand-staff",
        includeChords:
          typeof parsed.includeChords === "boolean"
            ? parsed.includeChords
            : true,
        includeRomanNumerals:
          typeof parsed.includeRomanNumerals === "boolean"
            ? parsed.includeRomanNumerals
            : true,
        includeAuxiliaryTracks: parsed.includeAuxiliaryTracks !== false,
      };
    }
  } catch {
    // Ignore fallback
  }
  return DEFAULT_MUSICXML_EXPORT_OPTIONS;
}

function saveExportPreferences(
  format: ExportFormat,
  midiOptions: MidiExportPreferences,
  musicXmlOptions: MusicXmlExportPreferences,
) {
  try {
    localStorage.setItem(EXPORT_FORMAT_STORAGE_KEY, format);
    localStorage.setItem(
      MIDI_EXPORT_STORAGE_KEY,
      JSON.stringify(midiOptions),
    );
    localStorage.setItem(
      MUSICXML_EXPORT_STORAGE_KEY,
      JSON.stringify(musicXmlOptions),
    );
  } catch {
    // Ignore
  }
}

export interface ExportDialogProps {
  project: ProjectDocument;
  onClose(): void;
  onExportMidi(options: MidiExportOptions): void;
  onExportMusicXml(options: MusicXmlExportOptions): void;
}

export function ExportDialog({
  project,
  onClose,
  onExportMidi,
  onExportMusicXml,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>(loadSavedFormat);
  const [midiOptions, setMidiOptions] = useState<MidiExportPreferences>(
    loadSavedMidiOptions,
  );
  const [musicXmlOptions, setMusicXmlOptions] =
    useState<MusicXmlExportPreferences>(loadSavedMusicXmlOptions);
  const [selectedAuxiliaryIds, setSelectedAuxiliaryIds] = useState<
    Record<ExportFormat, ReadonlySet<string>>
  >(() => {
    const allIds = new Set(project.auxiliaryTracks.map(({ id }) => id));
    return { midi: allIds, musicxml: allIds };
  });

  const auxiliaryTracks = project.auxiliaryTracks;
  const selectedIds = selectedAuxiliaryIds[format];
  const selectedTracks = auxiliaryTracks.filter(({ id }) => selectedIds.has(id));
  const includeAuxiliaryTracks = format === "musicxml"
    ? musicXmlOptions.includeAuxiliaryTracks
    : midiOptions.includeAuxiliaryTracks;

  const setIncludeAuxiliaryTracks = (checked: boolean) => {
    if (format === "musicxml") {
      setMusicXmlOptions((prev) => ({ ...prev, includeAuxiliaryTracks: checked }));
    } else {
      setMidiOptions((prev) => ({ ...prev, includeAuxiliaryTracks: checked }));
    }
  };

  const setAllAuxiliaryTracks = (checked: boolean) => {
    const ids = checked ? auxiliaryTracks.map(({ id }) => id) : [];
    setSelectedAuxiliaryIds((prev) => ({ ...prev, [format]: new Set(ids) }));
  };

  const setAuxiliaryTrack = (id: string, checked: boolean) => {
    setSelectedAuxiliaryIds((prev) => {
      const ids = new Set(prev[format]);
      if (checked) ids.add(id);
      else ids.delete(id);
      return { ...prev, [format]: ids };
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    saveExportPreferences(format, midiOptions, musicXmlOptions);
    const auxiliaryOptions = {
      includeAuxiliaryTracks: includeAuxiliaryTracks
        && (auxiliaryTracks.length === 0 || selectedTracks.length > 0),
      auxiliaryTrackIds: includeAuxiliaryTracks ? selectedTracks.map(({ id }) => id) : [],
    };
    if (format === "musicxml") {
      onExportMusicXml({ ...musicXmlOptions, ...auxiliaryOptions });
    } else {
      onExportMidi({ ...midiOptions, ...auxiliaryOptions });
    }
  };

  const hasChords = project.chordTrack.regions.length > 0;

  return createPortal(
    <div
      className="confirmation-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="confirmation-dialog midi-export-dialog export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="midi-export-header">
          <h2 id="export-dialog-title">
            <FileMusic aria-hidden="true" />
            导出乐谱与音频
          </h2>
          <button
            type="button"
            className="dialog-close-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        {/* 格式切换选项卡 */}
        <div className="export-format-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={format === "musicxml"}
            className={`export-format-tab ${format === "musicxml" ? "active" : ""}`}
            onClick={() => setFormat("musicxml")}
          >
            <Music2 size={15} />
            <span>MusicXML 乐谱 (.musicxml)</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={format === "midi"}
            className={`export-format-tab ${format === "midi" ? "active" : ""}`}
            onClick={() => setFormat("midi")}
          >
            <FileMusic size={15} />
            <span>MIDI 序列 (.mid)</span>
          </button>
        </div>

        <form className="midi-export-form" onSubmit={handleSubmit}>
          <div className="midi-export-options">
            {format === "musicxml" ? (
              <>
                {/* MusicXML 谱表排版模式 */}
                <div className="midi-export-section">
                  <span className="midi-export-section-title">谱表排版模式</span>
                  <div className="midi-card-group-grid3">
                    <button
                      type="button"
                      className={`midi-flat-card ${musicXmlOptions.layout === "single-staff" ? "active" : ""}`}
                      onClick={() =>
                        setMusicXmlOptions((prev) => ({
                          ...prev,
                          layout: "single-staff",
                        }))
                      }
                    >
                      <span>单轨模式</span>
                    </button>

                    <button
                      type="button"
                      className={`midi-flat-card ${musicXmlOptions.layout === "grand-staff" ? "active" : ""}`}
                      onClick={() =>
                        setMusicXmlOptions((prev) => ({
                          ...prev,
                          layout: "grand-staff",
                        }))
                      }
                    >
                      <span>双轨大谱表</span>
                    </button>

                    <button
                      type="button"
                      className={`midi-flat-card ${musicXmlOptions.layout === "satb-separate" ? "active" : ""}`}
                      onClick={() =>
                        setMusicXmlOptions((prev) => ({
                          ...prev,
                          layout: "satb-separate",
                        }))
                      }
                    >
                      <span>四轨分谱</span>
                    </button>
                  </div>
                </div>

                {/* MusicXML 标记与注释 */}
                {hasChords ? (
                  <div className="midi-export-section">
                    <span className="midi-export-section-title">和声标记与分析</span>
                    <div className="midi-card-group-vertical">
                      <label
                        className={`midi-flat-checkbox-card ${musicXmlOptions.includeChords ? "active" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={musicXmlOptions.includeChords}
                          onChange={(event) =>
                            setMusicXmlOptions((prev) => ({
                              ...prev,
                              includeChords: event.target.checked,
                            }))
                          }
                        />
                        <span className="midi-checkbox-indicator">
                          <Check aria-hidden="true" />
                        </span>
                        <span>包含和弦标记（如 C, G7/B）</span>
                      </label>

                      <label
                        className={`midi-flat-checkbox-card ${musicXmlOptions.includeRomanNumerals ? "active" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={musicXmlOptions.includeRomanNumerals}
                          onChange={(event) =>
                            setMusicXmlOptions((prev) => ({
                              ...prev,
                              includeRomanNumerals: event.target.checked,
                            }))
                          }
                        />
                        <span className="midi-checkbox-indicator">
                          <Check aria-hidden="true" />
                        </span>
                        <span>包含和声功能标记（如 T/D/S 或 I/V）</span>
                      </label>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {/* MIDI 谱表排版模式 */}
                <div className="midi-export-section">
                  <span className="midi-export-section-title">轨道排版模式</span>
                  <div className="midi-card-group-grid3">
                    <button
                      type="button"
                      className={`midi-flat-card ${midiOptions.layout === "single-track" ? "active" : ""}`}
                      onClick={() =>
                        setMidiOptions((prev) => ({
                          ...prev,
                          layout: "single-track",
                        }))
                      }
                    >
                      <span>单轨模式</span>
                    </button>

                    <button
                      type="button"
                      className={`midi-flat-card ${midiOptions.layout === "piano-grand-staff" ? "active" : ""}`}
                      onClick={() =>
                        setMidiOptions((prev) => ({
                          ...prev,
                          layout: "piano-grand-staff",
                        }))
                      }
                    >
                      <span>双轨大谱表</span>
                    </button>

                    <button
                      type="button"
                      className={`midi-flat-card ${midiOptions.layout === "satb-separate" ? "active" : ""}`}
                      onClick={() =>
                        setMidiOptions((prev) => ({
                          ...prev,
                          layout: "satb-separate",
                        }))
                      }
                    >
                      <span>四部合唱分轨</span>
                    </button>
                  </div>
                </div>

                {/* MIDI 乐器音色设定 */}
                <div className="midi-export-section">
                  <span className="midi-export-section-title">乐器音色</span>
                  <div className="midi-card-group-grid3">
                    <button
                      type="button"
                      className={`midi-flat-card ${midiOptions.timbre === "piano" ? "active" : ""}`}
                      onClick={() =>
                        setMidiOptions((prev) => ({
                          ...prev,
                          timbre: "piano",
                        }))
                      }
                    >
                      <span>三角钢琴</span>
                    </button>

                    <button
                      type="button"
                      className={`midi-flat-card ${midiOptions.timbre === "choir" ? "active" : ""}`}
                      onClick={() =>
                        setMidiOptions((prev) => ({
                          ...prev,
                          timbre: "choir",
                        }))
                      }
                    >
                      <span>合唱人声</span>
                    </button>

                    <button
                      type="button"
                      className={`midi-flat-card ${midiOptions.timbre === "project" ? "active" : ""}`}
                      onClick={() =>
                        setMidiOptions((prev) => ({
                          ...prev,
                          timbre: "project",
                        }))
                      }
                    >
                      <span>工程当前音色</span>
                    </button>
                  </div>
                </div>

                {/* MIDI 标记与元数据 */}
                {hasChords ? (
                  <div className="midi-export-section">
                    <label
                      className={`midi-flat-checkbox-card ${midiOptions.includeChords ? "active" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={midiOptions.includeChords}
                        onChange={(event) =>
                          setMidiOptions((prev) => ({
                            ...prev,
                            includeChords: event.target.checked,
                          }))
                        }
                      />
                      <span className="midi-checkbox-indicator">
                        <Check aria-hidden="true" />
                      </span>
                      <span>包含功能和弦标记（MIDI Marker）</span>
                    </label>
                  </div>
                ) : null}
              </>
            )}

            {auxiliaryTracks.length > 0 && (
              <section className="midi-export-section" aria-labelledby="export-auxiliary-title">
                <span className="midi-export-section-title" id="export-auxiliary-title">
                  额外声部
                </span>
                <div className="export-auxiliary-controls">
                  <label className={`midi-flat-checkbox-card ${includeAuxiliaryTracks ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={includeAuxiliaryTracks}
                      onChange={(event) => setIncludeAuxiliaryTracks(event.target.checked)}
                    />
                    <span className="midi-checkbox-indicator" aria-hidden="true">
                      <Check />
                    </span>
                    <span>包含额外声部</span>
                  </label>
                  {includeAuxiliaryTracks && (
                    <div className="export-auxiliary-actions">
                      <button
                        type="button"
                        disabled={selectedTracks.length === auxiliaryTracks.length}
                        onClick={() => setAllAuxiliaryTracks(true)}
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        disabled={selectedTracks.length === 0}
                        onClick={() => setAllAuxiliaryTracks(false)}
                      >
                        取消全选
                      </button>
                    </div>
                  )}
                </div>
                {includeAuxiliaryTracks && (
                  <div className="export-auxiliary-list">
                    {auxiliaryTracks.map((track, index) => (
                      <label className="export-auxiliary-row" key={track.id}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(track.id)}
                          onChange={(event) => setAuxiliaryTrack(track.id, event.target.checked)}
                        />
                        <span
                          className="export-auxiliary-swatch"
                          aria-hidden="true"
                          style={{ backgroundColor: resolveAuxiliaryTrackColor(track, index) }}
                        />
                        <span className="export-auxiliary-name" title={track.name}>{track.name}</span>
                        <span className="export-auxiliary-count">{track.notes.length} 个音符</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          <div className="confirmation-actions">
            <button
              type="button"
              className="command-button"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="command-button primary"
              autoFocus
            >
              <Download aria-hidden="true" />
              {format === "musicxml" ? "导出 MusicXML 乐谱" : "导出 MIDI"}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}

// 维持对旧命名引用的兼容
export const MidiExportDialog = ExportDialog;
export type MidiExportDialogProps = ExportDialogProps;
