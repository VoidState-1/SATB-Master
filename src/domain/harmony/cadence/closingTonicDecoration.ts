import { chordIdentityInversion, chordIdentityToneSpellings, type ChordIdentity, type ChordQuality } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { compareMetricStrength, type MetricPosition } from "../../rhythm/metric";
import type { AnalysisSlice } from "../analysis";
import { leadingToneDescendsToTonicFifth } from "../dominantSixthMotion";
import { sameKey } from "../segments";
import { resolvesInVoice } from "../writtenResolution";
import { hasCompleteWrittenTertianVoicing } from "../writtenTertian";
import { hasCadentialWrittenVoicing } from "./writtenCadentialVoicing";
import type { CadenceEvidence, CadenceSpanFacts } from "./types";

const upperVoices = ["soprano", "alto", "tenor"] as const;
const endOf = (note: { startTick: number; durationTicks: number }) => note.startTick + note.durationTicks;

function ordinaryRootChord(facts: CadenceSpanFacts, degree: 1 | 5, quality: ChordQuality) {
  const identity = facts.chord?.identity;
  const semantics = facts.span.semantics;
  return facts.degree === degree && facts.interpretationStatus === "resolved" &&
    identity?.structure.kind === "tertian" && identity.structure.quality === quality &&
    !identity.structure.extensions.length && !identity.structure.alterations.length &&
    !semantics?.cadenceRole && !semantics?.pedalContext && !semantics?.mixture &&
    pitchClassEquals(identity.root, scaleDegreePitchClass(facts.key, degree)) &&
    chordIdentityInversion(identity) === 0 ? identity : undefined;
}

function writtenArrival(before: AnalysisSlice, dominant: ChordIdentity, onset: AnalysisSlice, tonic: ChordIdentity) {
  if (!hasCadentialWrittenVoicing(before, dominant, true) ||
      !hasCadentialWrittenVoicing(onset, tonic, true) ||
      VOICE_ORDER.some(voice => onset.notes[voice]!.startTick !== onset.tick)) return false;

  const bass = writtenInterval(before.notes.bass!.pitch, onset.notes.bass!.pitch);
  if (!(bass.diatonicSteps === 3 && bass.semitones === 5 || bass.diatonicSteps === -4 && bass.semitones === -7)) return false;
  const [, leading, , seventh] = chordIdentityToneSpellings(dominant);
  const [root, third, fifth] = chordIdentityToneSpellings(tonic);
  return upperVoices.every(voice => {
    const from = before.notes[voice]!, to = onset.notes[voice]!;
    if (pitchClassEquals(from.pitch, leading)) {
      return resolvesInVoice(before, onset, voice, root, 1) ||
        (voice !== "soprano" && endOf(from) === onset.tick &&
          leadingToneDescendsToTonicFifth(from.pitch, to.pitch, leading, fifth));
    }
    return !pitchClassEquals(from.pitch, seventh) || resolvesInVoice(before, onset, voice, third, -1);
  });
}

/** A single weak cut in an already established final tonic. Keep the
 * audible arrival as the structural landing and the next tonic as release. */
