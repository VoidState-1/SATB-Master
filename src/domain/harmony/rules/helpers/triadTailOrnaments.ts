import { chordIdentityToneSpellings } from "../../../chordModel";
import {
  isWrittenStep, pitchClassEquals, scaleDegreePitchClass, stepIndex, toMidi, writtenInterval,
} from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisNote, AnalysisSlice } from "../../analysis";
import { writtenNeighborsOverHeldBass } from "../../writtenNeighbors";
import { soundsCompleteWrittenChord } from "../../writtenVoicing";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { HarmonyRuleContext } from "../context/createRuleContext";

function passingDirection(first: AnalysisNote, middle: AnalysisNote, last: AnalysisNote) {
  if ((middle.nonChordToneRole && middle.nonChordToneRole !== "passing") ||
      first.startTick + first.durationTicks !== middle.startTick ||
      middle.startTick + middle.durationTicks !== last.startTick ||
      middle.durationTicks > Math.min(first.durationTicks, last.durationTicks)) return undefined;
  const into = writtenInterval(first.pitch, middle.pitch);
  const out = writtenInterval(middle.pitch, last.pitch);
  if (!isWrittenStep(into) || !isWrittenStep(out) ||
      into.diatonicSteps !== out.diatonicSteps ||
      Math.sign(into.semitones) !== into.diatonicSteps ||
      Math.sign(out.semitones) !== out.diatonicSteps) return undefined;
  return into.diatonicSteps;
}

/** Match a complete triad immediately beyond the end of a label using the
 * sounding notes there. The recovered evidence is local to this ornamental slice. */
export function triadTailOrnaments(context: HarmonyRuleContext, middle: AnalysisSlice) {
  const chord = middle.chord;
  if (!chord || !middle.completeSatb || middle.endTick !== chord.startTick + chord.durationTicks ||
      middle.attackVoiceIds.length < 1 || middle.attackVoiceIds.length > 2 ||
      middle.attackVoiceIds.includes("bass")) return;
  const { identity } = chord;
  const structure = identity.structure;
  if (structure.kind !== "tertian" || (structure.quality !== "major" && structure.quality !== "minor") ||
      structure.extensions.length || structure.alterations.length) return;
  const before = context.sliceAt(middle.tick - 1);
  const after = context.sliceAt(middle.endTick);
  if (!before?.completeSatb || before.chord?.id !== chord.id || !after?.completeSatb || after.chord ||
      before.endTick !== middle.tick || after.tick !== middle.endTick ||
      before.key.id !== middle.key.id || after.key.id !== middle.key.id ||
      context.analysis.phraseBoundaries.some(b => !b.stale && before.tick < b.tick && b.tick <= after.tick)) return;
  const position = context.metric.positionAt(middle.tick);
  const arrival = context.metric.positionAt(after.tick);
  const duration = middle.endTick - middle.tick;
  if (!position || position.confidence !== "certain" || position.level >= 2 ||
      arrival?.confidence !== "certain" || duration > context.analysis.project.ppq || duration > before.endTick - before.tick ||
      context.metric.compare(context.metric.positionAt(before.tick), position) !== "stronger" ||
      context.metric.compare(arrival, position) === "weaker") return;
  if (![before, after].every(slice =>
    soundsCompleteWrittenChord(identity, Object.values(slice.notes), slice.notes.bass!),
  )) return;
  const tones = chordIdentityToneSpellings(identity);
  const moving = middle.attackVoiceIds;
  const notes = moving.map(voice => middle.notes[voice]!);
  if (notes.some(note => note.startTick !== middle.tick ||
      tones.some(tone => pitchClassEquals(tone, note.pitch)) ||
      toMidi(note.pitch) < toMidi(middle.notes.bass!.pitch)) ||
      VOICE_ORDER.some(voice => !moving.includes(voice) &&
        (before.notes[voice]?.id !== middle.notes[voice]?.id || after.notes[voice]?.id !== middle.notes[voice]?.id)) ||
      hasCompleteWrittenTertianVoicing(Object.values(middle.notes).map(note => note.pitch))) return;
  if (moving.length === 1) {
    const neighborIds = writtenNeighborsOverHeldBass(identity, before, middle, after);
    if (neighborIds?.length === 1 && neighborIds[0] === notes[0].id) {
      return { noteIds: neighborIds, departure: before };
    }
    return;
  }

  // Spasobin §39.2, example 39–591: two contrary passing voices can converge.
  if (!pitchClassEquals(notes[0].pitch, notes[1].pitch)) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return;
  const key = reading.value.localKey ?? middle.key;
  const degree = (stepIndex(notes[0].pitch.step) - stepIndex(key.tonic.step) + 7) % 7 + 1;
  if (!pitchClassEquals(notes[0].pitch, scaleDegreePitchClass(key, degree))) return;
  const directions = moving.map(voice => passingDirection(before.notes[voice]!, middle.notes[voice]!, after.notes[voice]!));
  if (directions[0] === undefined || directions[1] !== -directions[0]) return;
  return { noteIds: notes.map(note => note.id), departure: before };
}
