import { HEADER_HEIGHT } from "../viewport";

interface PlayheadLayerProps {
  x: number;
  height: number;
}

export function PlayheadLayer({ x, height }: PlayheadLayerProps) {
  return (
    <div
      className="roll-playhead"
      aria-hidden="true"
      style={{ left: x, top: HEADER_HEIGHT, height }}
    />
  );
}
