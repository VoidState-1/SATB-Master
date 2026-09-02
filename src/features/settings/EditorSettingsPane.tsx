import { LayoutGrid, LocateFixed } from "lucide-react";
import type { PausePlayheadBehavior } from "../../hooks/usePausePlayheadBehavior";

interface EditorSettingsPaneProps {
  scaleGuideEnabled: boolean;
  onSetScaleGuideEnabled(enabled: boolean): void;
  pausePlayheadBehavior: PausePlayheadBehavior;
  onSetPausePlayheadBehavior(behavior: PausePlayheadBehavior): void;
}

export function EditorSettingsPane({
  scaleGuideEnabled,
  onSetScaleGuideEnabled,
  pausePlayheadBehavior,
  onSetPausePlayheadBehavior,
}: EditorSettingsPaneProps) {
  return (
    <div className="developer-settings-content">
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
