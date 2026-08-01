import {
  QUALITY_INTERVALS,
  isSeventhChord,
  resolveChordIdentity,
} from "./chordModel";
import {
  type ChordAnalysis,
  type ChordIdentity,
  type ChordQuality,
  type ChordRegion,
  type KeyEvent,
  type ProjectDocument,
} from "./model";
import { accidentalSymbol, formatPitchClass, pitchClassValue } from "./pitch";
import { keyAtTick } from "./time";

export { QUALITY_INTERVALS, isSeventhChord } from "./chordModel";

const ROMAN_DEGREES = ["I", "II", "III", "IV", "V", "VI", "VII"];

export type ChordFunction = "tonic" | "subdominant" | "dominant" | "other";

export interface FormattedChordName {
  roman: string;
  absolute: string;
  functionLabel: string;
  spokenDescription: string;
}

export function chordRootPitchClass(analysis: ChordAnalysis, key: KeyEvent) {
  return pitchClassValue(resolveChordIdentity(analysis, key).root);
}

export function chordPitchClasses(analysis: ChordAnalysis, key: KeyEvent) {
  const identity = resolveChordIdentity(analysis, key);
  const root = pitchClassValue(identity.root);
  return QUALITY_INTERVALS[identity.quality].map(
    (interval) => (((root + interval) % 12) + 12) % 12,
  );
}

export function chordIdentityPitchClasses(identity: ChordIdentity) {
  const root = pitchClassValue(identity.root);
  return QUALITY_INTERVALS[identity.quality].map(
    (interval) => (((root + interval) % 12) + 12) % 12,
  );
}

export function chordFunction(analysis: ChordAnalysis): ChordFunction {
  if (analysis.applied && [5, 7].includes(analysis.degree)) return "dominant";
  if ([1, 3, 6].includes(analysis.degree)) return "tonic";
  if ([2, 4].includes(analysis.degree)) return "subdominant";
  if ([5, 7].includes(analysis.degree)) return "dominant";
  return "other";
}

function romanName(analysis: ChordAnalysis) {
  const uppercase = ["major", "augmented", "dominant7", "major7"].includes(
    analysis.quality,
  );
  const numeral = uppercase
    ? ROMAN_DEGREES[analysis.degree - 1]
    : ROMAN_DEGREES[analysis.degree - 1].toLowerCase();
  const qualityMark =
    analysis.quality === "augmented"
      ? "+"
      : analysis.quality === "diminished" || analysis.quality === "diminished7"
        ? "°"
        : analysis.quality === "halfDiminished7"
          ? "ø"
          : "";
  const figures = isSeventhChord(analysis.quality)
    ? ["7", "6/5", "4/3", "4/2"][analysis.inversion]
    : ["", "6", "6/4"][analysis.inversion];
  const target = analysis.applied
    ? `/${ROMAN_DEGREES[analysis.applied.targetDegree - 1]}`
    : "";
  return `${accidentalSymbol(analysis.degreeAlteration)}${numeral}${qualityMark}${figures}${target}`;
}

function absoluteName(identity: ChordIdentity) {
  const suffix: Record<ChordQuality, string> = {
    major: "",
    minor: "m",
    diminished: "°",
    augmented: "+",
    dominant7: "7",
    major7: "maj7",
    minor7: "m7",
    halfDiminished7: "ø7",
    diminished7: "°7",
  };
  const root = formatPitchClass(identity.root);
  if (
    identity.root.step === identity.bass.step &&
    identity.root.alter === identity.bass.alter
  )
    return `${root}${suffix[identity.quality]}`;
  return `${root}${suffix[identity.quality]}/${formatPitchClass(identity.bass)}`;
}

export function formatChord(
  analysis: ChordAnalysis,
  key: KeyEvent,
): FormattedChordName {
  return formatChordIdentity(resolveChordIdentity(analysis, key), analysis);
}

export function formatChordIdentity(
  identity: ChordIdentity,
  analysis?: ChordAnalysis,
): FormattedChordName {
  const roman = analysis ? romanName(analysis) : "?";
  const absolute = absoluteName(identity);
  const functionName = analysis ? chordFunction(analysis) : "other";
  const baseLabel = !analysis
    ? "未分析"
    : functionName === "tonic"
      ? "主功能"
      : functionName === "subdominant"
        ? "下属功能"
        : functionName === "dominant"
          ? "属功能"
          : "其他功能";
  const functionLabel = analysis?.applied
    ? `${baseLabel} · 指向 ${ROMAN_DEGREES[analysis.applied.targetDegree - 1]} 级`
    : baseLabel;
  return {
    roman,
    absolute,
    functionLabel,
    spokenDescription: `${roman}，${absolute}，${functionLabel}`,
  };
}

export function formatChordRegion(
  _project: ProjectDocument,
  region: ChordRegion,
) {
  return formatChordIdentity(region.identity, region.function);
}

export function chordAtTick(project: ProjectDocument, tick: number) {
  return project.chordTrack.regions.find(
    (region) =>
      region.startTick <= tick &&
      region.startTick + region.durationTicks > tick,
  );
}

export function defaultChordAnalysisAtTick(
  project: ProjectDocument,
  tick: number,
): ChordAnalysis {
  const key = keyAtTick(project.keyEvents, tick);
  return {
    degree: 1,
    degreeAlteration: 0,
    quality: key.mode === "major" ? "major" : "minor",
    inversion: 0,
    source: "manual",
  };
}

export function createChordRegion(
  project: ProjectDocument,
  startTick: number,
  durationTicks: number,
  analysis: ChordAnalysis,
  id: string,
): ChordRegion {
  const key = keyAtTick(project.keyEvents, startTick);
  return {
    id,
    startTick,
    durationTicks,
    identity: resolveChordIdentity(analysis, key),
    function: analysis,
    locked: false,
  };
}

export function updateChordFunctionIdentity(
  project: ProjectDocument,
  region: ChordRegion,
  analysis: ChordAnalysis,
) {
  return {
    ...region,
    function: analysis,
    identity: resolveChordIdentity(
      analysis,
      keyAtTick(project.keyEvents, region.startTick),
    ),
  };
}
