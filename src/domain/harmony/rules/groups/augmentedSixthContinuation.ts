import { chordIdentityToneSpellings } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval, type KeyLike } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { soundsCompleteWrittenMembers } from "../../writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "../helpers/core";

function frenchVoicingChange(
  context: HarmonyRuleContext, before: AnalysisSlice, after: AnalysisSlice, key: KeyLike,
  variant: "german" | "italian",
) {
  const source = before.chord;
  const target = after.chord;
  if (!before.completeSatb || !after.completeSatb ||
      source?.identity.structure.kind !== "augmented-sixth" || source.identity.structure.variant !== variant ||
      target?.identity.structure.kind !== "augmented-sixth" || target.identity.structure.variant !== "french" ||
      before.endTick !== after.tick || before.key.id !== after.key.id ||
      context.phraseAt(before.tick)?.id !== context.phraseAt(after.tick)?.id) return;

  const low = scaleDegreePitchClass({ ...key, mode: "minor" }, 6);
  const bassBefore = before.notes.bass!;
  const bassAfter = after.notes.bass!;
  if (![source.identity.root, source.identity.bass, target.identity.root, target.identity.bass,
    bassBefore.pitch, bassAfter.pitch].every(pitch => pitchClassEquals(pitch, low))) return;

  const sourceReading = context.harmony.primaryInterpretation(source);
  const targetReading = context.harmony.primaryInterpretation(target);
  if (sourceReading.status === "ambiguous" || targetReading.status === "ambiguous") return;
  const targetKey = targetReading.status === "resolved" ? targetReading.value.localKey ?? after.key : after.key;
  if (!keyEquals(targetKey, key)) return;

  const sourceTones = chordIdentityToneSpellings(source.identity);
  const frenchTones = chordIdentityToneSpellings(target.identity);
  const voices = activeNotes(before).map(({ voiceId, note }) => ({
    voiceId, from: note, to: after.notes[voiceId]!,
  }));
  if (!soundsCompleteWrittenMembers(sourceTones, voices.map(voice => voice.from)) ||
      !soundsCompleteWrittenMembers(frenchTones, voices.map(voice => voice.to))) return;
  return { sourceTones, frenchTones, voices, bassBefore, bassAfter };
}

// Spasobin §30, example 460. The fifth descends a semitone.
// The other voices may reattack the same written pitches.
export function isGermanToFrenchVoicing(
  context: HarmonyRuleContext, before: AnalysisSlice, after: AnalysisSlice, key: KeyLike,
) {
  const change = frenchVoicingChange(context, before, after, key, "german");
  if (!change) return false;
  return change.voices.every(({ from, to }) => {
    if (!pitchClassEquals(from.pitch, change.sourceTones[2])) return context.pitch.sameWrittenPitch(from, to);
    const descent = writtenInterval(from.pitch, to.pitch);
    return descent.diatonicSteps === -1 && descent.semitones === -1 &&
      pitchClassEquals(to.pitch, change.frenchTones[2]);
  });
}

// The other tonic voice supplies the new second while the remaining
// notes, including both endpoints, continue as the same events.
export function isItalianToFrenchVoicing(
  context: HarmonyRuleContext, before: AnalysisSlice, after: AnalysisSlice, key: KeyLike,
) {
  const change = frenchVoicingChange(context, before, after, key, "italian");
  if (!change) return false;
  const lowBefore = toMidi(change.bassBefore.pitch);
  const lowAfter = toMidi(change.bassAfter.pitch);
  if (change.voices.some(({ from, to }) => toMidi(from.pitch) < lowBefore || toMidi(to.pitch) < lowAfter)) return false;

  const moving = change.voices.filter(({ from, to }) => from.id !== to.id);
  if (moving.length !== 1) return false;
  const [{ voiceId, from, to }] = moving;
  const step = writtenInterval(from.pitch, to.pitch);
  return voiceId !== "bass" && pitchClassEquals(from.pitch, key.tonic) &&
    from.startTick + from.durationTicks === after.tick && to.startTick === after.tick &&
    pitchClassEquals(to.pitch, change.frenchTones[2]) &&
    step.diatonicSteps === 1 && step.semitones === 2;
}
