import { chordToneSpellings } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, toMidi, type SpelledPitchClass } from "../../../pitch";
import type { VoiceId } from "../../../project";
import type { AnalysisSlice } from "../../analysis";
import { readWrittenDominantSeventh } from "../../writtenDominantSeventh";
import { hasWrittenVoicing } from "../../writtenResolution";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import { leadingToneResolutionKey } from "./leadingToneTarget";
import type { ObligationEnvironment } from "./obligation";
import type { LeadingTonePayload } from "./tendency";

function soundingDominantQuality(frame: AnalysisSlice, root: SpelledPitchClass) {
  const bass = frame.notes.bass;
  if (!frame.completeSatb || !bass) return;
  const lowest = toMidi(bass.pitch);
  if (Object.values(frame.notes).some(note => note.nonChordToneRole || toMidi(note.pitch) < lowest)) return;
  const seventh = readWrittenDominantSeventh(frame.notes);
  if (seventh && pitchClassEquals(seventh.root, root)) return "dominant7";
  if (hasWrittenVoicing(frame, chordToneSpellings(root, "major"))) return "major";
}

/** A reciprocal exchange of two written members can hand the dominant's
 * third to a different part even when one of the two frames has no label. */
export function transfersLeadingToneInWrittenDominant(
  { context, obligation }: ObligationEnvironment<LeadingTonePayload>, receivers: readonly VoiceId[],
) {
  const { previous, slice, rules, transitionFromPrevious } = context;
  if (receivers.length !== 1 || !previous || (previous.chord && slice.chord) ||
      !transitionFromPrevious?.contiguous) return false;

  const { payload, openedAt, openedBy } = obligation;
  const voice = payload.voiceId, receiver = receivers[0], tick = slice.tick;
  const leaving = previous.notes[voice], arriving = slice.notes[voice];
  const partner = previous.notes[receiver], received = slice.notes[receiver];
  if (!leaving || !arriving || !partner || !received || !openedBy.noteIds?.includes(leaving.id) ||
      leaving.startTick + leaving.durationTicks !== tick || partner.startTick + partner.durationTicks !== tick ||
      arriving.startTick !== tick || received.startTick !== tick ||
      !pitchClassEquals(arriving.pitch, partner.pitch) ||
      crossesManualPhraseBoundary(rules, openedAt.tick, tick)) return false;

  const target = { tonic: { step: payload.targetStep, alter: payload.targetAlter }, mode: payload.targetMode };
  const third = { step: payload.leadingStep, alter: payload.leadingAlter };
  if (!pitchClassEquals(leaving.pitch, third) || toMidi(leaving.pitch) !== payload.leadingMidi) return false;
  const root = scaleDegreePitchClass(target, 5);

  // Include the opening of this particular obligation and its actual landing.
  // A later return to the same chord cannot rescue a different opening.
  return rules.slices({ overlapping: { fromTick: openedAt.tick, toTick: tick + 1 } }).all(frame => {
    const quality = soundingDominantQuality(frame, root);
    if (!quality || !keyEquals(frame.key, slice.key) ||
        Object.values(frame.notes).filter(note => pitchClassEquals(note.pitch, third)).length !== 1) return false;
    const { chord } = frame;
    if (chord) {
      const { identity, semantics } = chord;
      if (identity.structure.kind !== "tertian" || identity.structure.quality !== quality ||
          identity.structure.alterations.length || identity.structure.extensions.length ||
          !pitchClassEquals(identity.root, root) || !pitchClassEquals(identity.bass, frame.notes.bass!.pitch) ||
          semantics?.pedalContext || semantics?.cadenceRole || semantics?.mixture || semantics?.alternatives?.length ||
          (semantics && rules.harmony.primaryInterpretation(chord).status !== "resolved")) return false;
    }
    return keyEquals(leadingToneResolutionKey(frame, rules.harmony), target);
  });
}
