import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

interface PanelResizeHandleProps {
  orientation: "vertical" | "horizontal";
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  direction: 1 | -1;
  onResize(value: number): void;
}

interface ResizeGesture {
  pointerId: number;
  startCoordinate: number;
  startValue: number;
}

const KEYBOARD_STEP = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function PanelResizeHandle({
  orientation,
  label,
  value,
  min,
  max,
  defaultValue,
  direction,
  onResize,
}: PanelResizeHandleProps) {
  const gestureRef = useRef<ResizeGesture | undefined>(undefined);
  const [isDragging, setIsDragging] = useState(false);
  const coordinateOf = (event: PointerEvent<HTMLDivElement>) =>
    orientation === "vertical" ? event.clientX : event.clientY;

  useEffect(() => {
    if (!isDragging) return;
    const className =
      orientation === "vertical" ? "is-resizing-columns" : "is-resizing-rows";
    document.body.classList.add(className);
    return () => document.body.classList.remove(className);
  }, [isDragging, orientation]);

  const finishGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    gestureRef.current = undefined;
    setIsDragging(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextValue: number | undefined;
    if (event.key === "Home") nextValue = min;
    else if (event.key === "End") nextValue = max;
    else {
      const coordinateDelta =
        orientation === "vertical"
          ? event.key === "ArrowLeft"
            ? -KEYBOARD_STEP
            : event.key === "ArrowRight"
              ? KEYBOARD_STEP
              : undefined
          : event.key === "ArrowUp"
            ? -KEYBOARD_STEP
            : event.key === "ArrowDown"
              ? KEYBOARD_STEP
              : undefined;
      if (coordinateDelta !== undefined)
        nextValue = value + coordinateDelta * direction;
    }
    if (nextValue === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onResize(clamp(nextValue, min, max));
  };

  return (
    <div
      className={`panel-resizer ${orientation} ${isDragging ? "is-dragging" : ""}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} 像素`}
      onDoubleClick={() => onResize(clamp(defaultValue, min, max))}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        gestureRef.current = {
          pointerId: event.pointerId,
          startCoordinate: coordinateOf(event),
          startValue: value,
        };
        setIsDragging(true);
      }}
      onPointerMove={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const delta =
          (coordinateOf(event) - gesture.startCoordinate) * direction;
        onResize(clamp(gesture.startValue + delta, min, max));
      }}
      onPointerUp={finishGesture}
      onPointerCancel={finishGesture}
      onLostPointerCapture={() => {
        gestureRef.current = undefined;
        setIsDragging(false);
      }}
    />
  );
}
