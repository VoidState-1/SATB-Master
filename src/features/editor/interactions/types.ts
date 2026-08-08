import type { VoiceId } from "../../../domain/project";

export interface NoteInteraction {
  kind: "move" | "resize";
  voiceId: VoiceId;
  noteId: string;
  selectedIds: string[];
  originX: number;
  originY: number;
  startTick: number;
  durationTicks: number;
  midiNote: number;
  tickDelta: number;
  pitchDelta: number;
  nextStartTick: number;
  nextDurationTicks: number;
  nextMidiNote: number;
}

export interface MarqueeInteraction {
  kind: "marquee";
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
  append: boolean;
}

export interface DrawInteraction {
  kind: "draw";
  voiceId: VoiceId;
  midiNote: number;
  originRawTick: number;
  nextStartTick: number;
  nextDurationTicks: number;
}

export interface EraseInteraction {
  kind: "erase";
  noteIds: Set<string>;
}

export interface PanInteraction {
  kind: "pan";
  originClientX: number;
  originClientY: number;
  originScrollLeft: number;
  originScrollTop: number;
}

export type PointerInteraction =
  | NoteInteraction
  | MarqueeInteraction
  | DrawInteraction
  | EraseInteraction
  | PanInteraction;

export interface ChordDrawInteraction {
  kind: "draw";
  originRawTick: number;
  nextStartTick: number;
  nextDurationTicks: number;
}

export interface ChordMoveInteraction {
  kind: "move";
  chordId: string;
  selectedIds: string[];
  originX: number;
  tickDelta: number;
}

export interface ChordResizeInteraction {
  kind: "resize-left" | "resize-right";
  chordId: string;
  originStartTick: number;
  originDurationTicks: number;
  nextStartTick: number;
  nextDurationTicks: number;
}

export interface ChordEraseInteraction {
  kind: "erase";
  chordIds: Set<string>;
}

export interface ChordMarqueeInteraction {
  kind: "marquee";
  originX: number;
  currentX: number;
  append: boolean;
}

export interface ChordPanInteraction extends Omit<PanInteraction, "kind"> {
  kind: "pan";
}

export type ChordInteraction =
  | ChordDrawInteraction
  | ChordMoveInteraction
  | ChordResizeInteraction
  | ChordEraseInteraction
  | ChordMarqueeInteraction
  | ChordPanInteraction;
