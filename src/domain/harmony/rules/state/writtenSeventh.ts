import { chordIdentityEqualsWithoutBass, chordIdentityToneSpellingForDegree, chordToneSpellings } from "../../../chordModel";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, type SpelledPitchClass } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import { writtenStepDirection } from "../../facts/ornamentalMotion";
import { readWrittenDominantSeventh } from "../../facts/dominantMotion";
import { readCompleteWrittenChord, readSoundingTertianIdentity } from "../../facts/writtenVoicing";
import { allowsWrittenTertianIdentity, hasWrittenVoicing, leadingSeventhMemberResolves, matchesWrittenChord, resolvesInVoice } from "../../facts/tendencyResolution";
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

function leadingVoiceResolves(source: AnalysisSlice, arrival: AnalysisSlice, leading: SpelledPitchClass, target: SpelledPitchClass) {
  return VOICE_ORDER.some(voice => pitchClassEquals(source.notes[voice]!.pitch, leading) &&
    resolvesInVoice(source, arrival, voice, target, 1));
}

// If the seventh leaps outside the triad, the three other parts must spell
// the entire destination themselves. A competing written chord wins.
function independentTriad(source: AnalysisSlice, arrival: AnalysisSlice, seventh: SpelledPitchClass,
  target: SpelledPitchClass, quality: "major" | "minor") {
  if (matchesWrittenChord(arrival, target, quality)) return true;
  if (!allowsWrittenTertianIdentity(arrival, target, quality) || readSoundingTertianIdentity(arrival)) return false;
  const bass = arrival.notes.bass!;
  if (Object.values(arrival.notes).some(n => n.nonChordToneRole || toMidi(n.pitch) < toMidi(bass.pitch))) return false;
  const others = VOICE_ORDER.filter(v => !pitchClassEquals(source.notes[v]!.pitch, seventh));
  return chordToneSpellings(target, quality).every(t => others.some(v => pitchClassEquals(arrival.notes[v]!.pitch, t)));
}

// A reattack of an unchanged pitch can divide a chord. Locate the entry
// of the sounding voicing before deciding whether it is a harmonic attack.
function hasWrittenEntry(context: RuleStepContext) {
  let entry = context.slice;
  let before = context.previous;
  while (before?.completeSatb && before.chord?.id === entry.chord?.id && before.key.id === entry.key.id &&
      VOICE_ORDER.every(v => spelledPitchEquals(before!.notes[v]!.pitch, entry.notes[v]!.pitch))) {
    if (crossesManualPhraseBoundary(context.rules, before.tick, entry.tick)) return false;
    entry = before;
    before = context.rules.sliceAt(entry.tick - 1);
  }
  return entry.notes.bass?.startTick === entry.tick && entry.attackVoiceIds.length >= 2 &&
    entry.attackVoiceIds.filter(v => !before?.notes[v] || !spelledPitchEquals(before.notes[v]!.pitch, entry.notes[v]!.pitch)).length >= 2;
}

function dominantSeventhAtDeparture(context: RuleStepContext, arrival: AnalysisSlice,
  dominant: NonNullable<ReturnType<typeof readWrittenDominantSeventh>>) {
  const slice = context.slice, bass = slice.notes.bass!;
  if (!matchesWrittenChord(slice, dominant.root, "dominant7")) return;
  const landingBass = arrival.notes.bass!;
  const rootBass = pitchClassEquals(landingBass.pitch, dominant.target);
  const invertedTarget = dominant.inversion === 0 && !rootBass && !pitchClassEquals(dominant.target, slice.key.tonic);
  const mode = (["major", "minor"] as const).find(quality => dominant.inversion === 3 || invertedTarget
    ? independentTriad(slice, arrival, dominant.seventh, dominant.target, quality)
    : matchesWrittenChord(arrival, dominant.target, quality));
  if (!mode && !(dominant.inversion === 2 && soundsDeclaredTonicWithTripledRoot(arrival, dominant.target))) return;
  if (dominant.inversion === 0 && rootBass) return dominant.seventh;
  if (slice.key.id !== arrival.key.id) return;
  if (dominant.inversion === 3 || dominant.inversion === 0) {
    if (!mode || !hasWrittenEntry(context) || !leadingVoiceResolves(slice, arrival, dominant.third, dominant.target)) return;
    if (dominant.inversion === 3) return dominant.seventh;
    if (invertedTarget && chordToneSpellings(dominant.target, mode).slice(1)
        .some(tone => pitchClassEquals(landingBass.pitch, tone))) return dominant.seventh;
    return;
  }
  if (bass.startTick !== slice.tick || slice.attackVoiceIds.length < 2) return;
  if (dominant.inversion === 1) {
    if (rootBass && resolvesInVoice(slice, arrival, "bass", dominant.target, 1)) return dominant.seventh;
    return;
  }
  // In V43 an independent voice must resolve the leading tone while the
  // bass moves 2–1 (I) or 2–3 (I6). The seventh cannot prove its own target.
  if (!leadingVoiceResolves(slice, arrival, dominant.third, dominant.target)) return;
  const step = writtenStepDirection(bass, landingBass, false);
  if (rootBass && step === -1) return dominant.seventh;
  if (!mode || step !== 1) return;
  const key = { tonic: dominant.target, mode };
  const third = scaleDegreePitchClass(key, 3);
  if (!pitchClassEquals(landingBass.pitch, third)) return;
  return dominant.seventh;
}

