import { chordToneSpellings } from "../../../chordModel";
import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, toMidi } from "../../../pitch";
import type { AnalysisKey, AnalysisNote, MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";

// Spasobin, ch. 12 §4(b–c), ex. 12-162: during iv6–V6 the descending
// diminished seventh can replace the augmented second. The example continues to i.
export function resolvesMinorBassDiminishedSeventh(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { voiceId, previous, current, contiguous, sameKey, writtenInterval } = transition;
  if (voiceId !== "bass" || !contiguous || !sameKey || writtenInterval.diatonicSteps !== -6 ||
      writtenInterval.semitones !== -9 || previous.nonChordToneRole || current.nonChordToneRole) return false;

  const key = context.keyAt(previous.startTick);
  if (key?.mode !== "minor" ||
      !pitchClassEquals(previous.pitch, scaleDegreePitchClass(key, 6)) ||
      !pitchClassEquals(current.pitch, leadingTonePitchClass(key))) return false;

  const next = context.notes({ voiceId, startingAfter: current.startTick }).first()?.note;
  if (!next || next.startTick !== current.startTick + current.durationTicks || next.nonChordToneRole ||
      !pitchClassEquals(next.pitch, key.tonic) || toMidi(next.pitch) - toMidi(current.pitch) !== 1) return false;

  if (context.analysis.project.keyEvents.some(event =>
    previous.startTick < event.tick && event.tick <= next.startTick &&
    (event.mode !== key.mode || !pitchClassEquals(event.tonic, key.tonic))) ||
    context.analysis.phraseBoundaries.some(boundary =>
      !boundary.stale && previous.startTick < boundary.tick && boundary.tick <= next.startTick)) return false;

  const soloBass = context.analysis.project.satbTracks.every(track => track.voice === "bass" || !track.notes.length);
  return supportsTriad(context, key, previous, current.startTick, 4, soloBass) &&
    supportsTriad(context, key, current, next.startTick, 5, soloBass) &&
    supportsTriad(context, key, next, next.startTick + 1, 1, soloBass);
}

function supportsTriad(
  context: HarmonyRuleContext, key: AnalysisKey, bass: AnalysisNote,
  endTick: number, degree: 4 | 5 | 1, soloBass: boolean,
) {
  const root = scaleDegreePitchClass(key, degree);
  const quality = degree === 5 ? "major" : "minor";
  const tones = chordToneSpellings(root, quality);
  const functionName = degree === 4 ? "subdominant" : degree === 5 ? "dominant" : "tonic";
  return context.slices({ overlapping: { fromTick: bass.startTick, toTick: endTick } }).all(slice => {
    if (slice.notes.bass?.id !== bass.id) return false;
    if (slice.chord) {
      const { root: labelledRoot, bass: labelledBass, structure } = slice.chord.identity;
      if (structure.kind !== "tertian" || structure.quality !== quality ||
          structure.extensions.length || structure.alterations.length ||
          !pitchClassEquals(labelledRoot, root) || !pitchClassEquals(labelledBass, bass.pitch)) return false;
      const meaning = context.harmony.primaryInterpretation(slice.chord);
      if (meaning.status === "ambiguous") return false;
      if (meaning.status === "resolved") {
        const { appliedTarget, degree: labelledDegree, designation, localKey } = meaning.value;
        if (appliedTarget || (labelledDegree !== undefined && labelledDegree !== degree) ||
            (designation?.primaryFunction && designation.primaryFunction !== functionName) ||
            (localKey && (localKey.mode !== key.mode || !pitchClassEquals(localKey.tonic, key.tonic)))) return false;
      }
    }

    // The printed bass exercise supplies no upper parts. With SATB evidence
    // require the written triad and the stated bass to be the sounding bottom.
    if (soloBass) return true;
    if (!slice.completeSatb) return false;
    const notes = Object.values(slice.notes);
    const lowest = toMidi(bass.pitch);
    return notes.every(note => !note.nonChordToneRole && toMidi(note.pitch) >= lowest &&
      tones.some(tone => pitchClassEquals(note.pitch, tone))) &&
      tones.every(tone => notes.some(note => pitchClassEquals(note.pitch, tone)));
  });
}
