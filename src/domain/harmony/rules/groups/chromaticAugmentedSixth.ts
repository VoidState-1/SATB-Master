import { chordIdentityEquals, chordIdentityToneSpellings, type ChordIdentity } from "../../../chordModel";
import {
  keyEquals,
  isWrittenStep, pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  writtenInterval,
  type KeyLike,
  type SpelledPitchClass,
} from "../../../pitch";
import type { AnalysisNote, AnalysisSlice, MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "../helpers/core";

function exactlyVoiced(slice: AnalysisSlice, tones: readonly SpelledPitchClass[]) {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass) return false;
  const notes = activeNotes(slice);
  const bassMidi = toMidi(bass.pitch);
  return notes.every(({ voiceId, note }) =>
    !note.nonChordToneRole &&
    (voiceId === "bass" || toMidi(note.pitch) > bassMidi) &&
    tones.some(tone => pitchClassEquals(note.pitch, tone)),
  ) &&
    tones.every(tone => notes.some(({ note }) => pitchClassEquals(note.pitch, tone)));
}

function resolvesEndpoint(
  previous: AnalysisNote,
  current: AnalysisNote,
  dominant: SpelledPitchClass,
  direction: 1 | -1,
) {
  const motion = writtenInterval(previous.pitch, current.pitch);
  return current.startTick === previous.startTick + previous.durationTicks &&
    pitchClassEquals(current.pitch, dominant) &&
    motion.diatonicSteps === direction && motion.semitones === direction;
}

function tertianIdentity(root: SpelledPitchClass, quality: "minor" | "major" | "dominant7", bass = root): ChordIdentity {
  return { root, bass, structure: { kind: "tertian", quality, extensions: [], alterations: [] } };
}

function agreesWithGermanCadence(
  context: HarmonyRuleContext, slice: AnalysisSlice, identity: ChordIdentity, key?: KeyLike,
) {
  if (!slice.chord) return true;
  if (!chordIdentityEquals(slice.chord.identity, identity)) return false;
  const reading = context.harmony.primaryInterpretation(slice.chord);
  if (reading.status === "ambiguous") return false;
  if (!key || reading.status !== "resolved") return true;
  const { localKey, appliedTarget } = reading.value;
  return !appliedTarget && (!localKey || keyEquals(localKey, key));
}

function hasFollowingRootPositionDominant(
  context: HarmonyRuleContext, landing: AnalysisSlice, sourceTick: number, key: KeyLike, cadential: ChordIdentity,
  voice: MelodyTransition["voiceId"],
) {
  const bass = landing.notes.bass!;
  const metric = context.metric.positionAt(landing.tick);
  const measure = metric && context.analysis.metricTimeline.measures[metric.measureNumber - 1];
  if (!measure) return false;
  // Look only as far as the end or first reattack of this bass note, and
  // at most two written beats from the complete six-four.
  const end = Math.min(bass.startTick + bass.durationTicks, landing.tick + 2 * measure.beatLength);
  const arriving = landing.notes[voice]!;
  let passing: AnalysisNote | undefined;
  for (const slice of context.slices({ overlapping: { fromTick: landing.tick + 1, toTick: end + 1 } })) {
    if (slice.tick <= landing.tick) continue;
    const nextBass = slice.notes.bass;
    if (!nextBass || !pitchClassEquals(nextBass.pitch, bass.pitch) ||
        Math.abs(toMidi(nextBass.pitch) - toMidi(bass.pitch)) > 12) return false;
    if (context.analysis.project.keyEvents.some(event =>
      sourceTick < event.tick && event.tick <= slice.tick && !keyEquals(event, landing.key)) ||
      context.analysis.phraseBoundaries.some(boundary =>
        !boundary.stale && sourceTick < boundary.tick && boundary.tick <= slice.tick)) return false;

    const dominant = [tertianIdentity(bass.pitch, "major"), tertianIdentity(bass.pitch, "dominant7")];
    if (dominant.some(identity => exactlyVoiced(slice, chordIdentityToneSpellings(identity)) &&
        agreesWithGermanCadence(context, slice, identity, key))) {
      if (!passing) return true;
      const next = slice.notes[voice]!;
      const step = writtenInterval(passing.pitch, next.pitch);
      return next.startTick === passing.startTick + passing.durationTicks && step.diatonicSteps === 1 && isWrittenStep(step);
    }
    if (nextBass.id !== bass.id || !agreesWithGermanCadence(context, slice, cadential, key)) return false;
    if (!passing && exactlyVoiced(slice, chordIdentityToneSpellings(cadential))) continue;
    // A raised sixth can pass between the resolved fifth and the leading tone
    // while the other three parts sustain the six-four in the same register.
    const note = slice.notes[voice];
    if (!note || (note.nonChordToneRole && note.nonChordToneRole !== "passing") ||
        (passing && note.id !== passing.id) || note.startTick !== arriving.startTick + arriving.durationTicks ||
        !movesUpWholeStep(arriving, note) ||
        activeNotes(landing).some(part => part.voiceId !== voice &&
          (!slice.notes[part.voiceId] || !context.pitch.sameWrittenPitch(part.note, slice.notes[part.voiceId]!)))) return false;
    passing = note;
  }
  return false;
}

