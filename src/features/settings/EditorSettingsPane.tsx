import { LayoutGrid } from "lucide-react";

interface EditorSettingsPaneProps {
  scaleGuideEnabled: boolean;
  onSetScaleGuideEnabled(enabled: boolean): void;
}

export function EditorSettingsPane({
  scaleGuideEnabled,
  onSetScaleGuideEnabled,
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
    </div>
  );
}
