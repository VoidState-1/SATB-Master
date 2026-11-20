import type { ChordQuality } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, toMidi, type WrittenInterval } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import type { AnalysisSlice } from "../../analysis";
import { movesToWrittenTone } from "../../dominantSixthMotion";
import type { RuleStepContext } from "../../runtime";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { isPerfectFifth, pitchClass } from "../helpers/core";

function writtenTriad(
  rules: HarmonyRuleContext,
  slice: AnalysisSlice,
  degree: 5 | 6,
  quality: ChordQuality,
) {
  const { chord, key } = slice;
  if (!chord || !slice.completeSatb) return undefined;
  const { identity, semantics } = chord;
  const structure = identity.structure;
  if (structure.kind !== "tertian" || structure.quality !== quality ||
      structure.extensions.length || structure.alterations.length ||
      !pitchClassEquals(identity.root, scaleDegreePitchClass(key, degree)) ||
      semantics?.interpretations.length !== 1 || semantics.mixture || semantics.pedalContext) return undefined;

  const reading = rules.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return undefined;
  const { localKey, appliedTarget, designation, degreeAlteration } = reading.value;
  if (reading.value.degree !== degree || degreeAlteration !== 0 || appliedTarget ||
      (localKey && !keyEquals(localKey, key)) ||
      (designation && (degree === 5
        ? designation.kind !== "primary" || designation.primaryFunction !== "dominant"
        : designation.kind !== "side-degree" || designation.primaryFunction !== "tonic"))) return undefined;

  const members = rules.harmony.chordMembersAt(slice);
  const counts = [0, 0, 0];
  let upperMidi = Infinity;
  for (const { note, voiceId, chordToneIndex } of members) {
    const midi = toMidi(note.pitch);
    if (chordToneIndex === undefined || note.nonChordToneRole || midi > upperMidi ||
        (voiceId === "bass" && !pitchClassEquals(note.pitch, identity.bass))) return undefined;
    counts[chordToneIndex]++;
    upperMidi = midi;
  }
  return counts.every(count => count > 0) ? { counts, members, bass: identity.bass } : undefined;
}

function isOctaveClass(interval: WrittenInterval) {
  return Math.abs(interval.diatonicSteps) % 7 === 0 && pitchClass(interval.semitones) === 0;
}

/** Spasobin §20.5, exs. 20-273a(3) and 20-274: an actual major V–vi pair. */
export function hasMajorDeceptiveLeadingToneMotion(context: RuleStepContext, voice: VoiceId) {
  const { rules, previous, slice, transitionFromPrevious: transition } = context;
  const leading = previous?.notes[voice];
  const landing = slice.notes[voice];
  if (!previous || !transition?.contiguous || !transition.sameKey ||
      slice.key.mode !== "major" || voice === "soprano" || !leading || !landing) return false;
  const leadingTone = scaleDegreePitchClass(slice.key, 7);
  const sixth = scaleDegreePitchClass(slice.key, 6);
  if (!pitchClassEquals(leading.pitch, leadingTone) || !movesToWrittenTone(leading.pitch, landing.pitch, sixth, -1, -2)) return false;

  const from = writtenTriad(rules, previous, 5, "major");
  const to = writtenTriad(rules, slice, 6, "minor");
  if (!from || !to || from.counts[1] !== 1 || !pitchClassEquals(to.bass, sixth)) return false;
  const sourceAttack = Math.max(...from.members.map(({ note }) => note.startTick));
  const sourceBeat = rules.metric.positionAt(sourceAttack);
  const arrivalBeat = rules.metric.positionAt(slice.tick);
  if (!sourceBeat || sourceBeat.role === "subdivision" || !arrivalBeat || arrivalBeat.role === "subdivision" ||
      to.members.some(({ note }) => note.startTick !== slice.tick)) return false;

  if (voice === "bass") {
    // D6 → vi, with the sixth-degree triad's third doubled.
    if (!pitchClassEquals(from.bass, leadingTone) || to.counts[1] !== 2) return false;
  } else {
    // Root-position D → vi. The inner leading tone and the ascending bass double the new root.
    const bass = previous.notes.bass;
    const nextBass = slice.notes.bass;
    if (!bass || !nextBass || !pitchClassEquals(from.bass, scaleDegreePitchClass(slice.key, 5)) ||
        from.counts[0] !== 2 || to.counts[0] !== 2 ||
        !movesToWrittenTone(bass.pitch, nextBass.pitch, sixth, 1, 2)) return false;
  }

  return !rules.voiceLeading.voicePairs(transition).some(pair =>
    pair.upperMotion !== "stationary" && pair.lowerMotion !== "stationary" &&
    ((isPerfectFifth(pair.previousInterval) && isPerfectFifth(pair.currentInterval)) ||
      (isOctaveClass(pair.previousInterval) && isOctaveClass(pair.currentInterval))));
}
