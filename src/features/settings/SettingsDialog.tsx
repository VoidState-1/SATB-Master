import { logger } from "../../services/logging";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Bug, Keyboard, LayoutGrid, Settings2, ShieldCheck, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { DeveloperSettingsPane } from "./DeveloperSettingsPane";
import { EditorSettingsPane } from "./EditorSettingsPane";
import { RuleSettingsPane } from "./RuleSettingsPane";
import { ShortcutSettingsPane } from "./ShortcutSettingsPane";
import type { SettingsDialogProps } from "./types";

export type { SettingsDialogProps } from "./types";

type SettingsTab = "editor" | "shortcuts" | "rules" | "developer";

export function SettingsDialog(props: SettingsDialogProps) {
  const { onClose } = props;
  const dialogRef = useRef<HTMLElement>(null);
  const shortcutSearchRef = useRef<HTMLInputElement>(null);
  const ruleSearchRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("editor");
  const selectTab = (tab: SettingsTab) => {
    if (tab === activeTab) return;
    logger.recordBreadcrumb("editor", "切换设置页面", { tab });
    setActiveTab(tab);
  };

  useEffect(() => {
    if (activeTab === "shortcuts") shortcutSearchRef.current?.focus();
    if (activeTab === "rules") ruleSearchRef.current?.focus();
  }, [activeTab]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [
      ...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ),
    ];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="settings-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="settings-header">
          <Settings2 aria-hidden="true" />
          <h2 id="settings-title">设置</h2>
          <IconButton label="关闭设置" icon={<X />} onClick={onClose} />
        </header>

        <div className="settings-layout">
          <nav className="settings-tabs" aria-label="设置分类">
            <button
              type="button"
              className={activeTab === "editor" ? "is-active" : ""}
              aria-current={activeTab === "editor" ? "page" : undefined}
              aria-label="编辑器"
              onClick={() => selectTab("editor")}
            >
              <LayoutGrid aria-hidden="true" />
              <span>编辑器</span>
            </button>
            <button
              type="button"
              className={activeTab === "shortcuts" ? "is-active" : ""}
              aria-current={activeTab === "shortcuts" ? "page" : undefined}
              aria-label="快捷键"
              onClick={() => selectTab("shortcuts")}
            >
              <Keyboard aria-hidden="true" />
              <span>快捷键</span>
            </button>
            <button
              type="button"
              className={activeTab === "rules" ? "is-active" : ""}
              aria-current={activeTab === "rules" ? "page" : undefined}
              aria-label="检查规则"
              onClick={() => selectTab("rules")}
            >
              <ShieldCheck aria-hidden="true" />
              <span>检查规则</span>
            </button>
            <button
              type="button"
              className={activeTab === "developer" ? "is-active" : ""}
              aria-current={activeTab === "developer" ? "page" : undefined}
              aria-label="开发者"
              onClick={() => selectTab("developer")}
            >
              <Bug aria-hidden="true" />
              <span>开发者</span>
            </button>
          </nav>

          {activeTab === "editor" ? (
            <EditorSettingsPane
              scaleGuideEnabled={props.scaleGuideEnabled}
              onSetScaleGuideEnabled={props.onSetScaleGuideEnabled}
              followPlayhead={props.followPlayhead}
              onSetFollowPlayhead={props.onSetFollowPlayhead}
              pausePlayheadBehavior={props.pausePlayheadBehavior}
              onSetPausePlayheadBehavior={props.onSetPausePlayheadBehavior}
            />
          ) : activeTab === "shortcuts" ? (
            <ShortcutSettingsPane
              bindings={props.bindings}
              onSetBinding={props.onSetBinding}
              onClearBinding={props.onClearBinding}
              onResetBinding={props.onResetBinding}
              onResetAll={props.onResetAll}
              searchRef={shortcutSearchRef}
            />
          ) : activeTab === "rules" ? (
            <RuleSettingsPane {...props} searchRef={ruleSearchRef} />
          ) : (
            <DeveloperSettingsPane
              developerMode={props.developerMode}
              onSetDeveloperMode={props.onSetDeveloperMode}
              showRuleTestEntry={props.showRuleTestEntry}
              onSetShowRuleTestEntry={props.onSetShowRuleTestEntry}
            />
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
