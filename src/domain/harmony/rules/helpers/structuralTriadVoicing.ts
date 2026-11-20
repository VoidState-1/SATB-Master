import { chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { decoratedPassingSixFourMotion } from "../../decoratedPassingSixFourMotion";
import { upperPassingMotion } from "../../upperPassingMotion";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { triadTailOrnaments } from "./triadTailOrnaments";
import { beforeMelodicMinorPassingBass } from "./melodicMinorPassingBass";
import { soundsCompleteWrittenChord } from "../../writtenVoicing";
import { VOICE_ORDER } from "../../../project/voice";

function frame(context: HarmonyRuleContext, slice: AnalysisSlice) {
  return {
    fromTick: slice.tick, toTick: slice.endTick, key: slice.key, activeNotes: slice.notes,
    metric: context.metric.positionAt(slice.tick),
  };
}

// A labelled passing tone can precede a harmony change. Without a label,
// require the same written triad and three held parts through the arrival.
function upperPassingVoicing(context: HarmonyRuleContext, end: AnalysisSlice) {
  if (!end.chord || end.attackVoiceIds.length !== 1) return;
  const [voice] = end.attackVoiceIds;
  const note = end.notes[voice];
  if (voice === "bass" || !note || (note.nonChordToneRole && note.nonChordToneRole !== "passing")) return;
  const left = context.sliceAt(end.tick - 1);
  const right = context.sliceAt(end.endTick);
  if (!left?.chord || left.chord.id !== end.chord.id || !right?.chord ||
      context.analysis.phraseBoundaries.some(b => left.tick < b.tick && b.tick <= right.tick)) return;
  const structure = end.chord.identity.structure;
  if (structure.kind !== "tertian" || !["major", "minor"].includes(structure.quality)) return;
  if (!note.nonChordToneRole && (right.chord.id !== end.chord.id || structure.extensions.length ||
      structure.alterations.length || VOICE_ORDER.some(part =>
        part !== voice && end.notes[part]?.id !== right.notes[part]?.id))) return;
  const motion = upperPassingMotion(frame(context, left), frame(context, end), frame(context, right), context.analysis.project.ppq);
  if (!motion) return;
  const tones = chordIdentityToneSpellings(end.chord.identity);
  if (!tones.some(t => pitchClassEquals(t, motion.after.pitch)) ||
      context.harmony.isWrittenChordTone(motion.note, right.chord) ||
      !soundsCompleteWrittenChord(left.chord.identity, Object.values(left.notes), left.notes.bass!) ||
      !soundsCompleteWrittenChord(right.chord.identity, Object.values(right.notes), right.notes.bass!)) return;
  return { noteIds: [motion.note.id], departure: left };
}

export function decoratedPassingVoicing(context: HarmonyRuleContext, ornament: AnalysisSlice) {
  if (!ornament.chord || ornament.attackVoiceIds.length !== 1 ||
      ornament.notes[ornament.attackVoiceIds[0]]?.nonChordToneRole !== "passing") return;
  const left = context.sliceAt(ornament.tick - 1);
  const sixFour = context.sliceAt(ornament.endTick);
  const right = sixFour && context.sliceAt(sixFour.endTick);
  if (left?.chord?.id !== ornament.chord.id || sixFour?.chord?.semantics?.cadenceRole !== "passing64" ||
      !right?.chord || context.analysis.phraseBoundaries.some(b => left.tick < b.tick && b.tick <= right.tick)) return;
  const motion = decoratedPassingSixFourMotion(
    { ...frame(context, left), identity: left.chord.identity }, frame(context, ornament),
    { ...frame(context, sixFour), identity: sixFour.chord.identity }, { ...frame(context, right), identity: right.chord.identity },
    context.analysis.project.ppq,
  );
  return motion && { noteIds: [motion.note.id], departure: left };
}

export function triadUpperOrnaments(context: HarmonyRuleContext, slice: AnalysisSlice) {
  return upperPassingVoicing(context, slice) ?? decoratedPassingVoicing(context, slice) ?? triadTailOrnaments(context, slice);
}

export function structuralTriadVoicing(context: HarmonyRuleContext, end: AnalysisSlice) {
  if (end.attackVoiceIds.length === 1 && end.attackVoiceIds[0] === "bass" &&
      end.notes.bass?.nonChordToneRole === "passing") return beforeMelodicMinorPassingBass(context, end) ?? end;
  return triadUpperOrnaments(context, end)?.departure ?? end;
}
