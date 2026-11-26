import { chordIdentityToneSpellingForDegree } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, type SpelledPitchClass } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import { writtenStepDirection } from "../../facts/ornamentalMotion";
import { readWrittenDominantSeventh } from "../../facts/dominantMotion";
import { allowsWrittenTertianIdentity, hasWrittenVoicing, matchesWrittenChord, resolvesInVoice } from "../../facts/tendencyResolution";
import type { RuleStepContext } from "../../runtime";
import { crossesManualPhraseBoundary } from "../helpers/core";

function soundsDeclaredTonicWithTripledRoot(slice: AnalysisSlice, root: SpelledPitchClass) {
  const identity = slice.chord?.identity;
  if (!identity || identity.structure.kind !== "tertian" ||
      !(identity.structure.quality === "major" || identity.structure.quality === "minor") ||
      !allowsWrittenTertianIdentity(slice, root, identity.structure.quality)) return false;
  const third = chordIdentityToneSpellingForDegree(identity, 3);
  return !!third && hasWrittenVoicing(slice, [root, third]) &&
    Object.values(slice.notes).filter(note => pitchClassEquals(note.pitch, root)).length === 3;
}

// Identify the source independently from its resolution, then require a
// written authentic arrival before opening an obligation on an unlabelled seventh.
export function writtenSeventhAtAuthenticDeparture(context: RuleStepContext) {
  const { slice } = context;
  const bass = slice.notes.bass;
  if (!bass || !slice.completeSatb) return;
  const dominant = readWrittenDominantSeventh(slice.notes);
  if (!dominant || dominant.inversion === 3 || !matchesWrittenChord(slice, dominant.root, "dominant7")) return;
  const arrival = context.rules.sliceAt(slice.endTick);
  if (!arrival?.notes.bass || !keyEquals(slice.key, arrival.key) ||
      crossesManualPhraseBoundary(context.rules, slice.tick, arrival.tick)) return;
  const mode = (["major", "minor"] as const).find(quality => matchesWrittenChord(arrival, dominant.target, quality));
  if (!mode && !(dominant.inversion === 2 && soundsDeclaredTonicWithTripledRoot(arrival, dominant.target))) return;
  const rootBass = pitchClassEquals(arrival.notes.bass.pitch, dominant.target);
  if (dominant.inversion === 0) return rootBass ? dominant.seventh : undefined;
  if (slice.key.id !== arrival.key.id || bass.startTick !== slice.tick || slice.attackVoiceIds.length < 2) return;
  if (dominant.inversion === 1) {
    if (rootBass && resolvesInVoice(slice, arrival, "bass", dominant.target, 1)) return dominant.seventh;
    return;
  }
  // In V43 an independent voice must resolve the leading tone while the
  // bass moves 2–1 (I) or 2–3 (I6). The seventh cannot prove its own target.
  if (!VOICE_ORDER.some(v => v !== "bass" && slice.notes[v] && pitchClassEquals(slice.notes[v]!.pitch, dominant.third) &&
      resolvesInVoice(slice, arrival, v, dominant.target, 1))) return;
  const step = writtenStepDirection(bass, arrival.notes.bass, false);
  if (rootBass && step === -1) return dominant.seventh;
  if (!mode || step !== 1) return;
  const key = { tonic: dominant.target, mode };
  const third = scaleDegreePitchClass(key, 3);
  if (!pitchClassEquals(arrival.notes.bass.pitch, third)) return;
  return dominant.seventh;
}

/** An unlabelled V43 can carry the seventh up in the passing I–V43–I6.
 * The obligation opens normally. This exception is established at the
 * landing, in the voice that actually held the source seventh. */
export function writtenPassingSeventhAscends(context: RuleStepContext, voice: VoiceId) {
  const source = context.previous, arrival = context.slice;
  if (!source || source.chord || !source.notes.bass || !arrival.notes.bass) return false;
  const dominant = readWrittenDominantSeventh(source.notes);
  const departing = source.notes[voice], landing = arrival.notes[voice];
  if (dominant?.inversion !== 2 || !departing || !landing || !pitchClassEquals(departing.pitch, dominant.seventh) ||
      !pitchClassEquals(landing.pitch, dominant.root) || writtenStepDirection(departing, landing, false) !== 1) return false;
  const opening = context.rules.sliceAt(source.tick - 1);
  if (!opening?.notes.bass || opening.key.id !== arrival.key.id ||
      crossesManualPhraseBoundary(context.rules, opening.tick, arrival.tick) ||
      !pitchClassEquals(opening.notes.bass.pitch, dominant.target) ||
      writtenStepDirection(opening.notes.bass, source.notes.bass, false) !== 1 ||
      writtenStepDirection(source.notes.bass, arrival.notes.bass, false) !== 1) return false;
  return (["major", "minor"] as const).some(mode => {
    const third = scaleDegreePitchClass({ tonic: dominant.target, mode }, 3);
    return matchesWrittenChord(opening, dominant.target, mode) && matchesWrittenChord(arrival, dominant.target, mode) &&
      pitchClassEquals(arrival.notes.bass!.pitch, third) &&
      Object.values(arrival.notes).filter(n => pitchClassEquals(n.pitch, third)).length === 1;
  });
}
