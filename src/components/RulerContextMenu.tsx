import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Gauge,
  KeyRound,
  Music2,
} from "lucide-react";
import type { ProjectDocument } from "../domain/model";
import { formatPosition } from "../domain/time";

type TimingEventType = "tempo" | "meter" | "key";

interface RulerContextMenuProps {
  project: ProjectDocument;
  tick: number;
  measureStartTick: number;
  loopStartTick: number;
  loopEndTick: number;
  anchor: { x: number; y: number };
  onAdd(type: TimingEventType, tick: number): void;
  onSetLoopBoundary(boundary: "start" | "end", tick: number): void;
  onClose(): void;
}

export function RulerContextMenu({
  project,
  tick,
  measureStartTick,
  loopStartTick,
  loopEndTick,
  anchor,
  onAdd,
  onSetLoopBoundary,
  onClose,
}: RulerContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);
  const isMeasureStart = tick === measureStartTick;
  const tempoExists = project.tempoEvents.some((event) => event.tick === tick);
  const meterExists = project.meterEvents.some((event) => event.tick === tick);
  const keyExists = project.keyEvents.some((event) => event.tick === tick);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(
        margin,
        Math.min(anchor.x, window.innerWidth - rect.width - margin),
      ),
      y: Math.max(
        margin,
        Math.min(anchor.y, window.innerHeight - rect.height - margin),
      ),
    });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [anchor]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
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

  const run = (action: () => void) => {
    action();
    onClose();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    if (buttons.length === 0) return;
    event.preventDefault();
    const currentIndex = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1 + buttons.length) % buttons.length
            : (currentIndex - 1 + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="ruler-context-menu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label="小节轨操作"
      onKeyDown={handleMenuKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="ruler-context-position">
        {formatPosition(project, tick)}
      </div>
      <button
        type="button"
        role="menuitem"
        disabled={tempoExists}
        onClick={() => run(() => onAdd("tempo", tick))}
      >
        <Gauge />
        <span>{tempoExists ? "已有速度变化" : "添加速度变化"}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!isMeasureStart || meterExists}
        title={!isMeasureStart ? "拍号变化只能位于小节起点" : undefined}
        onClick={() => run(() => onAdd("meter", tick))}
      >
        <Music2 />
        <span>{meterExists ? "已有拍号变化" : "添加拍号变化"}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!isMeasureStart || keyExists}
        title={!isMeasureStart ? "调号变化只能位于小节起点" : undefined}
        onClick={() => run(() => onAdd("key", tick))}
      >
        <KeyRound />
        <span>{keyExists ? "已有调号变化" : "添加调号变化"}</span>
      </button>
      <div className="ruler-context-separator" role="separator" />
      <button
        type="button"
        role="menuitem"
        disabled={tick >= loopEndTick}
        onClick={() => run(() => onSetLoopBoundary("start", tick))}
      >
        <ChevronRight />
        <span>设为循环起点</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={tick <= loopStartTick}
        onClick={() => run(() => onSetLoopBoundary("end", tick))}
      >
        <ChevronLeft />
        <span>设为循环终点</span>
      </button>
    </div>,
    document.body,
  );
}
