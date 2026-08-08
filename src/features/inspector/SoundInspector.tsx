import { FolderOpen } from "lucide-react";
import { CommitField } from "./CommitField";
import type { SoundInspectorProps } from "./types";

export function SoundInspector({
  project,
  activeVoice,
  audioStatus,
  soundFontSize,
  soundFontLoad,
  onUpdateAudio,
  onUpdateTrack,
  onChooseSoundFont,
  onUseDefaultSoundFont,
}: SoundInspectorProps) {
  const activeTrack = project.satbTracks.find(
    (track) => track.id === activeVoice,
  )!;

  return (
    <>
      <section className="property-section soundfont-section">
        <header>SoundFont</header>
        <strong>{project.audio.soundFont.name}</strong>
        <div className="soundfont-status">
          <small>{audioStatus}</small>
          {soundFontSize && !soundFontLoad ? (
            <small>文件大小 {soundFontSize}</small>
          ) : null}
          {soundFontLoad ? (
            <>
              <progress
                max="100"
                value={soundFontLoad.percent}
                aria-label="SoundFont 加载进度"
              />
              <small>{soundFontLoad.detail}</small>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className="command-button primary"
          onClick={onChooseSoundFont}
        >
          <FolderOpen />
          选择本地 SF2
        </button>
        {project.audio.soundFont.kind === "user" ? (
          <button
            type="button"
            className="command-button"
            onClick={onUseDefaultSoundFont}
          >
            恢复默认音色
          </button>
        ) : null}
      </section>

      <section className="property-section">
        <header>主输出</header>
        <label className="stacked">
          <span>主音量 {Math.round(project.audio.masterVolume * 100)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={project.audio.masterVolume}
            onChange={(event) => onUpdateAudio(Number(event.target.value))}
          />
        </label>
      </section>

      <section className="property-section">
        <header>{activeTrack.name}音源</header>
        <label>
          <span>GM Program</span>
          <CommitField
            type="number"
            min="0"
            max="127"
            value={activeTrack.program}
            onCommit={(value) =>
              onUpdateTrack(activeVoice, { program: Number(value) })
            }
          />
        </label>
        <label className="stacked">
          <span>声像 {Math.round(activeTrack.pan * 100)}</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={activeTrack.pan}
            onChange={(event) =>
              onUpdateTrack(activeVoice, { pan: Number(event.target.value) })
            }
          />
        </label>
      </section>
    </>
  );
}
