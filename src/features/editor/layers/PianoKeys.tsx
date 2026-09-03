import { useCallback, useRef, useState, type CSSProperties } from "react";
import { isBlackKey, noteName } from "../geometry";
import { MAX_MIDI, MIN_MIDI, ROW_HEIGHT } from "../viewport";

export interface PianoKeysProps {
  height: number;
  onPreviewNote?(midi: number): void;
  onFocus?(): void;
}

export function PianoKeys({ height, onPreviewNote, onFocus }: PianoKeysProps) {
  const [activeMidi, setActiveMidi] = useState<number | null>(null);
  const isPointerDownRef = useRef(false);

  const playNote = useCallback(
    (midi: number) => {
      setActiveMidi(midi);
      onPreviewNote?.(midi);
    },
    [onPreviewNote],
  );

  const resolveMidiFromEvent = (
    event: React.PointerEvent<HTMLDivElement>,
  ): number | null => {
    // 优先从直接点击的子元素 dataset 中获取
    const directTarget = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-midi]",
    );
    if (directTarget?.dataset.midi) {
      const midi = Number(directTarget.dataset.midi);
      if (!Number.isNaN(midi)) return midi;
    }

    // 拖动过程中从视口坐标命中元素
    if (
      typeof document !== "undefined" &&
      typeof document.elementFromPoint === "function"
    ) {
      const element = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-midi]");
      if (element?.dataset.midi) {
        const midi = Number(element.dataset.midi);
        if (!Number.isNaN(midi)) return midi;
      }
    }

    // 备用数学换算：根据相对 piano-keys 顶部的 Y 轴偏移量换算 MIDI 音高
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    if (offsetY >= 0 && offsetY <= rect.height) {
      const rowIndex = Math.floor(offsetY / ROW_HEIGHT);
      const midi = MAX_MIDI - rowIndex;
      if (midi >= MIN_MIDI && midi <= MAX_MIDI) {
        return midi;
      }
    }
    return null;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onFocus?.();
    isPointerDownRef.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 在不支持或非标准环境下忽略
    }
    const midi = resolveMidiFromEvent(event);
    if (midi !== null) {
      playNote(midi);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;
    const midi = resolveMidiFromEvent(event);
    if (midi !== null && midi !== activeMidi) {
      playNote(midi);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    setActiveMidi(null);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // 忽略
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    isPointerDownRef.current = false;
    setActiveMidi(null);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // 忽略
    }
  };

  return (
    <div
      className="piano-keys"
      style={{ height } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={() => {
        isPointerDownRef.current = false;
        setActiveMidi(null);
      }}
    >
      {Array.from(
        { length: MAX_MIDI - MIN_MIDI + 1 },
        (_, index) => MAX_MIDI - index,
      ).map((midi) => {
        const isBlack = isBlackKey(midi);
        const isActive = activeMidi === midi;
        return (
          <div
            key={midi}
            data-midi={midi}
            title={`${noteName(midi)} (MIDI ${midi})`}
            className={`piano-key ${isBlack ? "black" : ""} ${isActive ? "active" : ""}`}
            style={{ height: ROW_HEIGHT }}
          >
            {midi % 12 === 0 ? noteName(midi) : ""}
          </div>
        );
      })}
    </div>
  );
}
