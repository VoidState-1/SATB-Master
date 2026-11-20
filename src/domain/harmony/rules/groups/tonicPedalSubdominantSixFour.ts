import { chordToneSpellings, type ChordQuality } from "../../../chordModel";
import { VOICE_ORDER } from "../../../project/voice";
import {
  pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval,
  type KeyLike, type SpelledPitchClass,
} from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { movesToWrittenTone } from "../../dominantSixthMotion";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";

function matchingWrittenChord(
  context: HarmonyRuleContext, slice: AnalysisSlice, key: KeyLike,
  root: SpelledPitchClass, quality: ChordQuality, degree: 1 | 4 | 5,
) {
  const { chord } = slice;
  if (!chord) return true;
  const { identity, semantics } = chord;
  const { structure } = identity;
  if (structure.kind !== "tertian" || structure.quality !== quality ||
      structure.extensions.length || structure.alterations.length ||
      !pitchClassEquals(identity.root, root) || !pitchClassEquals(identity.bass, key.tonic) ||
      semantics?.cadenceRole) return false;

  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return reading.status === "unavailable";
  const { localKey = slice.key, appliedTarget, degreeAlteration } = reading.value;
  return localKey.mode === key.mode && pitchClassEquals(localKey.tonic, key.tonic) &&
    reading.value.degree === degree && degreeAlteration === 0 &&
    (degree === 5 ? appliedTarget?.degree === 4 : !appliedTarget);
}

function writtenMembers(slice: AnalysisSlice, tones: readonly SpelledPitchClass[]) {
  return VOICE_ORDER.map(voice =>
    tones.findIndex(tone => pitchClassEquals(slice.notes[voice]!.pitch, tone)));
}

function isShortWeakPosition(context: HarmonyRuleContext, slice: AnalysisSlice) {
  const position = context.metric.positionAt(slice.tick);
  return (position?.role === "weak-beat" || position?.role === "subdivision") &&
    slice.endTick - slice.tick <= context.analysis.project.ppq;
}

/** Spasobin ch. 48 §§2–5: a short subdominant tonicization within a tonic pedal.
 * Both written tonic anchors and the actual resolution are required. */
export function hasSubdominantSixFourOnTonicPedal(context: HarmonyRuleContext, middle: AnalysisSlice) {
  const source = context.sliceAt(middle.tick - 1);
  const anchor = source && context.sliceAt(source.tick - 1);
  const returnToTonic = context.sliceAt(middle.endTick);
  const bass = middle.notes.bass;
  if (!source || !anchor || !returnToTonic || !bass || !middle.chord ||
      crossesManualPhraseBoundary(context, anchor.tick, returnToTonic.tick) ||
      !isShortWeakPosition(context, source) || !isShortWeakPosition(context, middle)) return false;

  const frames = [anchor, source, middle, returnToTonic];
  if (frames.some(slice => !slice.completeSatb || slice.notes.bass?.id !== bass.id ||
      slice.key.id !== middle.key.id || VOICE_ORDER.some(voice => {
        const note = slice.notes[voice]!;
        return note.nonChordToneRole || toMidi(note.pitch) < toMidi(bass.pitch);
      }))) return false;

  const reading = context.harmony.primaryInterpretation(middle.chord);
  const key = reading.status === "resolved" ? reading.value.localKey ?? middle.key : middle.key;
  if (!pitchClassEquals(bass.pitch, key.tonic)) return false;
  const tonicQuality = key.mode === "major" ? "major" : "minor";
  const subdominant = scaleDegreePitchClass(key, 4);
  if (!matchingWrittenChord(context, anchor, key, key.tonic, tonicQuality, 1) ||
      !matchingWrittenChord(context, source, key, key.tonic, "dominant7", 5) ||
      !matchingWrittenChord(context, middle, key, subdominant, "minor", 4) ||
      !matchingWrittenChord(context, returnToTonic, key, key.tonic, tonicQuality, 1)) return false;

  const tonicTones = chordToneSpellings(key.tonic, tonicQuality);
  const appliedTones = chordToneSpellings(key.tonic, "dominant7");
  const subdominantTones = chordToneSpellings(subdominant, "minor");
  const prepared = writtenMembers(anchor, tonicTones);
  const applied = writtenMembers(source, appliedTones);
  const middleMembers = writtenMembers(middle, subdominantTones);
  const resolved = writtenMembers(returnToTonic, tonicTones);
  if (prepared.includes(-1) || !prepared.includes(1) ||
      applied.includes(-1) || !applied.includes(1) || !applied.includes(3) ||
      resolved.includes(-1) || !resolved.includes(1) || !resolved.includes(2)) return false;

  const upperPedal = applied.findIndex((member, index) => member === 0 && VOICE_ORDER[index] !== "bass");
  if (upperPedal < 0) return false;
  const pedal = VOICE_ORDER[upperPedal];
  if (frames.some(slice => !spelledPitchEquals(slice.notes[pedal]!.pitch, anchor.notes[pedal]!.pitch))) return false;

  const leadingVoice = VOICE_ORDER[applied.indexOf(1)];
  const seventhVoice = VOICE_ORDER[applied.indexOf(3)];
  return middleMembers[upperPedal] === 2 &&
    movesToWrittenTone(source.notes[leadingVoice]!.pitch, middle.notes[leadingVoice]!.pitch, subdominantTones[0], 1, 1) &&
    movesToWrittenTone(source.notes[seventhVoice]!.pitch, middle.notes[seventhVoice]!.pitch, subdominantTones[1], -1, -2) &&
    [leadingVoice, seventhVoice].every(voice => {
      const interval = writtenInterval(middle.notes[voice]!.pitch, returnToTonic.notes[voice]!.pitch);
      return interval.diatonicSteps === -1 && (interval.semitones === -1 || interval.semitones === -2);
    });
}
