interface PlayheadLayerProps {
  x: number;
  height: number;
}

export function PlayheadLayer({ x, height }: PlayheadLayerProps) {
  return (
    <div
      className="timeline-playhead"
      aria-hidden="true"
      style={{ left: x, height }}
    >
      <span className="timeline-playhead-head" />
    </div>
  );
}
