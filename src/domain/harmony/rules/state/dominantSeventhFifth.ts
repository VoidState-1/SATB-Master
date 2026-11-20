import { chordToneSpellings } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval, type SpelledPitchClass } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import { movesToWrittenTone } from "../../dominantSixthMotion";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import type { ObligationEnvironment } from "./obligation";
import type { LeadingTonePayload } from "./tendency";

function permitsWrittenIdentity(slice: AnalysisSlice, root: SpelledPitchClass, quality: "dominant7" | "major" | "minor") {
  const chord = slice.chord;
  if (!chord) return true;
  const { identity, semantics } = chord;
  const bass = slice.notes.bass;
  if (!bass || !pitchClassEquals(identity.bass, bass.pitch) || !pitchClassEquals(identity.root, root) ||
      identity.structure.kind !== "tertian" || identity.structure.quality !== quality ||
      identity.structure.extensions.length || identity.structure.alterations.length) return false;
  if (!semantics) return true;
  const [reading] = semantics.interpretations;
  return semantics.interpretations.length === 1 && reading.id === semantics.primaryInterpretationId &&
    !semantics.alternatives?.length && !semantics.cadenceRole && !semantics.mixture && !semantics.pedalContext &&
    !reading.designation && !reading.localKey && !reading.appliedTarget &&
    pitchClassEquals(root, scaleDegreePitchClass(slice.key, reading.degree, reading.degreeAlteration));
}

function structuralVoicing(slice: AnalysisSlice) {
  if (!slice.completeSatb) return false;
  let ceiling = Infinity;
  for (const voice of VOICE_ORDER) {
    const note = slice.notes[voice];
    if (!note || note.nonChordToneRole || toMidi(note.pitch) > ceiling) return false;
    ceiling = toMidi(note.pitch);
  }
  return true;
}

/** Spasobin §15.2, ex. 15-204. The home leading pitch was attacked as the fifth
 * of an inverted dominant seventh. All four parts must deliver its written resolution. */
export function homeLeadingToneWasDominantFifth({ context, obligation }: ObligationEnvironment<LeadingTonePayload>) {
  const { previous, slice, rules, transitionFromPrevious } = context;
  const { payload, openedAt, openedBy } = obligation;
  const voice = payload.voiceId;
  const from = previous?.notes[voice], to = slice.notes[voice];
  if (!previous || !from || !to || !transitionFromPrevious?.contiguous || !transitionFromPrevious.sameKey ||
      from.startTick !== openedAt.tick || !openedBy.noteIds?.includes(from.id) || to.startTick !== slice.tick ||
      toMidi(from.pitch) !== payload.leadingMidi ||
      !pitchClassEquals(from.pitch, { step: payload.leadingStep, alter: payload.leadingAlter }) ||
      !pitchClassEquals(slice.key.tonic, { step: payload.targetStep, alter: payload.targetAlter }) ||
      slice.key.mode !== payload.targetMode) return false;
  const outgoing = writtenInterval(from.pitch, to.pitch);
  if (outgoing.diatonicSteps !== -1 || outgoing.semitones !== -2 ||
      !structuralVoicing(slice) || !structuralVoicing(previous)) return false;
  if (crossesManualPhraseBoundary(rules, openedAt.tick, slice.tick)) return false;

  const tonic = to.pitch;
  const root = scaleDegreePitchClass({ tonic, mode: "major" }, 5);
  const tones = chordToneSpellings(root, "dominant7");
  if (!pitchClassEquals(from.pitch, tones[2]) || pitchClassEquals(previous.notes.bass!.pitch, root)) return false;
  const members = VOICE_ORDER.map(v => tones.findIndex(t => pitchClassEquals(previous.notes[v]!.pitch, t)));
  if (members.includes(-1) || new Set(members).size !== 4) return false;

  // A later vertical coincidence cannot reinterpret an obligation inherited from another harmony.
  for (const frame of rules.slices({ overlapping: { fromTick: openedAt.tick, toTick: slice.tick } }).toArray()) {
    if (frame.key.id !== slice.key.id || !permitsWrittenIdentity(frame, root, "dominant7") ||
        !VOICE_ORDER.every(v => {
          const note = frame.notes[v];
          return note && !note.nonChordToneRole && spelledPitchEquals(note.pitch, previous.notes[v]!.pitch);
        })) return false;
  }

  return (["major", "minor"] as const).some(mode => {
    if (!permitsWrittenIdentity(slice, tonic, mode)) return false;
    const third = chordToneSpellings(tonic, mode)[1];
    return VOICE_ORDER.every((v, i) => {
      const before = previous.notes[v]!.pitch, after = slice.notes[v]!.pitch;
      switch (members[i]) {
        case 0: return spelledPitchEquals(before, after);
        case 1: return movesToWrittenTone(before, after, tonic, 1, 1);
        case 2: return movesToWrittenTone(before, after, tonic, -1, -2);
        default: return movesToWrittenTone(before, after, third, -1, mode === "major" ? -1 : -2);
      }
    });
  });
}
