import { chordIdentityInversion, chordToneSpellings, type KeyReference } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval } from "../../../pitch";
import type { SpelledPitchClass } from "../../../pitch";
import type { AnalysisNote, AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../groups/dominantSixthSubstitution";
import { activeNotes } from "../helpers/core";

function sameKey(left: KeyReference, right: KeyReference) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

function plainQuality(slice: AnalysisSlice, quality: "diminished7" | "dominant7" | "major") {
  const structure = slice.chord?.identity.structure;
  return structure?.kind === "tertian" && structure.quality === quality &&
    structure.extensions.length === 0 && structure.alterations.length === 0;
}

function hasWrittenVoicing(slice: AnalysisSlice, tones: readonly SpelledPitchClass[]) {
  const notes = activeNotes(slice);
  const bass = slice.notes.bass;
  return !!bass && slice.completeSatb &&
    notes.every(({ note }) => !note.nonChordToneRole && toMidi(note.pitch) >= toMidi(bass.pitch) &&
      tones.some(tone => pitchClassEquals(note.pitch, tone))) &&
    tones.every(tone => notes.some(({ note }) => pitchClassEquals(note.pitch, tone)));
}

function descendsAt(before: AnalysisNote, after: AnalysisNote | undefined, tick: number, steps: 0 | -1) {
  if (!after || before.startTick + before.durationTicks !== tick || after.startTick !== tick) return false;
  const motion = writtenInterval(before.pitch, after.pitch);
  return motion.diatonicSteps === steps && motion.semitones === -1;
}

/** Spasobin §29.3, ex. 29-440a. Read the backward leading-tone motion at a
 * contiguous fully written DD leading-tone diminished seventh → V7 boundary. */
export function readDoubleDominantSeventhLanding(rules: HarmonyRuleContext, tick: number) {
  const landing = rules.sliceAt(tick);
  const source = rules.sliceAt(tick - 1);
  const dominant = landing?.chord;
  if (!landing || !source || !dominant || landing.tick !== tick || dominant.startTick !== tick ||
      source.endTick !== tick || source.key.id !== landing.key.id ||
      rules.phraseAt(source.tick)?.id !== rules.phraseAt(tick)?.id ||
      crossesManualPhraseBoundary(rules, source.tick, tick) || !plainQuality(landing, "dominant7")) return;

  const reading = rules.harmony.primaryInterpretation(dominant);
  if (reading.status !== "resolved" || reading.value.appliedTarget || reading.value.degree !== 5 ||
      reading.value.degreeAlteration !== 0 || reading.value.designation?.primaryFunction !== "dominant") return;
  const key = reading.value.localKey ?? landing.key;
  const dominantRoot = scaleDegreePitchClass(key, 5);
  const dominantTones = chordToneSpellings(dominantRoot, "dominant7");
  if (!pitchClassEquals(dominant.identity.root, dominantRoot) || !hasWrittenVoicing(landing, dominantTones) ||
      !pitchClassEquals(dominant.identity.bass, landing.notes.bass!.pitch)) return;

  const raisedFourth = scaleDegreePitchClass(key, 4, 1);
  const sourceTones = chordToneSpellings(raisedFourth, "diminished7");
  if (!hasWrittenVoicing(source, sourceTones)) return;
  const annotated = source.chord;
  if (annotated) {
    const sourceReading = rules.harmony.primaryInterpretation(annotated);
    if (sourceReading.status !== "resolved" || !plainQuality(source, "diminished7") ||
        !pitchClassEquals(annotated.identity.root, raisedFourth) ||
        !pitchClassEquals(annotated.identity.bass, source.notes.bass!.pitch)) return;
    const meaning = sourceReading.value;
    const designation = meaning.designation?.kind;
    if (!sameKey(meaning.localKey ?? source.key, key) || meaning.degree !== 7 || meaning.degreeAlteration !== 0 ||
        (designation !== "applied-leading-tone" && designation !== "double-dominant-leading-tone") ||
        (meaning.appliedTarget?.degree ?? (designation === "double-dominant-leading-tone" ? 5 : undefined)) !== 5) return;
  } else if (!sameKey(source.key, key)) return;

  const notes = activeNotes(source);
  const leading = notes.find(({ note }) => pitchClassEquals(note.pitch, raisedFourth))!;
  const seventh = notes.find(({ note }) => pitchClassEquals(note.pitch, sourceTones[3]))!;
  const leadingArrival = landing.notes[leading.voiceId];
  const seventhArrival = landing.notes[seventh.voiceId];
  if (!leadingArrival || !seventhArrival ||
      !pitchClassEquals(leadingArrival.pitch, dominantTones[3]) ||
      !pitchClassEquals(seventhArrival.pitch, dominantTones[2]) ||
      !descendsAt(leading.note, leadingArrival, tick, 0) ||
      !descendsAt(seventh.note, seventhArrival, tick, -1) ||
      rules.keyAt(leading.note.startTick)?.id !== source.key.id ||
      crossesManualPhraseBoundary(rules, leading.note.startTick, tick)) return;

  return { source, landing, key, leading, leadingArrival, seventh, seventhArrival, dominantRoot };
}

/** The bass entry in ex. 29-440a is a different chromatic event, T6's
 * major third becoming DD's diminished seventh before descending to V43. */
export function isDoubleDominantSeventhBassPreparation(
  rules: HarmonyRuleContext, before: AnalysisNote, middle: AnalysisNote,
) {
  const tick = middle.startTick;
  const proof = readDoubleDominantSeventhLanding(rules, tick + middle.durationTicks);
  if (!proof || proof.key.mode !== "major" || proof.source.tick !== tick ||
      proof.seventh.voiceId !== "bass" || proof.seventh.note.id !== middle.id ||
      !descendsAt(before, middle, tick, 0)) return false;
  const preparation = rules.sliceAt(tick - 1);
  const tonic = preparation?.chord;
  if (!preparation || !tonic || preparation.key.id !== proof.source.key.id ||
      preparation.notes.bass?.id !== before.id ||
      crossesManualPhraseBoundary(rules, before.startTick, proof.landing.tick) ||
      rules.phraseAt(preparation.tick)?.id !== rules.phraseAt(proof.landing.tick)?.id ||
      !plainQuality(preparation, "major") || chordIdentityInversion(tonic.identity) !== 1 ||
      !pitchClassEquals(tonic.identity.root, proof.key.tonic) ||
      !pitchClassEquals(before.pitch, tonic.identity.bass) ||
      !hasWrittenVoicing(preparation, chordToneSpellings(proof.key.tonic, "major"))) return false;
  const reading = rules.harmony.primaryInterpretation(tonic);
  return reading.status === "resolved" && !reading.value.appliedTarget &&
    reading.value.degree === 1 && reading.value.degreeAlteration === 0 &&
    reading.value.designation?.primaryFunction === "tonic" &&
    sameKey(reading.value.localKey ?? preparation.key, proof.key);
}