function movesUpWholeStep(previous: AnalysisNote, current: AnalysisNote) {
  const step = writtenInterval(previous.pitch, current.pitch);
  return step.diatonicSteps === 1 && step.semitones === 2;
}

// Spasobin ch. 30 §§3–4, ex. 30-452 and 456: preparation and resolution
// of altered double dominants. Require the written VI–Ger+6–K46–V
// setting before accepting this melodic diminished third.
export function resolvesGermanSixthDiminishedThird(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { previous, current, voiceId, writtenInterval: entry } = transition;
  if (!transition.contiguous || !transition.sameKey || voiceId === "bass" ||
      entry.diatonicSteps !== -2 || entry.semitones !== -2 ||
      previous.nonChordToneRole || current.nonChordToneRole) return false;

  const onset = current.startTick;
  const arrival = onset + current.durationTicks;
  const before = context.sliceAt(onset - 1);
  const middle = context.sliceAt(onset);
  const landing = context.sliceAt(arrival);
  const beforeBass = before?.notes.bass;
  const middleBass = middle?.notes.bass;
  const landingBass = landing?.notes.bass;
  const arriving = landing?.notes[voiceId];
  if (!before || !middle || !landing || !beforeBass || !middleBass || !landingBass || !arriving ||
      before.notes[voiceId]?.id !== previous.id || middle.notes[voiceId]?.id !== current.id) return false;

  // The K46 bass is the dominant of the local destination, even when the
  // printed key has not changed. Spell the tonic a fourth above that bass.
  const fifth = landingBass.pitch;
  const tonic = scaleDegreePitchClass({ tonic: fifth, mode: "major" }, 4);
  const key = { tonic, mode: "minor" } as const;
  const sixth = scaleDegreePitchClass(key, 6);
  if (!pitchClassEquals(previous.pitch, sixth) ||
      !pitchClassEquals(current.pitch, scaleDegreePitchClass(key, 4, 1))) return false;

  const preparation = tertianIdentity(sixth, "major", beforeBass.pitch);
  if (!exactlyVoiced(before, chordIdentityToneSpellings(preparation)) ||
      !agreesWithGermanCadence(context, before, preparation)) return false;

  const german: ChordIdentity = { root: sixth, bass: sixth, structure: { kind: "augmented-sixth", variant: "german" } };
  const germanTones = chordIdentityToneSpellings(german);
  const germanVoicing = activeNotes(middle);
  if (context.slices({ overlapping: { fromTick: onset, toTick: arrival } }).any(slice =>
    !pitchClassEquals(slice.notes.bass?.pitch ?? fifth, sixth) ||
    !exactlyVoiced(slice, germanTones) || !agreesWithGermanCadence(context, slice, german, key) ||
    germanVoicing.some(({voiceId: part, note}) => {
      const active = slice.notes[part];
      return !active || !context.pitch.sameWrittenPitch(note, active);
    }))) return false;

  const cadential = tertianIdentity(tonic, "minor", fifth);
  const role = landing.chord?.semantics?.cadenceRole;
  if ((role && role !== "cadential64") ||
      !exactlyVoiced(landing, chordIdentityToneSpellings(cadential)) ||
      !agreesWithGermanCadence(context, landing, cadential, key)) return false;

  const bassBeforeLanding = context.sliceAt(arrival - 1)?.notes.bass;
  if (!bassBeforeLanding || !resolvesEndpoint(bassBeforeLanding, landingBass, fifth, -1) ||
      !resolvesEndpoint(current, arriving, fifth, 1)) return false;
  for (const { voiceId: part, note } of germanVoicing) {
    if (part === "bass" || part === voiceId) continue;
    const common = landing.notes[part];
    if (!common || !context.pitch.sameWrittenPitch(note, common)) return false;
  }
  return hasFollowingRootPositionDominant(context, landing, previous.startTick, key, cadential, voiceId);
}
