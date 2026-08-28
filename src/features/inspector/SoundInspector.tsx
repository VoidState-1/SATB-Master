import { useEffect, useState } from "react";
import { Cable, FolderOpen } from "lucide-react";
import { CommitField } from "./CommitField";
import type { SoundInspectorProps } from "./types";
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
  const activeTrack = project.satbTracks.find(
    (track) => track.id === activeVoice,
  )!;

  const [midiConfig, setMidiConfig] = useState<MidiOutputConfig>(() =>
    midiOutputManager.getConfig(),
  );
  const [midiDevices, setMidiDevices] = useState<readonly MidiOutputDeviceInfo[]>(
    () => midiOutputManager.getDevices(),
  );

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
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            <input
              type="checkbox"
              checked={midiConfig.enabled}
              onChange={(e) =>
                midiOutputManager.updateConfig({ enabled: e.target.checked })
              }
            />
            {midiConfig.enabled ? "已开启" : "未开启"}
          </label>
        </header>
        {midiConfig.enabled ? (
          <div
            style={{
              fontSize: 11,
              color: "#5b5f56",
              display: "grid",
              gap: 4,
              marginTop: 4,
            }}
          >
            <div>
              目标设备：
              <strong style={{ color: "#252822" }}>
                {currentDevice?.name ?? "未选择端口"}
              </strong>
            </div>
            <div style={{ color: "#74786f" }}>
              路由：
              {midiConfig.channelMode === "track-channel"
                ? "多通道分轨 (S1/A2/T3/B4)"
                : "单通道合并 (Ch1)"}
              {midiConfig.muteInternalSynth ? " · 已静音内置音色" : ""}
            </div>
            {onOpenMidiOut ? (
              <button
                type="button"
                className="command-button"
                style={{ marginTop: 4, width: "100%", justifyContent: "center" }}
                onClick={onOpenMidiOut}
              >
                配置 MIDI 输出...
              </button>
            ) : null}
          </div>
        ) : (
          <small style={{ color: "#8c9085", fontSize: 11 }}>
            关闭。可在工具栏中开启与配置 MIDI 输出端口。
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
