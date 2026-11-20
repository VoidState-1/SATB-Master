import { chordToneSpellings } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, toMidi } from "../../../pitch";
import type { AnalysisKey, AnalysisNote } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";

export function supportsBassTriad(
  context: HarmonyRuleContext, key: AnalysisKey, bass: AnalysisNote,
  endTick: number, degree: 1 | 2 | 4 | 5, quality: "major" | "minor", soloBass: boolean, fromTick = bass.startTick,
) {
  const root = scaleDegreePitchClass(key, degree);
  const tones = chordToneSpellings(root, quality);
  const functionName = degree === 4 || degree === 2 ? "subdominant" : degree === 5 ? "dominant" : "tonic";
  return context.slices({ overlapping: { fromTick, toTick: endTick } }).all(slice => {
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
    if (soloBass) return Object.values(slice.notes).length === 1;
    if (!slice.completeSatb) return false;
    const notes = Object.values(slice.notes);
    const lowest = toMidi(bass.pitch);
    return notes.every(note => !note.nonChordToneRole && toMidi(note.pitch) >= lowest &&
      tones.some(tone => pitchClassEquals(note.pitch, tone))) &&
      tones.every(tone => notes.some(note => pitchClassEquals(note.pitch, tone)));
  });
}