export function writtenSeventhAtAuthenticDeparture(context: RuleStepContext) {
  const { slice } = context;
  const arrival = context.rules.sliceAt(slice.endTick);
  if (!slice.completeSatb || !arrival?.completeSatb ||
      !keyEquals(slice.key, arrival.key) || crossesManualPhraseBoundary(context.rules, slice.tick, arrival.tick)) return;
  const dominant = readWrittenDominantSeventh(slice.notes);
  if (dominant) {
    const tone = dominantSeventhAtDeparture(context, arrival, dominant);
    return tone && { tone, quality: "dominant7" as const };
  }
  if (slice.key.id !== arrival.key.id) return;
  const { tonic, mode } = slice.key;
  const leading = leadingTonePitchClass(slice.key);
  const quality = (["diminished7", "halfDiminished7"] as const).find(q => matchesWrittenChord(slice, leading, q));
  if (!quality) return;
  const tones = chordToneSpellings(leading, quality);
  const [root, third, , tone] = tones;
  const bass = slice.notes.bass!.pitch;
  if ((!pitchClassEquals(bass, root) && !pitchClassEquals(bass, third)) || !hasWrittenEntry(context) ||
      !leadingVoiceResolves(slice, arrival, leading, tonic)) return;
  if (!independentTriad(slice, arrival, tone, tonic, mode)) {
    // A failed seventh can remove the only fifth from the textbook landing.
    // The other three voices must carry out all three prescribed motions.
    const triad = chordToneSpellings(tonic, mode);
    if (!allowsWrittenTertianIdentity(arrival, tonic, mode) || !hasWrittenVoicing(arrival, triad.slice(0, 2)) ||
        !VOICE_ORDER.every(v => pitchClassEquals(slice.notes[v]!.pitch, tone) ||
          leadingSeventhMemberResolves(slice.notes[v]!.pitch, arrival.notes[v]!.pitch, tones, triad))) return;
  }
  return { tone, quality };
}

/** A third or fifth can exchange with the seventh while the same four
 * written members continue. The new seventh has its own voice obligation. */
export function writtenSeventhChangesVoice(context: RuleStepContext, voice: VoiceId) {
  const before = context.previous, after = context.slice;
  if (!before || before.key.id !== after.key.id || !after.attackVoiceIds.includes(voice)) return false;
  const from = readCompleteWrittenChord(before);
  const seventh = from && chordIdentityToneSpellingForDegree(from, 7);
  if (!from || !seventh || !pitchClassEquals(before.notes[voice]!.pitch, seventh)) return false;
  const to = readCompleteWrittenChord(after);
  if (!to || !chordIdentityEqualsWithoutBass(from, to)) return false;
  const leaving = after.notes[voice]!.pitch;
  if (pitchClassEquals(leaving, from.root) || pitchClassEquals(leaving, seventh)) return false;
  return after.attackVoiceIds.some(other => other !== voice && pitchClassEquals(before.notes[other]!.pitch, leaving) &&
    pitchClassEquals(after.notes[other]!.pitch, seventh));
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
