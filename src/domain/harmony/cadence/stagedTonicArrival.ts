import { chordIdentityInversion, chordIdentityToneSpellings } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, spelledPitchEquals, toMidi, writtenInterval } from "../../pitch";
import { compareMetricStrength, type MetricPosition } from "../../rhythm/metric";
import type { AnalysisSlice } from "../analysis";
import { tonicBassGapFrames } from "./tonicBassGap";
import type { CadenceEvidence, CadenceSpanFacts } from "./types";
import { hasCadentialWrittenVoicing } from "./writtenCadentialVoicing";

const upperVoices = ["soprano", "alto", "tenor"] as const;

/** The tonic bass arrives before the whole chord. Written tendency tones
 * connect the short sounding slice to both harmonies (§§36.4, 42.1–2). */
export function stagedTonicArrivalEvidence(
  dominant: CadenceSpanFacts,
  tonic: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  metricAt: (tick: number) => MetricPosition | undefined,
  beatTicks: number | undefined,
): CadenceEvidence | undefined {
  const source = dominant.chord?.identity;
  const target = tonic.chord?.identity;
  if (!source || !target || !beatTicks ||
      source.structure.kind !== "tertian" || source.structure.quality !== "dominant7" ||
      source.structure.extensions.length || source.structure.alterations.length ||
      target.structure.kind !== "tertian" || target.structure.quality !== tonic.key.mode ||
      target.structure.extensions.length || target.structure.alterations.length ||
      !pitchClassEquals(target.root, tonic.key.tonic) || tonic.span.semantics?.cadenceRole ||
      chordIdentityInversion(target) !== 0) return;
  const inversion = chordIdentityInversion(source);
  if (inversion !== 0 && inversion !== 2) return;

  const frames = tonicBassGapFrames(dominant, tonic, slices, beatTicks);
  if (!frames) return;
  const { before, suspension: early, landing } = frames;
  if (!hasCadentialWrittenVoicing(before, source, inversion === 0) ||
      !hasCadentialWrittenVoicing(landing, target, false)) return;

  const earlyBass = early.notes.bass!;
  const landingBass = landing.notes.bass!;
  if (earlyBass.startTick !== early.tick ||
      (earlyBass.nonChordToneRole && earlyBass.nonChordToneRole !== "anticipation") ||
      !spelledPitchEquals(earlyBass.pitch, landingBass.pitch)) return;

  const bassMotion = writtenInterval(before.notes.bass!.pitch, earlyBass.pitch);
  const bassResolves = inversion === 0
    ? (bassMotion.diatonicSteps === 3 && bassMotion.semitones === 5) ||
      (bassMotion.diatonicSteps === -4 && bassMotion.semitones === -7)
    : bassMotion.diatonicSteps === -1 && bassMotion.semitones === -2;
  if (!bassResolves) return;

  const onset = metricAt(early.tick);
  const resolution = metricAt(landing.tick);
  const anticipates = onset?.confidence === "certain" && onset.role === "subdivision" &&
    compareMetricStrength(resolution, onset) === "stronger";
  const sustains = onset?.role === "downbeat" && earlyBass.id === landingBass.id &&
    compareMetricStrength(onset, resolution) === "stronger";
  if (!anticipates && !sustains) return;

  const [, leading, fifth, seventh] = chordIdentityToneSpellings(source);
  const tonicTones = chordIdentityToneSpellings(target);
  const [root, third] = tonicTones;
  const heldTendencies: string[] = [];

  for (const voice of upperVoices) {
    const old = before.notes[voice]!, middle = early.notes[voice]!, next = landing.notes[voice]!;
    if (toMidi(middle.pitch) < toMidi(earlyBass.pitch)) return;
    if (tonicTones.some(tone => pitchClassEquals(middle.pitch, tone))) continue;

    if (next.startTick !== landing.tick || middle.startTick + middle.durationTicks !== landing.tick) return;
    const motion = writtenInterval(middle.pitch, next.pitch);
    const isLeading = pitchClassEquals(middle.pitch, leading);
    const isSeventh = pitchClassEquals(middle.pitch, seventh);
    if (isLeading || isSeventh) {
      const resolves = isLeading
        ? pitchClassEquals(next.pitch, root) && motion.diatonicSteps === 1 && motion.semitones === 1
        : pitchClassEquals(next.pitch, third) && motion.diatonicSteps === -1 &&
          motion.semitones < 0 && isWrittenStep(motion);
      if (old.id !== middle.id || !resolves) return;
      heldTendencies.push(middle.id, next.id);
    } else if (!pitchClassEquals(middle.pitch, fifth) || !pitchClassEquals(next.pitch, root) ||
        motion.diatonicSteps !== -1 || motion.semitones >= 0 || !isWrittenStep(motion)) {
      return;
    }
  }
  // The separate three-suspension proof handles all three upper notes held unchanged.
  if (!heldTendencies.length || !upperVoices.some(voice => before.notes[voice]!.id !== early.notes[voice]!.id))
    return;

  return {
    code: "staged-tonic-arrival",
    value: "主低音先到，属和弦的持续趋向音在原声部解决后完整落主",
    refs: [earlyBass.id, ...heldTendencies],
  };
}
