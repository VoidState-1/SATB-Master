import { chordIdentityToneSpellings, type ChordIdentity } from "../../chordModel";
import { pitchClassEquals, spelledPitchEquals } from "../../pitch";
import type { VoiceId } from "../../project/types";
import { VOICE_ORDER } from "../../project/voice";
import type { AnalysisNote } from "../analysis";
import { readWrittenPassingLine, writtenStepDirection, type OrnamentalFrame } from "./ornamentalMotion";

type Frame = Pick<OrnamentalFrame, "tick" | "endTick" | "notes" | "metric">;
type Assignment = Record<string, "passing" | "neighbor">;

/** Read a line between two independently established sonorities. Each
 * interior attack needs its own endpoints, even across a held-note slice. */
export function anchoredFiguration(frames: readonly Frame[], source: ChordIdentity, destination: ChordIdentity) {
  const first = frames[0], last = frames.at(-1)!;
  const tones = chordIdentityToneSpellings(source), landing = chordIdentityToneSpellings(destination);
  const assignments: Assignment = {};
  const member = (n: AnalysisNote) => tones.some(t => pitchClassEquals(t, n.pitch));
  const active = new Set<VoiceId>();
  for (const voice of VOICE_ORDER) {
    const notes: AnalysisNote[] = [];
    for (const frame of frames) {
      const note = frame.notes[voice];
      if (!note) return;
      if (notes.at(-1)?.id !== note.id) notes.push(note);
    }
    for (const [index, note] of notes.entries()) {
      if (index === 0 || note.startTick >= last.tick || member(note)) continue;
      if (voice === "bass") return;
      const before = notes[index - 1], after = notes[index + 1];
      if (!after) return;
      const anchored = (n: AnalysisNote) => !n.nonChordToneRole &&
        (n.startTick >= last.tick ? landing.some(t => pitchClassEquals(t, n.pitch)) : member(n));
      const direction = writtenStepDirection(before, note);
      const neighbor = direction && anchored(before) && anchored(after) && spelledPitchEquals(before.pitch, after.pitch) &&
        writtenStepDirection(note, after) === -direction;
      const role = neighbor ? "neighbor" : "passing";
      if (note.nonChordToneRole && note.nonChordToneRole !== role) return;
      if (!neighbor && !readWrittenPassingLine(note, n => notes[notes.indexOf(n) - 1],
        n => notes[notes.indexOf(n) + 1], anchored, n => !n.nonChordToneRole || n.nonChordToneRole === "passing",
        () => true)) return;
      assignments[note.id] = role;
      active.add(voice);
    }
  }
  if (active.size > 2) return;
  // An independent harmonic attack can coincide with a melodic step. Inside
  // the figure every changed voice must participate in it or revoice a member
  // on a literal structural slice. A re-struck backing chord is a new event.
  for (const frame of frames.slice(1, -1)) {
    const outside = Object.values(frame.notes).filter(n => !member(n));
    if (!outside.length) continue;
    if (outside.some(n => !assignments[n.id]) || frame.metric?.confidence !== "certain" ||
        !first.metric || frame.metric.level >= first.metric.level ||
        VOICE_ORDER.some(v => {
          const n = frame.notes[v]!;
          return n.startTick === frame.tick && !assignments[n.id];
        })) return;
  }
  return assignments;
}
