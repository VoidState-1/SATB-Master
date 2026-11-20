import { chordIdentityInversion, chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals, spelledPitchEquals, toMidi, writtenInterval } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";

/** Assess the complete statement when its only weaker change is an upper fifth
 * replaced by the root. The written omission still belongs to the later slice. */
export function continuesCompleteSeventh(context: HarmonyRuleContext, current: AnalysisSlice) {
  const { chord, tick, endTick, attackVoiceIds } = current;
  const bass = current.notes.bass;
  if (!chord || !bass || !current.completeSatb || attackVoiceIds.length !== 1) return false;
  const { structure } = chord.identity;
  if (structure.kind !== "tertian" || structure.extensions.length || structure.alterations.length ||
      (structure.quality !== "dominant7" && structure.quality !== "major7" && structure.quality !== "minor7"))
    return false;
  const inversion = chordIdentityInversion(chord.identity);
  if (inversion !== 1 && inversion !== 3) return false;
  const semantics = chord.semantics;
  if (semantics?.alternatives?.length || semantics?.mixture || semantics?.cadenceRole || semantics?.pedalContext)
    return false;
  const reading = context.harmony.primaryInterpretation(chord);
  const kind = reading.status === "resolved" && reading.value.designation?.kind;
  if (reading.status !== "resolved" || reading.value.appliedTarget ||
      (kind !== "primary" && kind !== "side-degree")) return false;

  const before = context.sliceAt(tick - 1);
  if (!before?.completeSatb || before.chord?.id !== chord.id || before.tick !== chord.startTick ||
      before.endTick !== tick || before.key.id !== current.key.id ||
      endTick - tick > Math.min(tick - before.tick, context.analysis.project.ppq) ||
      context.metric.compare(context.metric.positionAt(before.tick), context.metric.positionAt(tick)) !== "stronger" ||
      context.analysis.phraseBoundaries.some(mark =>
        mark.source === "manual" && before.tick < mark.tick && mark.tick < endTick)) return false;

  const voice = attackVoiceIds[0];
  if (voice === "bass" || !pitchClassEquals(bass.pitch, chord.identity.bass)) return false;
  const from = before.notes[voice]!, to = current.notes[voice]!;
  const tones = chordIdentityToneSpellings(chord.identity);
  if (from.startTick + from.durationTicks !== tick || to.startTick !== tick ||
      !pitchClassEquals(from.pitch, tones[2]) || !pitchClassEquals(to.pitch, tones[0])) return false;
  const leap = writtenInterval(from.pitch, to.pitch);
  if (leap.diatonicSteps !== 3 && leap.diatonicSteps !== -4) return false;

  const lowest = toMidi(bass.pitch);
  return tones.every(tone => VOICE_ORDER.some(part => pitchClassEquals(before.notes[part]!.pitch, tone))) &&
    VOICE_ORDER.every(part => {
      const initial = before.notes[part]!, sustained = current.notes[part]!;
      return !initial.nonChordToneRole && !sustained.nonChordToneRole &&
        toMidi(initial.pitch) >= lowest && toMidi(sustained.pitch) >= lowest &&
        (part === voice || (initial.id === sustained.id && spelledPitchEquals(initial.pitch, sustained.pitch)));
    });
}
