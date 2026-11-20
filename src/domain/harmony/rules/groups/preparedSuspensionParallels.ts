import {
  chordIdentityEquals, chordToneSpellings, type ChordIdentity, type ChordQuality,
} from "../../../chordModel";
import { pitchClassEquals, toMidi, writtenInterval, type WrittenInterval } from "../../../pitch";
import type { AnalysisSlice, SliceTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "../helpers/core";
import type { VoicePairTransitionFact } from "../sharedFacts";

const landingQualities: readonly ChordQuality[] = ["major", "minor"];
const preparationQualities: readonly ChordQuality[] = [
  ...landingQualities, "diminished", "dominant7", "minor7", "halfDiminished7",
];

function soundedHarmony(slice: AnalysisSlice, landing: boolean) {
  const bass = slice.notes.bass;
  if (!bass) return;
  const voices = activeNotes(slice);
  if (voices.some(({ note }) => toMidi(note.pitch) < toMidi(bass.pitch))) return;
  const qualities = landing ? landingQualities : preparationQualities;
  const declared = slice.chord?.identity;
  const candidates: ChordIdentity[] = declared ? [declared] : voices.flatMap(({ note }) =>
    qualities.map(quality => ({
      root: note.pitch, bass: bass.pitch,
      structure: { kind: "tertian" as const, quality, extensions: [], alterations: [] },
    })),
  );
  for (const identity of candidates) {
    const { structure } = identity;
    if (structure.kind !== "tertian" || !qualities.includes(structure.quality) ||
        structure.extensions.length || structure.alterations.length ||
        !pitchClassEquals(bass.pitch, identity.bass)) continue;
    const tones = chordToneSpellings(identity.root, structure.quality);
    const counts = tones.map(tone => voices.filter(({ note }) => pitchClassEquals(note.pitch, tone)).length);
    if (counts.reduce((sum, n) => sum + n, 0) !== 4) continue;
    const incompleteTonic = landing && structure.quality === slice.key.mode &&
      pitchClassEquals(bass.pitch, slice.key.tonic) && pitchClassEquals(identity.root, bass.pitch) &&
      counts[0] === 3 && counts[1] === 1;
    if (incompleteTonic || counts.every(Boolean)) return { identity, tones };
  }
}

function effectiveKey(context: HarmonyRuleContext, slice: AnalysisSlice) {
  if (!slice.chord) return slice.key;
  const reading = context.harmony.primaryInterpretation(slice.chord);
  if (reading.status === "ambiguous") return;
  return reading.status === "resolved" ? reading.value.localKey ?? slice.key : slice.key;
}

/** Spasobin §36, ex. 36-541–542. Compare the preparation and resolution
 * of one physically held upper note with the same lower voice's descent. */
export function preparedSuspensionParallel(
  context: HarmonyRuleContext,
  { previous, current, contiguous, sameKey }: SliceTransition,
  fact: VoicePairTransitionFact,
  isPerfect: (interval: WrittenInterval) => boolean,
) {
  const [upper, lower] = fact.voiceIds;
  const [held, earlierLower] = fact.previousNotes;
  const [resolution, moved] = fact.currentNotes;
  if (!contiguous || !sameKey || !previous.completeSatb || !current.completeSatb ||
      earlierLower.id !== moved.id || held.id === resolution.id ||
      resolution.startTick !== current.tick || held.startTick + held.durationTicks !== current.tick ||
      held.startTick >= moved.startTick || moved.startTick <= 0) return;
  const step = writtenInterval(held.pitch, resolution.pitch);
  if (step.diatonicSteps !== -1 || (step.semitones !== -1 && step.semitones !== -2) ||
      (held.nonChordToneRole && held.nonChordToneRole !== "suspension")) return;

  const entry = context.sliceAt(moved.startTick);
  const prepared = context.sliceAt(moved.startTick - 1);
  const lowerBefore = prepared?.notes[lower];
  if (!entry?.completeSatb || !prepared?.completeSatb || !lowerBefore ||
      prepared.notes[upper]?.id !== held.id || entry.notes[upper]?.id !== held.id ||
      lowerBefore.startTick + lowerBefore.durationTicks !== entry.tick ||
      activeNotes(current).some(({ voiceId, note }) =>
        note.nonChordToneRole || (voiceId !== upper && entry.notes[voiceId]?.id !== note.id)) ||
      activeNotes(prepared).some(({ voiceId, note }) => voiceId !== upper && note.nonChordToneRole)) return;
  const partnerStep = writtenInterval(lowerBefore.pitch, moved.pitch);
  if (partnerStep.diatonicSteps !== step.diatonicSteps || partnerStep.semitones !== step.semitones ||
      toMidi(held.pitch) <= toMidi(lowerBefore.pitch) || toMidi(held.pitch) <= toMidi(moved.pitch) ||
      toMidi(resolution.pitch) <= toMidi(moved.pitch) ||
      !isPerfect(writtenInterval(lowerBefore.pitch, held.pitch))) return;

  const accent = context.metric.positionAt(entry.tick);
  const release = context.metric.positionAt(current.tick);
  if (!accent || !release || accent.measureNumber !== release.measureNumber ||
      release.beatPosition - accent.beatPosition > 1 || context.metric.compare(accent, release) !== "stronger" ||
      context.analysis.phraseBoundaries.some(boundary =>
        boundary.source === "manual" && prepared.tick < boundary.tick && boundary.tick <= current.tick)) return;

  const from = soundedHarmony(prepared, false);
  const to = soundedHarmony(current, true);
  if (!from || !to || to.tones.some(tone => pitchClassEquals(held.pitch, tone))) return;
  const key = effectiveKey(context, current);
  const prepKey = effectiveKey(context, prepared);
  if (!key || !prepKey || key.mode !== prepKey.mode || !pitchClassEquals(key.tonic, prepKey.tonic)) return;
  if (context.slices({ overlapping: { fromTick: prepared.tick, toTick: current.endTick } }).any(slice => {
    if (slice.key.id !== prepared.key.id) return true;
    if (slice.index === prepared.index || !slice.chord) return false;
    const local = effectiveKey(context, slice);
    return !local || local.mode !== key.mode || !pitchClassEquals(local.tonic, key.tonic) ||
      !chordIdentityEquals(slice.chord.identity, to.identity);
  })) return;

  return { held, lowerBefore, entryTick: entry.tick };
}
