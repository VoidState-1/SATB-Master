import { Bug, FlaskConical } from "lucide-react";

interface DeveloperSettingsPaneProps {
  developerMode: boolean;
  onSetDeveloperMode(enabled: boolean): void;
  showRuleTestEntry: boolean;
  onSetShowRuleTestEntry(visible: boolean): void;
}

export function DeveloperSettingsPane({
  developerMode,
  onSetDeveloperMode,
  showRuleTestEntry,
  onSetShowRuleTestEntry,
}: DeveloperSettingsPaneProps) {
  return (
    <div className="developer-settings-content">
      <section className="developer-settings-section">
        <header>
          <Bug aria-hidden="true" />
          <div>
            <h3>开发者模式</h3>
            <p>
              在右侧属性面板中显示当前选中音符或和弦事件的完整数据模型字段。
            </p>
          </div>
          <label className="developer-mode-toggle">
            <input
              type="checkbox"
              checked={developerMode}
              aria-label="启用开发者模式"
              onChange={(event) => onSetDeveloperMode(event.target.checked)}
            />
            <span>{developerMode ? "已启用" : "未启用"}</span>
          </label>
        </header>
        <div className="developer-settings-note">
          <strong>调试视图为只读</strong>
          <p>
            可选字段即使尚未设置也会列出；数组和嵌套对象会展开，并可复制事件的原始
            JSON。此开关只保存在本机，不写入工程文件。
          </p>
        </div>
      </section>
      <section className="developer-settings-section">
        <header>
          <FlaskConical aria-hidden="true" />
          <div>
            <h3>显示测试工作台入口</h3>
            <p>控制主工具栏中的测试工作台入口，关闭后不会影响已保存的测试用例。</p>
          </div>
          <label className="developer-mode-toggle">
            <input
              type="checkbox"
              checked={showRuleTestEntry}
              aria-label="显示测试工作台入口"
              onChange={(event) => onSetShowRuleTestEntry(event.target.checked)}
            />
            <span>{showRuleTestEntry ? "已显示" : "已隐藏"}</span>
          </label>
        </header>
      </section>
    </div>
  );
}
