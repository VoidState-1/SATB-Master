import { chordToneSpellings } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, writtenInterval } from "../../../pitch";
import { hasWrittenVoicing } from "../../writtenResolution";
import type { AnalysisNote, AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import { activeNotes } from "../helpers/core";

function plainQuality(slice: AnalysisSlice, quality: "diminished7" | "dominant7") {
  const structure = slice.chord?.identity.structure;
  return structure?.kind === "tertian" && structure.quality === quality &&
    structure.extensions.length === 0 && structure.alterations.length === 0;
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
    if (!keyEquals(meaning.localKey ?? source.key, key) || meaning.degree !== 7 || meaning.degreeAlteration !== 0 ||
        (designation !== "applied-leading-tone" && designation !== "double-dominant-leading-tone") ||
        (meaning.appliedTarget?.degree ?? (designation === "double-dominant-leading-tone" ? 5 : undefined)) !== 5) return;
  } else if (!keyEquals(source.key, key)) return;

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
