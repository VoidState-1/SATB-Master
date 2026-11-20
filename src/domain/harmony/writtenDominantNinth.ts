import { chordIdentityToneSpellingForDegree, identityContainsWrittenPitchClass, type ChordIdentity } from "../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval, type SpelledPitch } from "../pitch";
import { VOICE_ORDER } from "../project/voice";
import { compareMetricStrength, type MetricPosition } from "../rhythm/metric";
import type { AnalysisSlice } from "./analysis";
import { soundsCompleteWrittenTones } from "./writtenVoicing";

export function dominantNinthTone(identity: ChordIdentity) {
  const structure = identity.structure;
  return structure.kind === "tertian" && structure.quality === "dominant7" && structure.extensions.includes(9)
    ? chordIdentityToneSpellingForDegree(identity, 9) : undefined;
}

/** The ninth is an absolute chord member. Use its written motion and the
 * actual landing identity, including the two textbook same-root V7 exits. */
export function writtenDominantNinthResolves(
  source: ChordIdentity, target: ChordIdentity, from: SpelledPitch, to: SpelledPitch,
) {
  const ninth = dominantNinthTone(source);
  if (!ninth || !pitchClassEquals(from, ninth) || !identityContainsWrittenPitchClass(target, to)) return false;
  const motion = writtenInterval(from, to);
  const step = motion.diatonicSteps === -1 && (motion.semitones === -1 || motion.semitones === -2);
  const structure = target.structure;
  if (structure.kind === "tertian" && !structure.extensions.length) {
    const tonic = scaleDegreePitchClass({ tonic: source.root, mode: "major" }, 4);
    if ((structure.quality === "major" || structure.quality === "minor") && pitchClassEquals(target.root, tonic)) {
      const fifth = chordIdentityToneSpellingForDegree(target, 5);
      return !!fifth && step && pitchClassEquals(to, fifth);
    }
    if (structure.quality === "dominant7" && pitchClassEquals(source.root, target.root)) {
      if (step && pitchClassEquals(to, target.root)) return true;
      const seventh = chordIdentityToneSpellingForDegree(target, 7);
      return !!seventh && pitchClassEquals(to, seventh) && motion.diatonicSteps === -2 &&
        (motion.semitones === -3 || motion.semitones === -4);
    }
  }
  return step;
}

/** The caller establishes the exact preparation chord and the continuity of
 * the two target slices. Return only the held note in the proved 9–8 window. */
export function preparedNinthOverDominantSeventh(
  target: ChordIdentity,
  before: AnalysisSlice["notes"], source: AnalysisSlice["notes"], landing: AnalysisSlice["notes"],
  onsetTick: number, resolutionTick: number,
  onsetMetric: MetricPosition | undefined, resolutionMetric: MetricPosition | undefined,
) {
  const { root, structure } = target;
  const bass = source.bass, landingBass = landing.bass;
  if (structure.kind !== "tertian" || structure.quality !== "dominant7" ||
      structure.extensions.length || structure.alterations.length ||
      !bass || bass.nonChordToneRole || bass.startTick !== onsetTick || !landingBass ||
      !pitchClassEquals(target.bass, root) || !pitchClassEquals(bass.pitch, root) ||
      !pitchClassEquals(landingBass.pitch, root) ||
      compareMetricStrength(onsetMetric, resolutionMetric) !== "stronger") return;
  const required = [chordIdentityToneSpellingForDegree(target, 3), chordIdentityToneSpellingForDegree(target, 7)];
  const exitNotes = Object.values(landing).filter(note => note !== undefined);
  if (!required[0] || !required[1] || exitNotes.length !== VOICE_ORDER.length ||
      !soundsCompleteWrittenTones([root, required[0], required[1]], exitNotes, landingBass)) return;

  for (const voice of VOICE_ORDER) {
    const note = source[voice], arrival = landing[voice];
    if (voice === "bass" || !note || note.nonChordToneRole || before[voice]?.id !== note.id ||
        note.startTick >= onsetTick || note.startTick + note.durationTicks !== resolutionTick ||
        !arrival || arrival.startTick !== resolutionTick || !pitchClassEquals(arrival.pitch, root)) continue;
    const interval = writtenInterval(bass.pitch, note.pitch);
    const motion = writtenInterval(note.pitch, arrival.pitch);
    if (interval.diatonicSteps < 8 || interval.semitones <= 12 || motion.diatonicSteps !== -1 ||
        (motion.semitones !== -1 && motion.semitones !== -2)) continue;
    if (VOICE_ORDER.every(other => {
      if (other === voice || other === "bass") return true;
      const held = source[other], next = landing[other];
      return !!held && !held.nonChordToneRole && !!next &&
        toMidi(held.pitch) >= toMidi(bass.pitch) && spelledPitchEquals(held.pitch, next.pitch);
    })) return note.id;
  }
}
