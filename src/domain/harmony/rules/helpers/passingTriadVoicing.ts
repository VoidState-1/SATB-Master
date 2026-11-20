import { chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { upperPassingMotion } from "../../upperPassingMotion";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { beforeMelodicMinorPassingBass } from "./melodicMinorPassingBass";
import { activeNotes } from "./core";

// Assess the last *structural* four voices when a verified upper passing
// note closes a triad. A role by itself neither supplies nor removes a doubling.
export function structuralTriadVoicing(context: HarmonyRuleContext, end: AnalysisSlice) {
  if (!end.chord || end.attackVoiceIds.length !== 1 ||
      end.notes[end.attackVoiceIds[0]]?.nonChordToneRole !== "passing") return end;
  if (end.attackVoiceIds[0] === "bass") return beforeMelodicMinorPassingBass(context, end) ?? end;
  const left = context.sliceAt(end.tick - 1), right = context.sliceAt(end.endTick);
  if (!left?.chord || left.chord.id !== end.chord.id || !right?.chord ||
      context.analysis.phraseBoundaries.some(b => left.tick < b.tick && b.tick <= right.tick)) return end;
  const structure = end.chord.identity.structure;
  if (structure.kind !== "tertian" || !["major", "minor"].includes(structure.quality)) return end;
  const frame = (s: AnalysisSlice) => ({
    fromTick: s.tick, toTick: s.endTick, key: s.key, activeNotes: s.notes, metric: context.metric.positionAt(s.tick),
  });
  const motion = upperPassingMotion(frame(left), frame(end), frame(right), context.analysis.project.ppq);
  if (!motion) return end;
  const tones = chordIdentityToneSpellings(end.chord.identity);
  const arrival = chordIdentityToneSpellings(right.chord.identity);
  if (!tones.some(t => pitchClassEquals(t, motion.after.pitch)) ||
      !pitchClassEquals(left.notes.bass!.pitch, end.chord.identity.bass) ||
      !pitchClassEquals(right.notes.bass!.pitch, right.chord.identity.bass) ||
      arrival.some(t => pitchClassEquals(t, motion.note.pitch)) ||
      [left, right].some(s => {
        const members = s === left ? tones : arrival;
        const notes = activeNotes(s);
        return notes.some(({ note }) => note.nonChordToneRole || !members.some(t => pitchClassEquals(t, note.pitch))) ||
          !members.every(t => notes.some(({ note }) => pitchClassEquals(t, note.pitch)));
      })) return end;
  return left;
}
