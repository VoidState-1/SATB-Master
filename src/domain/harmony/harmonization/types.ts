import type {
  CadenceAnnotation,
  ChordRegion,
  PhraseBoundary,
  ProjectDocument,
} from "../../project/types";
import type { HarmonyDiagnostic } from "../runtime";

export type HarmonizationGivenVoice = "soprano" | "bass";
export type HarmonizationStyle =
  | "classic-basic"
  | "textbook-standard"
  | "expressive-secondary";

export interface AutoHarmonizationOptions {
  givenVoice?: HarmonizationGivenVoice;
  style?: HarmonizationStyle;
  respectLockedConstraints?: boolean;
  allowPassingAndNeighborMelodies?: boolean;
  fromTick?: number;
  toTick?: number;
  maxSolutions?: number;
}

export interface HarmonizationRange {
  fromTick: number;
  toTick: number;
}

export interface HarmonizationDiagnosticSummary {
  errorCount: number;
  warningCount: number;
  suggestionCount: number;
  diagnostics: HarmonyDiagnostic[];
}

export type HarmonizationRelaxedLevel = 0 | 1 | 2;

export interface HarmonizationSolution {
  id: string;
  label: string;
  description: string;
  score: number;
  relaxedLevel: HarmonizationRelaxedLevel;
  project: ProjectDocument;
  diagnosticSummary: HarmonizationDiagnosticSummary;
  chords: ChordRegion[];
  phraseBoundaries: PhraseBoundary[];
  cadences: CadenceAnnotation[];
  warnings: string[];
  /** The source voice and half-open range needed to apply a saved solution. */
  givenVoice: HarmonizationGivenVoice;
  range: HarmonizationRange;
}

export interface AutoHarmonizationResult {
  givenVoice: HarmonizationGivenVoice;
  style: HarmonizationStyle;
  range: HarmonizationRange;
  solutions: HarmonizationSolution[];
  warnings: string[];
  elapsedMs: number;
}

export interface AutoHarmonizationApplyOptions {
  writeChords?: boolean;
  writePhrasesAndCadences?: boolean;
  respectLockedConstraints?: boolean;
}
