import { useEffect, useState } from "react";
import { Cable, FolderOpen } from "lucide-react";
import { CommitField } from "./CommitField";
import type { SoundInspectorProps } from "./types";
import { getAllPlayableTracks, resolveAuxiliaryTrackColor } from "../../domain/project";
import {
  midiOutputManager,
  type MidiOutputConfig,
  type MidiOutputDeviceInfo,
} from "../../audio/midiOutput";

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
  onOpenMidiOut,
}: SoundInspectorProps) {
  const activeTrack = getAllPlayableTracks(project).find(
    (track) => track.id === activeVoice,
  ) ?? project.satbTracks[0];

  const [midiConfig, setMidiConfig] = useState<MidiOutputConfig>(() =>
    midiOutputManager.getConfig(),
  );
  const [midiDevices, setMidiDevices] = useState<
    readonly MidiOutputDeviceInfo[]
  >(() => midiOutputManager.getDevices());

  useEffect(() => {
    const unsubConfig = midiOutputManager.onConfigChange((next) =>
      setMidiConfig(next),
    );
    const unsubDevices = midiOutputManager.onDevicesChange((next) =>
      setMidiDevices(next),
    );
    return () => {
      unsubConfig();
      unsubDevices();
    };
  }, []);

  const currentDevice = midiDevices.find(
    (d) => d.id === midiConfig.selectedDeviceId,
  );

  return (
    <>
      <section className="property-section soundfont-section">
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>SoundFont 音源</span>
          <label
            className="inspector-switch"
            title={
              !midiConfig.muteInternalSynth
                ? "点击静音内置音源"
                : "点击开启内置音源"
            }
          >
            <input
              type="checkbox"
              checked={!midiConfig.muteInternalSynth}
              onChange={(e) =>
                midiOutputManager.updateConfig({
                  muteInternalSynth: !e.target.checked,
                })
              }
            />
            <span className="inspector-switch-track">
              <span className="inspector-switch-thumb" />
            </span>
            <span className="inspector-switch-label">
              {!midiConfig.muteInternalSynth ? "已开启" : "已静音"}
            </span>
          </label>
        </header>
        <strong>{project.audio.soundFont.name}</strong>
        <div className="soundfont-status">
          {midiConfig.muteInternalSynth ? (
            <small style={{ color: "var(--warning-ink)" }}>内置音源已静音</small>
          ) : (
            <small>{audioStatus}</small>
          )}
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
        <div className="soundfont-actions">
          <button
            type="button"
            className="command-button primary"
            onClick={onChooseSoundFont}
          >
            <FolderOpen size={14} />
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
        </div>
      </section>

      <section className="property-section">
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Cable size={14} aria-hidden="true" />
            MIDI 信号输出
          </span>
          <label
            className="inspector-switch"
            title={
              midiConfig.enabled ? "点击关闭 MIDI 输出" : "点击开启 MIDI 输出"
            }
          >
            <input
              type="checkbox"
              checked={midiConfig.enabled}
              onChange={(e) =>
                midiOutputManager.updateConfig({ enabled: e.target.checked })
              }
            />
            <span className="inspector-switch-track">
              <span className="inspector-switch-thumb" />
            </span>
            <span className="inspector-switch-label">
              {midiConfig.enabled ? "已开启" : "未开启"}
            </span>
          </label>
        </header>
        {midiConfig.enabled ? (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-secondary)",
              display: "grid",
              gap: 4,
              marginTop: 4,
            }}
          >
            <div>
              目标设备：
              <strong style={{ color: "var(--text-primary)" }}>
                {currentDevice?.name ?? "未选择端口"}
              </strong>
            </div>
            <div style={{ color: "var(--text-muted)" }}>
              路由：
              {midiConfig.channelMode === "track-channel"
                ? "多通道分轨 (S1/A2/T3/B4)"
                : "单通道合并 (Ch1)"}
            </div>
            {onOpenMidiOut ? (
              <button
                type="button"
                className="command-button"
                style={{
                  marginTop: 4,
                  width: "100%",
                  justifyContent: "center",
                }}
                onClick={onOpenMidiOut}
              >
                配置 MIDI 输出...
              </button>
            ) : null}
          </div>
        ) : (
          <small style={{ color: "var(--text-muted)", fontSize: 11 }}>
            MIDI信号输出已关闭
          </small>
        )}
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
        {activeTrack.kind === "auxiliary" ? (
          <label>
            <span>声部颜色</span>
            <input
              type="color"
              value={resolveAuxiliaryTrackColor(activeTrack, project.auxiliaryTracks.indexOf(activeTrack))}
              onChange={(event) =>
                onUpdateTrack(activeTrack.id, { color: event.target.value })
              }
            />
          </label>
        ) : null}
        <label>
          <span>GM Program</span>
          <CommitField
            type="number"
            min="0"
            max="127"
            value={activeTrack.program}
            onCommit={(value) =>
              onUpdateTrack(activeTrack.id, { program: Number(value) })
            }
          />
        </label>
        {activeTrack.kind === "auxiliary" ? (
          <label className="stacked">
            <span>音量 {Math.round(activeTrack.volume * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={activeTrack.volume}
              onChange={(event) =>
                onUpdateTrack(activeTrack.id, { volume: Number(event.target.value) })
              }
            />
          </label>
        ) : null}
        <label className="stacked">
          <span>声像 {Math.round(activeTrack.pan * 100)}</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={activeTrack.pan}
            onChange={(event) =>
              onUpdateTrack(activeTrack.id, { pan: Number(event.target.value) })
            }
          />
        </label>
      </section>
    </>
  );
}
