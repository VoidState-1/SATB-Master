import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { RotateCcw, Search, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import {
  SHORTCUT_DEFINITIONS,
  SHORTCUT_GROUPS,
  formatShortcutBinding,
  keyboardEventToBinding,
  type ShortcutBindings,
  type ShortcutCommandId,
} from "../../shortcuts/shortcutRegistry";

export interface ShortcutSettingsPaneProps {
  bindings: ShortcutBindings;
  onSetBinding(commandId: ShortcutCommandId, binding: string): void;
  onClearBinding(commandId: ShortcutCommandId): void;
  onResetBinding(commandId: ShortcutCommandId): void;
  onResetAll(): void;
  searchRef?: RefObject<HTMLInputElement | null>;
}

function sameBindings(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((binding, index) => binding === right[index])
  );
}

export function ShortcutSettingsPane({
  bindings,
  onSetBinding,
  onClearBinding,
  onResetBinding,
  onResetAll,
  searchRef,
}: ShortcutSettingsPaneProps) {
  const internalSearchRef = useRef<HTMLInputElement>(null);
  const shortcutSearchRef = searchRef ?? internalSearchRef;
  const [query, setQuery] = useState("");
  const [capturing, setCapturing] = useState<ShortcutCommandId>();
  const [captureError, setCaptureError] = useState<string>();

  useEffect(() => {
    if (!capturing) return;
    const handleCapture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const binding = keyboardEventToBinding(event);
      if (!binding) return;
      if (binding === "Escape") {
        setCapturing(undefined);
        setCaptureError(undefined);
        return;
      }
      const conflict = SHORTCUT_DEFINITIONS.find(
        (definition) =>
          definition.id !== capturing &&
          bindings[definition.id].includes(binding),
      );
      if (conflict) {
        setCaptureError(
          `“${formatShortcutBinding(binding)}”已用于“${conflict.label}”`,
        );
        return;
      }
      onSetBinding(capturing, binding);
      setCapturing(undefined);
      setCaptureError(undefined);
    };
    window.addEventListener("keydown", handleCapture, true);
    return () => window.removeEventListener("keydown", handleCapture, true);
  }, [bindings, capturing, onSetBinding]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const definitions = useMemo(
    () =>
      SHORTCUT_DEFINITIONS.filter((definition) => {
        if (!normalizedQuery) return true;
        const bindingText = bindings[definition.id]
          .map(formatShortcutBinding)
          .join(" ");
        return `${definition.label} ${bindingText}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      }),
    [bindings, normalizedQuery],
  );

  return (
    <div className="shortcut-settings-content">
      <div className="shortcut-settings-toolbar">
        <label className="settings-search">
          <Search aria-hidden="true" />
          <input
            ref={shortcutSearchRef}
            type="search"
            value={query}
            placeholder="搜索命令或按键"
            aria-label="搜索快捷键"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="button" className="command-button" onClick={onResetAll}>
          <RotateCcw aria-hidden="true" />
          恢复默认
        </button>
      </div>
      {captureError ? (
        <div className="shortcut-capture-error" role="alert">
          {captureError}
        </div>
      ) : null}
      <div className="shortcut-groups">
        {SHORTCUT_GROUPS.map((group) => {
          const groupDefinitions = definitions.filter(
            (definition) => definition.group === group.id,
          );
          if (groupDefinitions.length === 0) return null;
          return (
            <section className="shortcut-group" key={group.id}>
              <h3>{group.label}</h3>
              {groupDefinitions.map((definition) => {
                const commandBindings = bindings[definition.id];
                const isCapturing = capturing === definition.id;
                const isDefault = sameBindings(
                  commandBindings,
                  definition.defaultBindings,
                );
                return (
                  <div className="shortcut-row" key={definition.id}>
                    <span>{definition.label}</span>
                    <button
                      type="button"
                      className={`shortcut-binding ${isCapturing ? "is-capturing" : ""}`}
                      aria-label={`修改“${definition.label}”快捷键`}
                      aria-pressed={isCapturing}
                      onClick={() => {
                        setCapturing(isCapturing ? undefined : definition.id);
                        setCaptureError(undefined);
                      }}
                    >
                      {isCapturing ? (
                        <span>等待输入</span>
                      ) : commandBindings.length > 0 ? (
                        commandBindings.map((binding) => (
                          <kbd key={binding}>
                            {formatShortcutBinding(binding)}
                          </kbd>
                        ))
                      ) : (
                        <span className="shortcut-unassigned">未设置</span>
                      )}
                    </button>
                    <IconButton
                      label={`清除“${definition.label}”快捷键`}
                      icon={<X />}
                      disabled={commandBindings.length === 0}
                      onClick={() => onClearBinding(definition.id)}
                    />
                    <IconButton
                      label={`恢复“${definition.label}”默认快捷键`}
                      icon={<RotateCcw />}
                      disabled={isDefault}
                      onClick={() => onResetBinding(definition.id)}
                    />
                  </div>
                );
              })}
            </section>
          );
        })}
        {definitions.length === 0 ? (
          <div className="settings-empty">没有匹配的命令</div>
        ) : null}
      </div>
    </div>
  );
}