export function closingTonicDecorationEvidence(
  dominant: CadenceSpanFacts,
  arrival: CadenceSpanFacts,
  terminal: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  metricAt: (tick: number) => MetricPosition | undefined,
  beatTicks: number,
): CadenceEvidence | undefined {
  if (!arrival.isTonic || !terminal.isTonic || terminal.key.mode !== arrival.key.mode ||
      !pitchClassEquals(terminal.key.tonic, arrival.key.tonic)) return;
  const d = ordinaryRootChord(dominant, 5, "dominant7");
  const t = ordinaryRootChord(arrival, 1, arrival.key.mode);
  const finish = ordinaryRootChord(terminal, 1, arrival.key.mode);
  const before = slices[dominant.span.sliceIndices.at(-1)!];
  const onset = arrival.boundarySlice;
  const left = slices[arrival.span.sliceIndices.at(-1)!];
  const gap = left && slices[left.index + 1];
  const right = terminal.boundarySlice;
  const release = slices[terminal.span.sliceIndices.at(-1)!];
  if (!d || !t || !finish || !before || !onset || !left || !gap?.completeSatb || !right || !release ||
      before.endTick !== onset.tick || left.endTick !== gap.tick || gap.index >= right.index ||
      right.tick - gap.tick > beatTicks / 2 || !writtenArrival(before, d, onset, t)) return;
  // Repeating a key signature can split one sustained set of notes into several slices.
  if (slices.slice(gap.index, right.index).some(slice => slice.chord ||
      VOICE_ORDER.some(voice => slice.notes[voice]?.id !== gap.notes[voice]!.id))) return;
  const position = metricAt(gap.tick);
  if (position?.role !== "subdivision" || position.confidence !== "certain" ||
      compareMetricStrength(metricAt(right.tick), position) !== "stronger") return;
  if (slices.slice(before.index, release.index + 1).some(slice => !sameKey(slice.key, before.key)) ||
      !arrival.span.sliceIndices.every(index => hasCadentialWrittenVoicing(slices[index], t, true)) ||
      !terminal.span.sliceIndices.every(index => hasCadentialWrittenVoicing(slices[index], finish, false)) ||
      VOICE_ORDER.some(voice => endOf(release.notes[voice]!) !== terminal.span.toTick)) return;

  const bass = onset.notes.bass!, resumedBass = right.notes.bass!;
  if (left.notes.bass?.id !== bass.id || gap.notes.bass!.id !== bass.id ||
      !pitchClassEquals(resumedBass.pitch, bass.pitch)) return;
  if (resumedBass.id !== bass.id) {
    const motion = writtenInterval(bass.pitch, resumedBass.pitch);
    if (endOf(bass) !== right.tick || resumedBass.startTick !== right.tick ||
        Math.abs(motion.diatonicSteps) !== 7 || Math.abs(motion.semitones) !== 12) return;
  }

  const moving = upperVoices.filter(voice => gap.notes[voice]!.id !== left.notes[voice]!.id);
  const held = upperVoices.find(voice => !moving.includes(voice));
  if (moving.length !== 2 || !held || right.notes[held]!.id !== gap.notes[held]!.id) return;
  const notes = VOICE_ORDER.map(voice => gap.notes[voice]!);
  if (notes.some(note => toMidi(note.pitch) < toMidi(bass.pitch) || toMidi(note.pitch) > toMidi(gap.notes.soprano!.pitch)) ||
      hasCompleteWrittenTertianVoicing(notes.map(note => note.pitch))) return;

  const tones = chordIdentityToneSpellings(t);
  let stepwisePreparation = false;
  for (const voice of moving) {
    const from = left.notes[voice]!, decoration = gap.notes[voice]!, to = right.notes[voice]!;
    const entry = writtenInterval(from.pitch, decoration.pitch), exit = writtenInterval(decoration.pitch, to.pitch);
    if (tones.some(tone => pitchClassEquals(tone, decoration.pitch)) ||
        endOf(from) !== gap.tick || decoration.startTick !== gap.tick ||
        endOf(decoration) !== right.tick || to.startTick !== right.tick ||
        !isWrittenStep(exit) || exit.diatonicSteps !== Math.sign(exit.semitones)) return;
    const entersByStep = isWrittenStep(entry) && entry.diatonicSteps === Math.sign(entry.semitones);
    const role = decoration.nonChordToneRole;
    if (role && !(role === "neighbor" && spelledPitchEquals(from.pitch, to.pitch)) &&
        !(role === "passing" && entersByStep && entry.diatonicSteps === exit.diatonicSteps)) return;
    stepwisePreparation ||= entersByStep;
  }
  if (!stepwisePreparation) return;

  return {
    code: "closing-tonic-decoration",
    value: "属七实奏落主后，主低音和一个上声部保持，两个弱位装饰音级进回到主和弦",
    refs: [bass.id, gap.notes[held]!.id, ...moving.flatMap(voice => [gap.notes[voice]!.id, right.notes[voice]!.id])],
  };
}
