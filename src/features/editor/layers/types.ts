import type { HarmonyDiagnostic } from "../../../domain/harmony";
import type {
  ChordRegion,
  NoteEvent,
  MusicalTrack,
} from "../../../domain/project";

export interface MeasureGuidePosition {
  startTick: number;
  x: number;
}

export interface NoteRect {
  track: MusicalTrack;
  note: NoteEvent;
  midiNote: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChordRect {
  region: ChordRegion;
  startTick: number;
  durationTicks: number;
  x: number;
  width: number;
}

export interface DiagnosticTooltipState {
  targetId: string;
  title: string;
  x: number;
  y: number;
  alignLeft: boolean;
  alignAbove: boolean;
  diagnostics: HarmonyDiagnostic[];
}
