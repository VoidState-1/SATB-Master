import {
  QUALITY_INTERVALS,
  chordDraftFromIdentity,
  isSeventhChord,
  resolveChordIdentity,
  semanticsFromChordDraft,
} from "./chordModel";
import {
  type ChordDraft,
  type ChordIdentity,
  type ChordQuality,
  type ChordRegion,
  type HarmonySemantics,
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
  functionalClassLabel: string;
  spokenDescription: string;
}

export function chordRootPitchClass(draft: ChordDraft, key: KeyEvent) {
  return pitchClassValue(resolveChordIdentity(draft, key).root);
}

export function chordPitchClasses(draft: ChordDraft, key: KeyEvent) {
  const identity = resolveChordIdentity(draft, key);
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

export function chordFunction(semantics: HarmonySemantics): ChordFunction {
  if (semantics.appliedTarget && [5, 7].includes(semantics.degree))
    return "dominant";
  if ([1, 3, 6].includes(semantics.degree)) return "tonic";
  if ([2, 4].includes(semantics.degree)) return "subdominant";
  if ([5, 7].includes(semantics.degree)) return "dominant";
  return "other";
}

function romanName(identity: ChordIdentity, semantics: HarmonySemantics) {
  const uppercase = ["major", "augmented", "dominant7", "major7"].includes(
    identity.quality,
  );
  const numeral = uppercase
    ? ROMAN_DEGREES[semantics.degree - 1]
    : ROMAN_DEGREES[semantics.degree - 1].toLowerCase();
  const qualityMark =
    identity.quality === "augmented"
      ? "+"
      : identity.quality === "diminished" ||
          identity.quality === "diminished7"
        ? "°"
        : identity.quality === "halfDiminished7"
          ? "ø"
          : "";
  const inversion = chordDraftFromIdentity(identity, semantics).inversion;
  const figures = isSeventhChord(identity.quality)
    ? ["7", "6/5", "4/3", "4/2"][inversion]
    : ["", "6", "6/4"][inversion];
  const target = semantics.appliedTarget
    ? `/${ROMAN_DEGREES[semantics.appliedTarget - 1]}`
    : "";
  return `${accidentalSymbol(semantics.degreeAlteration)}${numeral}${qualityMark}${figures}${target}`;
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
  draft: ChordDraft,
  key: KeyEvent,
): FormattedChordName {
  return formatChordIdentity(
    resolveChordIdentity(draft, key),
    semanticsFromChordDraft(draft),
  );
}

export function formatChordIdentity(
  identity: ChordIdentity,
  semantics?: HarmonySemantics,
): FormattedChordName {
  const roman = semantics ? romanName(identity, semantics) : "?";
  const absolute = absoluteName(identity);
  const functionName = semantics ? chordFunction(semantics) : "other";
  const baseLabel = !semantics
    ? "未解释"
    : functionName === "tonic"
      ? "主功能"
      : functionName === "subdominant"
        ? "下属功能"
        : functionName === "dominant"
          ? "属功能"
          : "其他功能";
  const functionalClassLabel = semantics?.appliedTarget
    ? `${baseLabel} · 指向 ${ROMAN_DEGREES[semantics.appliedTarget - 1]} 级`
    : baseLabel;
  return {
    roman,
    absolute,
    functionalClassLabel,
    spokenDescription: `${roman}，${absolute}，${functionalClassLabel}`,
  };
}

export function formatChordRegion(
  _project: ProjectDocument,
  region: ChordRegion,
) {
  return formatChordIdentity(region.identity, region.semantics);
}

export function chordAtTick(project: ProjectDocument, tick: number) {
  return project.chordTrack.regions.find(
    (region) =>
      region.startTick <= tick &&
      region.startTick + region.durationTicks > tick,
  );
}

export function defaultChordDraftAtTick(
  project: ProjectDocument,
  tick: number,
): ChordDraft {
  const key = keyAtTick(project.keyEvents, tick);
  return {
    degree: 1,
    degreeAlteration: 0,
    quality: key.mode === "major" ? "major" : "minor",
    inversion: 0,
    source: "manual",
    confidence: "certain",
  };
}

export function chordDraftFromRegion(region: ChordRegion): ChordDraft | undefined {
  return region.semantics
    ? chordDraftFromIdentity(region.identity, region.semantics)
    : undefined;
}

export function createChordRegion(
  project: ProjectDocument,
  startTick: number,
  durationTicks: number,
  draft: ChordDraft,
  id: string,
): ChordRegion {
  const key = keyAtTick(project.keyEvents, startTick);
  return {
    id,
    startTick,
    durationTicks,
    identity: resolveChordIdentity(draft, key),
    semantics: semanticsFromChordDraft(draft),
    locked: false,
  };
}

export function updateChordDraftIdentity(
  project: ProjectDocument,
  region: ChordRegion,
  draft: ChordDraft,
) {
  return {
    ...region,
    semantics: semanticsFromChordDraft(draft),
    identity: resolveChordIdentity(
      draft,
      keyAtTick(project.keyEvents, region.startTick),
    ),
  };
}
