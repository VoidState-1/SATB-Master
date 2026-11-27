import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Cable, RefreshCw, Volume2, VolumeX, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { isMacOS } from "../../shortcuts/keyboardPlatform";
import {
  midiOutputManager,
  type MidiOutputChannelMode,
  type MidiOutputConfig,
  type MidiOutputDeviceInfo,
} from "../../audio/midiOutput";
import "./midiOut.css";

export interface MidiOutDialogProps {
  isOpen: boolean;
  onClose(): void;
}

export function MidiOutDialog({ isOpen, onClose }: MidiOutDialogProps) {
  const [config, setConfig] = useState<MidiOutputConfig>(() =>
    midiOutputManager.getConfig(),
  );
  const [devices, setDevices] = useState<readonly MidiOutputDeviceInfo[]>(() =>
    midiOutputManager.getDevices(),
  );
  const [isSupported] = useState<boolean>(() =>
    midiOutputManager.isSupported(),
  );

  useEffect(() => {
    const unsubConfig = midiOutputManager.onConfigChange((next) =>
      setConfig(next),
    );
    const unsubDevices = midiOutputManager.onDevicesChange((next) =>
      setDevices(next),
    );
    return () => {
      unsubConfig();
      unsubDevices();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleToggleEnable = (enabled: boolean) => {
    midiOutputManager.updateConfig({ enabled });
  };

  const handleDeviceChange = (deviceId: string) => {
    midiOutputManager.updateConfig({ selectedDeviceId: deviceId });
  };

  const handleChannelModeChange = (mode: MidiOutputChannelMode) => {
    midiOutputManager.updateConfig({ channelMode: mode });
  };

  const handleRefreshDevices = () => {
    void midiOutputManager.requestAccess().then(() => {
      midiOutputManager.refreshDevices();
    });
  };

  return createPortal(
    <div
      className="confirmation-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="midi-out-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="midi-out-title"
      >
        <header className="midi-out-header">
          <div className="midi-out-header-title" id="midi-out-title">
            <Cable size={17} aria-hidden="true" />
            <span>MIDI 信号输出</span>
          </div>
          <IconButton label="关闭" icon={<X />} onClick={onClose} />
        </header>

        <div className="midi-out-body">
          {!isSupported ? (
            <div className="midi-out-empty-hint">
              当前运行环境不支持 Web MIDI API，无法向外部发送实时演奏信号。
            </div>
          ) : (
            <>
              {/* 开关卡片 */}
              <div
                className={`midi-out-toggle-card ${config.enabled ? "active" : ""}`}
                onClick={() => handleToggleEnable(!config.enabled)}
              >
                <span className="midi-out-toggle-label">实时 MIDI 信号输出</span>
                <label
                  className="midi-out-toggle-status"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => handleToggleEnable(e.target.checked)}
                  />
                  <span>{config.enabled ? "已开启" : "已关闭"}</span>
                </label>
              </div>

              {/* 设备选择 */}
              <div className="midi-out-field">
                <span className="midi-out-field-label">输出端口</span>
                {devices.length > 0 ? (
                  <div className="midi-out-select-row">
                    <select
                      className="midi-out-select"
                      value={config.selectedDeviceId ?? devices[0]?.id}
                      disabled={!config.enabled}
                      onChange={(e) => handleDeviceChange(e.target.value)}
                    >
                      {devices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.name}
                          {device.manufacturer ? ` (${device.manufacturer})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="midi-out-refresh-btn"
                      title="刷新设备列表"
                      onClick={handleRefreshDevices}
                    >
                      <RefreshCw size={13} aria-hidden="true" />
                      刷新
                    </button>
                  </div>
                ) : (
                  <div className="midi-out-empty-hint">
                    {isMacOS
                      ? "未检测到可用端口。可在「音频 MIDI 设置」中启用 IAC 驱动器，或连接 USB MIDI 设备。"
                      : "未检测到可用端口（如 loopMIDI 虚拟驱动或 USB 硬件）。"}
                    <button
                      type="button"
                      className="midi-out-refresh-btn"
                      style={{ marginLeft: 8, height: 26, padding: "0 8px" }}
                      onClick={handleRefreshDevices}
                    >
                      <RefreshCw size={12} aria-hidden="true" />
                      重试
                    </button>
                  </div>
                )}
              </div>

              {/* 通道路由选项卡 */}
              <div className="midi-out-field">
                <span className="midi-out-field-label">通道路由</span>
                <div className="midi-out-tabs">
                  <button
                    type="button"
                    className={`midi-out-tab ${
                      config.channelMode === "track-channel" ? "active" : ""
                    } ${!config.enabled ? "disabled" : ""}`}
                    disabled={!config.enabled}
                    onClick={() => handleChannelModeChange("track-channel")}
                  >
                    <span className="midi-out-tab-title">多通道分轨 (推荐)</span>
                    <span className="midi-out-tab-desc">
                      S=Ch1 · A=Ch2 · T=Ch3 · B=Ch4
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`midi-out-tab ${
                      config.channelMode === "single-channel" ? "active" : ""
                    } ${!config.enabled ? "disabled" : ""}`}
                    disabled={!config.enabled}
                    onClick={() => handleChannelModeChange("single-channel")}
                  >
                    <span className="midi-out-tab-title">单通道合并</span>
                    <span className="midi-out-tab-desc">统一输出至通道 1</span>
                  </button>
                </div>
              </div>

              {/* 联动选项 */}
              <div className="midi-out-field">
                <span className="midi-out-field-label">选项</span>
                <div className="midi-out-options">
                  <label
                    className={`midi-out-option-row ${
                      !config.enabled ? "disabled" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={config.muteInternalSynth}
                      disabled={!config.enabled}
                      onChange={(e) =>
                        midiOutputManager.updateConfig({
                          muteInternalSynth: e.target.checked,
                        })
                      }
                    />
                    {config.muteInternalSynth ? (
                      <VolumeX size={14} color="#d9534f" aria-hidden="true" />
                    ) : (
                      <Volume2 size={14} color="#27715c" aria-hidden="true" />
                    )}
                    <span>静音内置音色（仅由外部宿主发声）</span>
                  </label>

                  <label
                    className={`midi-out-option-row ${
                      !config.enabled ? "disabled" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={config.sendPreview}
                      disabled={!config.enabled}
                      onChange={(e) =>
                        midiOutputManager.updateConfig({
                          sendPreview: e.target.checked,
                        })
                      }
                    />
                    <span>音符编辑与点击时实时试听</span>
                  </label>

                  <label
                    className={`midi-out-option-row ${
                      !config.enabled ? "disabled" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={config.sendProgramChange}
                      disabled={!config.enabled}
                      onChange={(e) =>
                        midiOutputManager.updateConfig({
                          sendProgramChange: e.target.checked,
                        })
                      }
                    />
                    <span>发送音色切换指令 (Program Change)</span>
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="midi-out-footer">
          <button
            type="button"
            className="midi-out-primary-btn"
            onClick={onClose}
          >
            完成
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
