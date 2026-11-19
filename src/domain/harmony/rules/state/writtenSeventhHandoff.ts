import type { SpelledPitchClass } from "../../../pitch";
import { pitchClassEquals, spelledPitchEquals, writtenInterval } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import type { RuleStepContext } from "../../runtime";

/** Evidence for a direct handoff; chord function and the legality of either motion belong to the caller. */
export function writtenSeventhHandoff(context: RuleStepContext, voice: VoiceId, receiver: VoiceId, seventh: SpelledPitchClass) {
  const { previous, slice, rules } = context;
  const sourceChord = previous?.chord;
  const departure = previous?.notes[voice];
  const landing = slice.notes[voice];
  const partner = previous?.notes[receiver];
  const received = slice.notes[receiver];
  if (!previous || !sourceChord || !departure || !landing || !partner || !received ||
      voice === receiver || previous.endTick !== slice.tick || previous.key.id !== slice.key.id ||
      !previous.completeSatb || !slice.completeSatb ||
      landing.startTick !== slice.tick || received.startTick !== slice.tick ||
      departure.startTick + departure.durationTicks !== slice.tick || partner.startTick + partner.durationTicks !== slice.tick ||
      departure.nonChordToneRole || landing.nonChordToneRole || partner.nonChordToneRole || received.nonChordToneRole ||
      !pitchClassEquals(departure.pitch, seventh) || !pitchClassEquals(received.pitch, seventh) ||
      pitchClassEquals(partner.pitch, seventh) || pitchClassEquals(landing.pitch, seventh)) return;

  if ([previous, slice].some(frame => Object.values(frame.notes)
      .filter(note => note && pitchClassEquals(note.pitch, seventh)).length !== 1)) return;
  if (context.analysis.phraseBoundaries.some(b => b.source === "manual" &&
      departure.startTick < b.tick && b.tick <= slice.tick)) return;
  const fromTick = Math.max(sourceChord.startTick, departure.startTick);
  const frames = rules.slices({ overlapping: { fromTick, toTick: slice.tick } });
  if (!frames.toArray().every(frame => {
    const note = frame.notes[receiver];
    return note && !note.nonChordToneRole && spelledPitchEquals(note.pitch, partner.pitch);
  })) return;

  return { departure, landing, partner, received,
    outgoing: writtenInterval(departure.pitch, landing.pitch), incoming: writtenInterval(partner.pitch, received.pitch) };
}
