import type { CSSProperties } from "react";
import { isBlackKey, noteName } from "../geometry";
import { MAX_MIDI, MIN_MIDI, ROW_HEIGHT } from "../viewport";

interface PianoKeysProps {
  height: number;
}

export function PianoKeys({ height }: PianoKeysProps) {
  return (
    <div className="piano-keys" style={{ height } as CSSProperties}>
      {Array.from(
        { length: MAX_MIDI - MIN_MIDI + 1 },
        (_, index) => MAX_MIDI - index,
      ).map((midi) => (
        <div
          key={midi}
          data-midi={midi}
          className={`piano-key ${isBlackKey(midi) ? "black" : ""}`}
          style={{ height: ROW_HEIGHT }}
        >
          {midi % 12 === 0 ? noteName(midi) : ""}
        </div>
      ))}
    </div>
  );
}
