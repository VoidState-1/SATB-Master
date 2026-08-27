import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Download, FileMusic, X } from "lucide-react";
import type { ProjectDocument } from "../../domain/project";
import {
  DEFAULT_MIDI_EXPORT_OPTIONS,
  type MidiExportLayout,
  type MidiExportOptions,
  type MidiExportTimbre,
} from "../../domain/midi";
import "./midiExport.css";

const MIDI_EXPORT_STORAGE_KEY = "satb_master_midi_export_options";

function loadSavedOptions(): Required<MidiExportOptions> {
  try {
    const raw = localStorage.getItem(MIDI_EXPORT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        layout:
          parsed.layout === "piano-grand-staff"
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
      };
    }
  } catch {
    // Ignore fallback
  }
  return DEFAULT_MIDI_EXPORT_OPTIONS;
}

function saveOptions(options: Required<MidiExportOptions>) {
  try {
    localStorage.setItem(MIDI_EXPORT_STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Ignore
  }
}

export interface MidiExportDialogProps {
  project: ProjectDocument;
  onClose(): void;
  onExport(options: Required<MidiExportOptions>): void;
}

export function MidiExportDialog({
  project,
  onClose,
  onExport,
}: MidiExportDialogProps) {
  const [saved] = useState(loadSavedOptions);
  const [layout, setLayout] = useState<MidiExportLayout>(saved.layout);
  const [timbre, setTimbre] = useState<MidiExportTimbre>(saved.timbre);
  const [includeChords, setIncludeChords] = useState<boolean>(
    saved.includeChords,
  );

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
    const options: Required<MidiExportOptions> = {
      layout,
      timbre,
      includeChords,
    };
    saveOptions(options);
    onExport(options);
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
        className="confirmation-dialog midi-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="midi-export-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="midi-export-header">
          <h2 id="midi-export-title">
            <FileMusic aria-hidden="true" />
            导出 MIDI
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

        <form className="midi-export-form" onSubmit={handleSubmit}>
          {/* 谱表排版模式 */}
          <div className="midi-export-section">
            <span className="midi-export-section-title">谱表排版模式</span>
            <div className="midi-card-group-vertical">
              <label
                className={`midi-select-card ${layout === "satb-separate" ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="midi-export-layout"
                  value="satb-separate"
                  checked={layout === "satb-separate"}
                  onChange={() => setLayout("satb-separate")}
                />
                <div className="midi-card-title">
                  <span>四部合唱分轨（4 轨独立总谱）</span>
                </div>
                <div className="midi-card-desc">
                  女高 / 女低 / 男高（低音谱表）/ 男低（低音谱表）独立 4 行谱表，自动匹配各声部谱号。
                </div>
              </label>

              <label
                className={`midi-select-card ${layout === "piano-grand-staff" ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="midi-export-layout"
                  value="piano-grand-staff"
                  checked={layout === "piano-grand-staff"}
                  onChange={() => setLayout("piano-grand-staff")}
                />
                <div className="midi-card-title">
                  <span>钢琴大谱表（2 轨大谱表）</span>
                </div>
                <div className="midi-card-desc">
                  高音谱表（SA 向上/向下符干）与低音谱表（TB 向上/向下符干），与软件内琴谱预览一致。
                </div>
              </label>
            </div>
          </div>

          {/* 乐器音色设定 */}
          <div className="midi-export-section">
            <span className="midi-export-section-title">乐器音色</span>
            <div className="midi-card-group-grid3">
              <label
                className={`midi-select-card midi-timbre-card ${timbre === "piano" ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="midi-export-timbre"
                  value="piano"
                  checked={timbre === "piano"}
                  onChange={() => setTimbre("piano")}
                />
                <span className="midi-card-title">三角钢琴</span>
              </label>

              <label
                className={`midi-select-card midi-timbre-card ${timbre === "choir" ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="midi-export-timbre"
                  value="choir"
                  checked={timbre === "choir"}
                  onChange={() => setTimbre("choir")}
                />
                <span className="midi-card-title">合唱人声</span>
              </label>

              <label
                className={`midi-select-card midi-timbre-card ${timbre === "project" ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="midi-export-timbre"
                  value="project"
                  checked={timbre === "project"}
                  onChange={() => setTimbre("project")}
                />
                <span className="midi-card-title">工程当前音色</span>
              </label>
            </div>
          </div>

          {/* 标记与元数据 */}
          {hasChords ? (
            <div className="midi-export-section">
              <label
                className={`midi-select-card midi-checkbox-card ${includeChords ? "active" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={includeChords}
                  onChange={(event) => setIncludeChords(event.target.checked)}
                />
                <span className="midi-checkbox-indicator">
                  <Check aria-hidden="true" />
                </span>
                <span className="midi-card-title">包含功能和弦标记（MIDI Marker）</span>
              </label>
            </div>
          ) : null}

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
              导出 MIDI
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}
