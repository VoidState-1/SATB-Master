import {
  LayoutGrid,
  LocateFixed,
  Palette,
  SlidersHorizontal,
} from "lucide-react";
import type { PausePlayheadBehavior } from "../../hooks/usePausePlayheadBehavior";
import type { ThemePreference } from "../../hooks/useTheme";

interface EditorSettingsPaneProps {
  scaleGuideEnabled: boolean;
  onSetScaleGuideEnabled(enabled: boolean): void;
  followPlayhead: boolean;
  onSetFollowPlayhead(enabled: boolean): void;
  pausePlayheadBehavior: PausePlayheadBehavior;
  onSetPausePlayheadBehavior(behavior: PausePlayheadBehavior): void;
  themePreference: ThemePreference;
  onSetThemePreference(theme: ThemePreference): void;
}

export function EditorSettingsPane({
  scaleGuideEnabled,
  onSetScaleGuideEnabled,
  followPlayhead,
  onSetFollowPlayhead,
  pausePlayheadBehavior,
  onSetPausePlayheadBehavior,
  themePreference,
  onSetThemePreference,
}: EditorSettingsPaneProps) {
  return (
    <div className="developer-settings-content">
      <section className="developer-settings-section">
        <header>
          <Palette aria-hidden="true" />
          <div>
            <h3>界面主题</h3>
            <p>
              切换浅色（暖纸）或深色（暖炭）工作台，或自动跟随操作系统外观设置。
            </p>
          </div>
          <select
            className="editor-settings-select"
            value={themePreference}
            aria-label="界面主题"
            onChange={(event) =>
              onSetThemePreference(event.target.value as ThemePreference)
            }
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色（暖纸）</option>
            <option value="dark">深色（暖炭）</option>
          </select>
        </header>
      </section>

      <section className="developer-settings-section">
        <header>
          <LayoutGrid aria-hidden="true" />
          <div>
            <h3>音阶音符指南</h3>
            <p>
              根据当前工程调号，将调内音高行高亮为浅色背景，调外音高行渲染为深色背景。
            </p>
          </div>
          <label className="developer-mode-toggle">
            <input
              type="checkbox"
              checked={scaleGuideEnabled}
              aria-label="启用音阶音符指南"
              onChange={(event) =>
                onSetScaleGuideEnabled(event.target.checked)
              }
            />
            <span>{scaleGuideEnabled ? "已开启" : "未开启"}</span>
          </label>
        </header>
      </section>

      <section className="developer-settings-section">
        <header>
          <LocateFixed aria-hidden="true" />
          <div>
            <h3>播放时画布跟随光标</h3>
            <p>
              播放过程中画布水平跟随光标滚动（边缘推拉模式），使播放头始终保持在视野范围内。
            </p>
          </div>
          <label className="developer-mode-toggle">
            <input
              type="checkbox"
              checked={followPlayhead}
              aria-label="启用播放时画布跟随光标"
              onChange={(event) =>
                onSetFollowPlayhead(event.target.checked)
              }
            />
            <span>{followPlayhead ? "已开启" : "未开启"}</span>
          </label>
        </header>
      </section>

      <section className="developer-settings-section">
        <header>
          <SlidersHorizontal aria-hidden="true" />
          <div>
            <h3>暂停后光标位置</h3>
            <p>
              控制在播放过程中暂停时，时间轴播放头光标停驻或跳转的目标位置。
            </p>
          </div>
          <select
            className="editor-settings-select"
            value={pausePlayheadBehavior}
            aria-label="暂停后光标位置"
            onChange={(event) =>
              onSetPausePlayheadBehavior(
                event.target.value as PausePlayheadBehavior,
              )
            }
          >
            <option value="current">留在原地</option>
            <option value="playback-start">回到播放开始处</option>
            <option value="loop-start">回到循环开始处</option>
          </select>
        </header>
      </section>
    </div>
  );
}
