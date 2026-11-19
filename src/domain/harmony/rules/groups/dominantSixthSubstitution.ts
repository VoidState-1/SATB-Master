import { chordToneSpellings, type ChordQuality } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { movesToWrittenTone, resolvesDominantInnerVoice } from "../../dominantSixthMotion";

const innerVoices = ["alto", "tenor"] as const;
const lowerVoices = ["alto", "tenor", "bass"] as const;

function hasPlainRootPosition(slice: AnalysisSlice, degree: 1 | 5, quality: ChordQuality) {
  const { chord, key } = slice;
  const bass = slice.notes.bass;
  if (!chord || !bass || !slice.completeSatb || Object.values(slice.notes).some(note => note.nonChordToneRole)) return false;

  const { root, structure } = chord.identity;
  if (structure.kind !== "tertian" || structure.quality !== quality ||
      structure.extensions.length || structure.alterations.length ||
      !pitchClassEquals(root, scaleDegreePitchClass(key, degree)) ||
      !pitchClassEquals(root, chord.identity.bass) || !pitchClassEquals(root, bass.pitch)) return false;

  const { semantics } = chord;
  if (!semantics) return true;
  if (semantics.pedalContext || semantics.mixture || semantics.cadenceRole ||
      semantics.interpretations.length !== 1 || semantics.alternatives?.length) return false;
  const [interpretation] = semantics.interpretations;
  const { localKey, designation } = interpretation;
  return (interpretation.confidence === "certain" || interpretation.confidence === "probable") &&
    interpretation.degree === degree && interpretation.degreeAlteration === 0 && !interpretation.appliedTarget &&
    (!localKey || (localKey.mode === key.mode && pitchClassEquals(localKey.tonic, key.tonic))) &&
    (!designation || (designation.kind === "primary" &&
      designation.primaryFunction === (degree === 5 ? "dominant" : "tonic")));
}

export function resolvesDominantSixthSubstitution(source: AnalysisSlice, following: AnalysisSlice | undefined) {
  if (!following || source.endTick !== following.tick || source.key.id !== following.key.id ||
      !hasPlainRootPosition(source, 5, "dominant7")) return false;

  const { chord, notes, key } = source;
  const bass = notes.bass;
  const soprano = notes.soprano;
  const arrival = following.notes.soprano?.pitch;
  if (!chord || !bass || !soprano || !arrival ||
      bass.startTick < chord.startTick || soprano.startTick < chord.startTick) return false;

  const sixth = scaleDegreePitchClass(key, 3);
  const [, leadingTone, fifth, seventh] = chordToneSpellings(chord.identity.root, "dominant7");
  const alto = notes.alto?.pitch;
  const tenor = notes.tenor?.pitch;
  if (!alto || !tenor || !pitchClassEquals(soprano.pitch, sixth) ||
      !((pitchClassEquals(alto, leadingTone) && pitchClassEquals(tenor, seventh)) ||
        (pitchClassEquals(alto, seventh) && pitchClassEquals(tenor, leadingTone)))) return false;

  if (hasPlainRootPosition(following, 5, "dominant7")) {
    return movesToWrittenTone(soprano.pitch, arrival, fifth, -1) &&
      lowerVoices.every(voice => {
        const before = notes[voice];
        const after = following.notes[voice];
        return before && after && spelledPitchEquals(before.pitch, after.pitch);
      });
  }

  if (!hasPlainRootPosition(following, 1, key.mode) || following.chord?.startTick !== following.tick ||
      !movesToWrittenTone(soprano.pitch, arrival, key.tonic, -2)) return false;

  return innerVoices.every(voice => resolvesDominantInnerVoice(
    notes[voice]?.pitch, following.notes[voice]?.pitch, leadingTone, seventh, key.tonic, sixth,
  ));
}
