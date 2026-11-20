import { chordIdentityToneSpellings, chordToneSpellings } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval, type KeyLike } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisNote, AnalysisSlice } from "../../analysis";
import { dominantSixthInnerVoices, movesToWrittenTone, resolvesDominantInnerVoice } from "../../dominantSixthMotion";
import { soundsCompleteWrittenChord } from "../../writtenVoicing";
import { resolvesRaisedFifthToDoubledThird } from "../../raisedFifthResolution";
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

// Spasobin §24.7. When the upper sixth replaces the fifth, all four
// written voices can still establish a direct resolution to three roots and a third.
function resolvesWrittenDominantSixth(
  context: HarmonyRuleContext, source: AnalysisSlice, landing: AnalysisSlice, key: KeyLike,
) {
  const root = scaleDegreePitchClass(key, 5);
  const [, third, , seventh] = chordToneSpellings(root, "dominant7");
  if (source.chord) {
    const previousKey = primaryKey(context, source, 5);
    const identity = source.chord.identity;
    const shape = identity.structure;
    if (!previousKey || !keyEquals(previousKey, key) ||
        shape.kind !== "tertian" || shape.quality !== "dominant7" || shape.alterations.length ||
        shape.extensions.some(extension => extension !== 6) ||
        !pitchClassEquals(identity.root, root) || !pitchClassEquals(identity.bass, root)) return false;
  }
  const bass = source.notes.bass!;
  const soprano = source.notes.soprano!;
  const landingBass = landing.notes.bass!;
  const tonicThird = scaleDegreePitchClass(key, 3);
  if (!pitchClassEquals(bass.pitch, root) || soprano.startTick !== source.tick ||
      soprano.startTick + soprano.durationTicks !== landing.tick ||
      !pitchClassEquals(soprano.pitch, tonicThird) ||
      !movesToWrittenTone(soprano.pitch, landing.notes.soprano!.pitch, key.tonic, -2) ||
      !leapsToTonic(bass, landingBass, key) ||
      !Object.values(source.notes).every(note => !note.nonChordToneRole &&
        toMidi(bass.pitch) <= toMidi(note.pitch) && toMidi(note.pitch) <= toMidi(soprano.pitch))) return false;
  const [alto, tenor] = dominantSixthInnerVoices;
  return (pitchClassEquals(source.notes[alto]!.pitch, third) || pitchClassEquals(source.notes[tenor]!.pitch, third)) &&
    (pitchClassEquals(source.notes[alto]!.pitch, seventh) || pitchClassEquals(source.notes[tenor]!.pitch, seventh)) &&
    dominantSixthInnerVoices.every(voice => {
      const from = source.notes[voice]!;
      return from.startTick === source.tick && from.startTick + from.durationTicks === landing.tick &&
        resolvesDominantInnerVoice(from.pitch, landing.notes[voice]!.pitch, third, seventh, key.tonic, tonicThird);
    });
}

function leapsToTonic(
  from: AnalysisNote,
  to: AnalysisNote,
  key: KeyLike,
) {
  const leap = writtenInterval(from.pitch, to.pitch);
  return pitchClassEquals(to.pitch, key.tonic) && (leap.semitones === 5 || leap.semitones === -7);
}

// Spasobin 14–194 and 16–220. The fifth and seventh descend, the third ascends,
// and the dominant root leaps to the tonic in its own voice.
export function landsOnIncompleteTonic(context: HarmonyRuleContext, landing: AnalysisSlice) {
  const source = context.sliceAt(landing.tick - 1);
  if (!source || !landing.chord || !source.completeSatb || !landing.completeSatb ||
      landing.tick !== landing.chord.startTick || source.endTick !== landing.tick ||
      source.key.id !== landing.key.id ||
      context.analysis.phraseBoundaries.some(mark => mark.source === "manual" && mark.tick === landing.tick)) return false;
  const key = primaryKey(context, landing, 1);
  const tonic = landing.chord.identity;
  const bass = landing.notes.bass!;
  if (!key || tonic.structure.kind !== "tertian" || tonic.structure.quality !== key.mode ||
      !pitchClassEquals(tonic.root, key.tonic) || !pitchClassEquals(bass.pitch, tonic.root) ||
      !Object.values(landing.notes).every(note =>
        !note.nonChordToneRole && note.startTick === landing.tick && toMidi(note.pitch) >= toMidi(bass.pitch),
      )) return false;

  if (key.mode === "major" && resolvesRaisedFifthToDoubledThird(source, landing, key.tonic)) return true;
  if (resolvesWrittenDominantSixth(context, source, landing, key)) return true;
  const previousKey = primaryKey(context, source, 5);
  if (!source.chord || !previousKey || !keyEquals(previousKey, key)) return false;
  const dominant = source.chord.identity;
  if (dominant.structure.kind !== "tertian" || dominant.structure.quality !== "dominant7" ||
      dominant.structure.extensions.length || dominant.structure.alterations.length ||
      !pitchClassEquals(dominant.root, scaleDegreePitchClass(key, 5))) return false;
  const [root, third, fifth, seventh] = chordIdentityToneSpellings(dominant);
  if ((!pitchClassEquals(dominant.bass, root) && !pitchClassEquals(dominant.bass, fifth)) ||
      !soundsCompleteWrittenChord(dominant, Object.values(source.notes), source.notes.bass!)) return false;
  const tonicThird = scaleDegreePitchClass(key, 3);
  return VOICE_ORDER.every(voice => {
    const from = source.notes[voice]!;
    const to = landing.notes[voice]!;
    if (pitchClassEquals(from.pitch, third)) return movesToWrittenTone(from.pitch, to.pitch, tonic.root, 1, 1);
    if (pitchClassEquals(from.pitch, fifth)) return movesToWrittenTone(from.pitch, to.pitch, tonic.root, -1, -2);
    if (pitchClassEquals(from.pitch, seventh)) return movesToWrittenTone(from.pitch, to.pitch, tonicThird, -1);
    return leapsToTonic(from, to, key);
  });
}
