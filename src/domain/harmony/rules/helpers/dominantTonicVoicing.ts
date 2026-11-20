import { chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import { movesToWrittenTone } from "../../dominantSixthMotion";
import { soundsCompleteWrittenChord } from "../../writtenNeighbors";
import type { HarmonyRuleContext } from "../context/createRuleContext";

function primaryKey(context: HarmonyRuleContext, slice: AnalysisSlice, degree: 1 | 5) {
  const chord = slice.chord;
  if (!chord?.semantics || chord.semantics.alternatives?.length || chord.semantics.interpretations.length !== 1 ||
      chord.semantics.pedalContext || chord.semantics.mixture || chord.semantics.cadenceRole) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== degree || reading.value.degreeAlteration !== 0 ||
      reading.value.appliedTarget || reading.value.designation?.kind !== "primary" ||
      reading.value.designation.primaryFunction !== (degree === 1 ? "tonic" : "dominant")) return;
  return reading.value.localKey ?? slice.key;
}

// Spasobin 14–194 and 16–220. The fifth and seventh descend, the third ascends,
// and the dominant root leaps to the tonic in its own voice.
export function landsOnIncompleteTonic(context: HarmonyRuleContext, landing: AnalysisSlice) {
  const source = context.sliceAt(landing.tick - 1);
  if (!source?.chord || !landing.chord || !source.completeSatb || !landing.completeSatb ||
      landing.tick !== landing.chord.startTick || source.endTick !== landing.tick ||
      source.key.id !== landing.key.id ||
      context.analysis.phraseBoundaries.some(mark => mark.source === "manual" && mark.tick === landing.tick)) return false;
  const key = primaryKey(context, landing, 1);
  const previousKey = primaryKey(context, source, 5);
  if (!key || !previousKey || previousKey.mode !== key.mode || !pitchClassEquals(previousKey.tonic, key.tonic)) return false;
  const dominant = source.chord.identity;
  const tonic = landing.chord.identity;
  if (dominant.structure.kind !== "tertian" || dominant.structure.quality !== "dominant7" ||
      dominant.structure.extensions.length || dominant.structure.alterations.length ||
      !pitchClassEquals(dominant.root, scaleDegreePitchClass(key, 5)) ||
      tonic.structure.kind !== "tertian" || tonic.structure.quality !== key.mode ||
      !pitchClassEquals(tonic.root, key.tonic) || !pitchClassEquals(landing.notes.bass!.pitch, tonic.root)) return false;
  const [root, third, fifth, seventh] = chordIdentityToneSpellings(dominant);
  if ((!pitchClassEquals(dominant.bass, root) && !pitchClassEquals(dominant.bass, fifth)) ||
      !soundsCompleteWrittenChord(dominant, Object.values(source.notes), source.notes.bass!)) return false;
  const tonicThird = scaleDegreePitchClass(key, 3);
  return VOICE_ORDER.every(voice => {
    const from = source.notes[voice]!.pitch;
    const to = landing.notes[voice]!;
    if (to.nonChordToneRole || to.startTick !== landing.tick || toMidi(to.pitch) < toMidi(landing.notes.bass!.pitch)) return false;
    if (pitchClassEquals(from, third)) return movesToWrittenTone(from, to.pitch, tonic.root, 1, 1);
    if (pitchClassEquals(from, fifth)) return movesToWrittenTone(from, to.pitch, tonic.root, -1, -2);
    if (pitchClassEquals(from, seventh)) return movesToWrittenTone(from, to.pitch, tonicThird, -1);
    const leap = writtenInterval(from, to.pitch);
    return pitchClassEquals(to.pitch, tonic.root) && (leap.semitones === 5 || leap.semitones === -7);
  });
}
