import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, X } from "lucide-react";
import { type KeyMode, type ProjectDocument } from "../../../domain/model";
import {
  formatPitchClass,
  keyTonicOptions,
  serializePitchClass,
} from "../../../domain/pitch";
import { formatPosition } from "../../../domain/time";
import type { TimingMarkerGroup } from "../../../domain/timelineRuler";

type TimingEventType = "tempo" | "meter" | "key";

interface TimingMarkerPopoverProps {
  project: ProjectDocument;
  group: TimingMarkerGroup;
  anchor: { x: number; y: number };
  canAddMeterOrKey: boolean;
  onAdd(type: TimingEventType, tick: number): void;
  onUpdate(
    type: TimingEventType,
    id: string,
    patch: Record<string, string | number>,
  ): void;
  onDelete(type: TimingEventType, id: string): void;
  onClose(): void;
}

function CommitNumberInput({
  value,
  min,
  max,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    onCommit(Math.max(min, Math.min(max, parsed)));
  };

  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export function TimingMarkerPopover({
  project,
  group,
  anchor,
  canAddMeterOrKey,
  onAdd,
  onUpdate,
  onDelete,
  onClose,
}: TimingMarkerPopoverProps) {
  const popoverRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState(anchor);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      const margin = 8;
      const gap = 7;
      const rect = popover.getBoundingClientRect();
      const left = Math.max(
        margin,
        Math.min(anchor.x, window.innerWidth - rect.width - margin),
      );
      const below = anchor.y + gap;
      const top =
        below + rect.height <= window.innerHeight - margin
          ? below
          : Math.max(margin, anchor.y - rect.height - gap);
      setPosition({ x: left, y: top });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [anchor, group.key, group.meter, group.tempo]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <aside
      ref={popoverRef}
      className="timing-marker-popover"
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label="时间变化设置"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <header>
        <div>
          <strong>时间变化</strong>
          <small>{formatPosition(project, group.tick)}</small>
        </div>
        <button
          type="button"
          aria-label="关闭时间变化设置"
          title="关闭"
          onClick={onClose}
        >
          <X />
        </button>
      </header>

      <div className="timing-marker-editor-list">
        <section className="timing-marker-editor-row">
          <span>速度</span>
          {group.tempo ? (
            <>
              <CommitNumberInput
                label="速度 BPM"
                min={20}
                max={300}
                value={group.tempo.bpm}
                onCommit={(bpm) => onUpdate("tempo", group.tempo!.id, { bpm })}
              />
              <small>BPM</small>
              <button
                type="button"
                aria-label="删除速度变化"
                title="删除速度变化"
                onClick={() => onDelete("tempo", group.tempo!.id)}
              >
                <Trash2 />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="timing-marker-add"
              onClick={() => onAdd("tempo", group.tick)}
            >
              <Plus />
              添加速度
            </button>
          )}
        </section>

        <section className="timing-marker-editor-row meter">
          <span>拍号</span>
          {group.meter ? (
            <>
              <CommitNumberInput
                label="拍号分子"
                min={1}
                max={12}
                value={group.meter.numerator}
                onCommit={(numerator) =>
                  onUpdate("meter", group.meter!.id, {
                    numerator,
                    denominator: group.meter!.denominator,
                  })
                }
              />
              <select
                aria-label="拍号分母"
                value={group.meter.denominator}
                onChange={(event) =>
                  onUpdate("meter", group.meter!.id, {
                    numerator: group.meter!.numerator,
                    denominator: Number(event.target.value),
                  })
                }
              >
                {[2, 4, 8, 16].map((denominator) => (
                  <option key={denominator} value={denominator}>
                    /{denominator}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="删除拍号变化"
                title="删除拍号变化"
                onClick={() => onDelete("meter", group.meter!.id)}
              >
                <Trash2 />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="timing-marker-add"
              disabled={!canAddMeterOrKey}
              title={canAddMeterOrKey ? undefined : "拍号变化只能位于小节起点"}
              onClick={() => onAdd("meter", group.tick)}
            >
              <Plus />
              添加拍号
            </button>
          )}
        </section>

        <section className="timing-marker-editor-row key">
          <span>调号</span>
          {group.key ? (
            <>
              <select
                aria-label="调号主音"
                value={serializePitchClass(group.key.tonic)}
                onChange={(event) =>
                  onUpdate("key", group.key!.id, {
                    tonic: event.target.value,
                    mode: group.key!.mode,
                  })
                }
              >
                {keyTonicOptions(group.key.mode).map((tonic) => (
                  <option
                    key={serializePitchClass(tonic)}
                    value={serializePitchClass(tonic)}
                  >
                    {formatPitchClass(tonic)}
                  </option>
                ))}
              </select>
              <select
                aria-label="调式"
                value={group.key.mode}
                onChange={(event) =>
                  onUpdate("key", group.key!.id, {
                    tonic: serializePitchClass(group.key!.tonic),
                    mode: event.target.value as KeyMode,
                  })
                }
              >
                <option value="major">大调</option>
                <option value="minor">小调</option>
              </select>
              <button
                type="button"
                aria-label="删除调号变化"
                title="删除调号变化"
                onClick={() => onDelete("key", group.key!.id)}
              >
                <Trash2 />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="timing-marker-add"
              disabled={!canAddMeterOrKey}
              title={canAddMeterOrKey ? undefined : "调号变化只能位于小节起点"}
              onClick={() => onAdd("key", group.tick)}
            >
              <Plus />
              添加调号
            </button>
          )}
        </section>
      </div>
    </aside>,
    document.body,
  );
}
