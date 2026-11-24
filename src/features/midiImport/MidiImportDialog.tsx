import { Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { MidiImportApplyOptions, ParsedMidiFile } from "../../domain/midiImport";
import { formatPitchClass, formatSpelledPitch, spellMidi } from "../../domain/pitch";
import { getAllPlayableTracks, type ProjectDocument } from "../../domain/project";
import { formatPosition } from "../../domain/time";
import "./midiImport.css";

interface MidiImportDialogProps {
  parsed: ParsedMidiFile;
  project: ProjectDocument;
  playheadTick: number;
  onClose(): void;
  onConfirm(options: MidiImportApplyOptions): void;
}

export function MidiImportDialog({
  parsed,
  project,
  playheadTick,
  onClose,
  onConfirm,
}: MidiImportDialogProps) {
  const { tracks } = parsed;
  const melodicTracks = tracks.filter(({ isPercussion }) => !isPercussion);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(
    () => new Set((melodicTracks.length ? melodicTracks : tracks).map(({ key }) => key)),
  );
  const [applyTimingEvents, setApplyTimingEvents] = useState(
    () => project.chordTrack.regions.length === 0
      && getAllPlayableTracks(project).every(({ notes }) => notes.length === 0),
  );
  const [showInScorePreview, setShowInScorePreview] = useState(false);
  const [startAtPlayhead, setStartAtPlayhead] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const selectedTracks = tracks.filter(({ key }) => selectedKeys.has(key));
  const selectedNoteCount = selectedTracks.reduce((count, track) => count + track.noteCount, 0);
  const totalNoteCount = tracks.reduce((count, track) => count + track.noteCount, 0);
  const tempo = parsed.tempoEvents.find(({ tick }) => tick === 0);
  const meter = parsed.meterEvents.find(({ tick }) => tick === 0);
  const keySignature = parsed.keyEvents.find(({ tick }) => tick === 0);
  const insertionTick = Math.round(playheadTick);

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  function containTabFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const controls = event.currentTarget.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), summary",
    );
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function selectTrack(key: string, checked: boolean) {
    setSelectedKeys((previous) => {
      const keys = new Set(previous);
      if (checked) keys.add(key);
      else keys.delete(key);
      return keys;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedTracks.length === 0) return;
    onConfirm({
      selectedTrackKeys: selectedTracks.map(({ key }) => key),
      applyTimingEvents,
      showInScorePreview,
      startTickOffset: startAtPlayhead ? insertionTick : 0,
    });
  }

  return createPortal(
    <div
      className="confirmation-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="confirmation-dialog midi-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="midi-import-title"
        onKeyDown={containTabFocus}
      >
        <header className="midi-import-header">
          <h2 id="midi-import-title"><Upload aria-hidden="true" /> 导入 MIDI 到额外声部</h2>
          <button
            type="button"
            className="dialog-close-button"
            ref={closeButtonRef}
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <form className="midi-import-form" onSubmit={handleSubmit}>
          <div className="midi-import-content">
            <section className="midi-import-summary" aria-label="MIDI 文件摘要">
              <strong title={parsed.fileName}>{parsed.fileName}</strong>
              <div className="midi-import-file-meta">
                <span>{parsed.sourceTrackCount} 条源轨道</span>
                <span>{totalNoteCount} 个音符</span>
                {tempo && <span>初始速度 {tempo.bpm} BPM</span>}
                {meter && <span>初始拍号 {meter.numerator}/{meter.denominator}</span>}
                {keySignature && (
                  <span>
                    初始调号 {formatPitchClass(keySignature.tonic)} {keySignature.mode === "major" ? "大调" : "小调"}
                  </span>
                )}
              </div>
            </section>

            {parsed.warnings.length > 0 && (
              <details className="midi-import-warnings">
                <summary>{parsed.warnings.length} 条 MIDI 解析提示</summary>
                <ul>{parsed.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
              </details>
            )}

            <section className="midi-import-section" aria-labelledby="midi-import-tracks-title">
              <div className="midi-import-track-heading">
                <h3 id="midi-import-tracks-title">选择轨道</h3>
                <span role="status">已选 {selectedTracks.length}/{tracks.length} 轨 · {selectedNoteCount} 个音符</span>
              </div>
              <div className="midi-import-track-actions">
                <button
                  type="button"
                  className="command-button"
                  disabled={selectedTracks.length === tracks.length}
                  onClick={() => setSelectedKeys(new Set(tracks.map(({ key }) => key)))}
                >
                  全选
                </button>
                {melodicTracks.length > 0 && melodicTracks.length < tracks.length && (
                  <button
                    type="button"
                    className="command-button"
                    disabled={selectedTracks.length === melodicTracks.length
                      && melodicTracks.every(({ key }) => selectedKeys.has(key))}
                    onClick={() => setSelectedKeys(new Set(melodicTracks.map(({ key }) => key)))}
                  >
                    仅旋律轨
                  </button>
                )}
                <button
                  type="button"
                  className="command-button"
                  disabled={selectedTracks.length === 0}
                  onClick={() => setSelectedKeys(new Set())}
                >
                  取消全选
                </button>
              </div>
              <div className="midi-import-track-list">
                {tracks.map((track) => (
                  <label className="midi-import-track-row" key={track.key}>
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(track.key)}
                      onChange={(event) => selectTrack(track.key, event.target.checked)}
                    />
                    <span className="midi-import-track-name" title={track.name}>{track.name}</span>
                    <span className="midi-import-track-meta">
                      <span>{track.noteCount} 个音符</span>
                      <span>
                        {track.isPercussion
                          ? `打击乐 (Ch ${track.channel + 1})`
                          : `${formatSpelledPitch(spellMidi(track.minMidi, keySignature))}–${formatSpelledPitch(spellMidi(track.maxMidi, keySignature))}`}
                      </span>
                      {track.hasPolyphony && <span>复音</span>}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="midi-import-section" aria-labelledby="midi-import-options-title">
              <h3 id="midi-import-options-title">导入选项</h3>
              <label className="midi-import-option">
                <input
                  type="checkbox"
                  checked={applyTimingEvents}
                  onChange={(event) => setApplyTimingEvents(event.target.checked)}
                  aria-describedby="midi-import-timing-hint"
                />
                <span>应用 MIDI 的速度、拍号与调号</span>
              </label>
              <small className="midi-import-hint" id="midi-import-timing-hint">不会改动 SATB 声部音符</small>
              <label className="midi-import-option">
                <input
                  type="checkbox"
                  checked={showInScorePreview}
                  onChange={(event) => setShowInScorePreview(event.target.checked)}
                />
                <span>同时在五线谱预览中显示导入的额外声部</span>
              </label>
              <fieldset className="midi-import-position">
                <legend>插入位置</legend>
                <label className="midi-import-option">
                  <input
                    type="radio"
                    name="midi-import-position"
                    checked={!startAtPlayhead}
                    onChange={() => setStartAtPlayhead(false)}
                  />
                  <span>从工程起点（第 1 小节）</span>
                </label>
                <label className="midi-import-option">
                  <input
                    type="radio"
                    name="midi-import-position"
                    checked={startAtPlayhead}
                    onChange={() => setStartAtPlayhead(true)}
                    aria-describedby="midi-import-playhead-hint"
                  />
                  <span>从当前播放头位置</span>
                  <small id="midi-import-playhead-hint">{formatPosition(project, insertionTick)}</small>
                </label>
              </fieldset>
            </section>
          </div>

          <div className="confirmation-actions midi-import-actions">
            <button type="button" className="command-button" onClick={onClose}>取消</button>
            <button type="submit" className="command-button primary" disabled={selectedTracks.length === 0}>
              <Upload aria-hidden="true" />
              导入为额外声部（{selectedTracks.length} 轨）
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}
