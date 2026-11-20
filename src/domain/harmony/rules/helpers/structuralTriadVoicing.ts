import { chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { upperPassingMotion } from "../../upperPassingMotion";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { triadTailOrnaments } from "./triadTailOrnaments";
import { beforeMelodicMinorPassingBass } from "./melodicMinorPassingBass";
import { soundsCompleteWrittenChord } from "../../writtenVoicing";
import { VOICE_ORDER } from "../../../project/voice";

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
  const frame = (s: AnalysisSlice) => ({
    fromTick: s.tick, toTick: s.endTick, key: s.key, activeNotes: s.notes, metric: context.metric.positionAt(s.tick),
  });
  const motion = upperPassingMotion(frame(left), frame(end), frame(right), context.analysis.project.ppq);
  if (!motion) return;
  const tones = chordIdentityToneSpellings(end.chord.identity);
  if (!tones.some(t => pitchClassEquals(t, motion.after.pitch)) ||
      context.harmony.isWrittenChordTone(motion.note, right.chord) ||
      !soundsCompleteWrittenChord(left.chord.identity, Object.values(left.notes), left.notes.bass!) ||
      !soundsCompleteWrittenChord(right.chord.identity, Object.values(right.notes), right.notes.bass!)) return;
  return { noteIds: [motion.note.id], departure: left };
}

export function triadUpperOrnaments(context: HarmonyRuleContext, slice: AnalysisSlice) {
  return upperPassingVoicing(context, slice) ?? triadTailOrnaments(context, slice);
}

export function structuralTriadVoicing(context: HarmonyRuleContext, end: AnalysisSlice) {
  if (end.attackVoiceIds.length === 1 && end.attackVoiceIds[0] === "bass" &&
      end.notes.bass?.nonChordToneRole === "passing") return beforeMelodicMinorPassingBass(context, end) ?? end;
  return triadUpperOrnaments(context, end)?.departure ?? end;
}
