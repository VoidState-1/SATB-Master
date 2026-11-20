import { chordIdentityInversion, chordIdentityToneSpellings } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, toMidi, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { compareMetricStrength, type MetricPosition } from "../../rhythm/metric";
import type { AnalysisSlice } from "../analysis";
import { soundsCompleteWrittenChord } from "../writtenNeighbors";
import { hasCompleteWrittenTertianVoicing } from "../writtenTertian";
import type { CadenceEvidence, CadenceSpanFacts } from "./types";
import { tonicBassGapFrames } from "./tonicBassGap";

const upperVoices = ["soprano", "alto", "tenor"] as const;

/** Spasobin §§37.1–2 and 14.4: a root-position V7 resolves over a tonic
 * bass that arrives before the three prepared upper-voice suspensions. */
export function tonicBassSuspensionEvidence(
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
      tonic.span.semantics?.cadenceRole || !pitchClassEquals(target.root, tonic.key.tonic) ||
      chordIdentityInversion(source) !== 0 || chordIdentityInversion(target) !== 0) return;

  const frames = tonicBassGapFrames(dominant, tonic, slices, beatTicks);
  if (!frames) return;
  const { before, suspension, landing } = frames;

  const onset = metricAt(suspension.tick);
  if (onset?.role !== "downbeat" ||
      compareMetricStrength(onset, metricAt(before.tick)) !== "stronger" ||
      compareMetricStrength(onset, metricAt(landing.tick)) !== "stronger") return;

  const prepared = VOICE_ORDER.map(voice => before.notes[voice]!);
  const bass = suspension.notes.bass!;
  const bassMotion = writtenInterval(before.notes.bass!.pitch, bass.pitch);
  const bassResolves =
    bassMotion.diatonicSteps === 3 && bassMotion.semitones === 5 ||
    bassMotion.diatonicSteps === -4 && bassMotion.semitones === -7;
  if (!soundsCompleteWrittenChord(source, prepared, before.notes.bass!) ||
      bass.nonChordToneRole || bass.startTick !== suspension.tick || bass.id !== landing.notes.bass!.id ||
      !pitchClassEquals(bass.pitch, target.bass) || !bassResolves ||
      hasCompleteWrittenTertianVoicing(VOICE_ORDER.map(voice => suspension.notes[voice]!.pitch))) return;

  const [, leading, fifth, seventh] = chordIdentityToneSpellings(source);
  const [root, third] = chordIdentityToneSpellings(target);
  const bassMidi = toMidi(bass.pitch);
  const topMidi = toMidi(landing.notes.soprano!.pitch);
  for (const voice of upperVoices) {
    const origin = before.notes[voice]!;
    const held = suspension.notes[voice]!;
    const resolved = landing.notes[voice]!;
    if (held.id !== origin.id || toMidi(held.pitch) < bassMidi ||
        resolved.nonChordToneRole || resolved.startTick !== landing.tick ||
        origin.startTick + origin.durationTicks !== landing.tick ||
        toMidi(resolved.pitch) < bassMidi || toMidi(resolved.pitch) > topMidi) return;
    const interval = writtenInterval(origin.pitch, resolved.pitch);
    if (!isWrittenStep(interval)) return;
    if (pitchClassEquals(origin.pitch, leading)) {
      if (interval.diatonicSteps !== 1 || interval.semitones !== 1 ||
          !pitchClassEquals(resolved.pitch, root)) return;
    } else if (interval.diatonicSteps !== -1 ||
        !(pitchClassEquals(origin.pitch, fifth) && pitchClassEquals(resolved.pitch, root) ||
          pitchClassEquals(origin.pitch, seventh) && pitchClassEquals(resolved.pitch, third))) return;
  }

  return {
    code: "tonic-bass-suspension",
    value: "强拍低音先落主音，持续的属七三、五、七音在同声部解决",
    refs: [bass.id, ...upperVoices.flatMap(voice => [before.notes[voice]!.id, landing.notes[voice]!.id])],
  };
}
