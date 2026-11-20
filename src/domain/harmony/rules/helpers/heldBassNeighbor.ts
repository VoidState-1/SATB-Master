import { chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals, toMidi } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import type { AnalysisNote, AnalysisSlice } from "../../analysis";
import { returnsByWrittenStep } from "../../writtenNeighbors";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../groups/dominantSixthSubstitution";

const upperVoices = ["soprano", "alto", "tenor"] as const;

function labelSupports(slice: AnalysisSlice, support: readonly AnalysisNote[], bass: AnalysisNote) {
  const identity = slice.chord?.identity;
  if (!identity) return true;
  const tones = chordIdentityToneSpellings(identity);
  return identity.structure.kind === "tertian" && pitchClassEquals(bass.pitch, identity.bass) &&
    tones.every(tone => support.some(note => pitchClassEquals(note.pitch, tone))) &&
    support.every(note => tones.some(tone => pitchClassEquals(note.pitch, tone)));
}

/** Chapter 40 §§1–4: a weak lower semitone in the bass may decorate a sustained harmony. */
export function bassNeighborAgainstHeldUpper(
  context: HarmonyRuleContext,
  neighbor: AnalysisNote,
  heldVoice: VoiceId,
  held: AnalysisNote,
) {
  const start = neighbor.startTick;
  const end = start + neighbor.durationTicks;
  if (heldVoice === "bass" || held.startTick >= start || held.startTick + held.durationTicks <= end ||
      held.pitch.step !== neighbor.pitch.step || Math.abs(held.pitch.alter - neighbor.pitch.alter) !== 1 ||
      held.pitch.octave <= neighbor.pitch.octave) return false;

  const before = context.sliceAt(start - 1);
  const after = context.sliceAt(end);
  const first = before?.notes.bass;
  const last = after?.notes.bass;
  if (!before?.completeSatb || !after?.completeSatb || !first || !last ||
      before.notes[heldVoice]?.id !== held.id ||
      toMidi(first.pitch) - toMidi(neighbor.pitch) !== 1 ||
      !returnsByWrittenStep(first, neighbor, last) ||
      crossesManualPhraseBoundary(context, before.tick, end)) return false;

  const position = context.metric.positionAt(start);
  const accent = context.metric.strongestBetween(start, end);
  if (!position || position.level === 3 || accent?.level === 3) return false;

  const support = Object.values(before.notes);
  if (support.some(note => note.nonChordToneRole || (note.id !== first.id && toMidi(note.pitch) <= toMidi(first.pitch))) ||
      !hasCompleteWrittenTertianVoicing(support.map(note => note.pitch)) ||
      !labelSupports(before, support, first)) return false;

  const maintainsHarmony = (slice: AnalysisSlice) => slice.key.id === before.key.id &&
    upperVoices.every(voice => slice.notes[voice]?.id === before.notes[voice]?.id) &&
    labelSupports(slice, support, first);
  return maintainsHarmony(after) &&
    context.slices({ overlapping: { fromTick: start, toTick: end } })
      .all(slice => slice.notes.bass?.id === neighbor.id && maintainsHarmony(slice));
}
