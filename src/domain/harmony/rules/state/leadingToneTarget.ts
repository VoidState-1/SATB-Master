import { chordToneSpellings, type ChordIdentity } from "../../../chordModel";
import {
  keyEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass,
  stepIndex, writtenInterval, type KeyLike, type SpelledPitchClass,
} from "../../../pitch";
import { VOICE_ORDER } from "../../../project";
import { readWrittenDominantSeventh } from "../../writtenDominantSeventh";
import { allowsWrittenTertianIdentity, hasWrittenVoicing, matchesWrittenChord, resolvesInVoice } from "../../writtenResolution";
import { readCompleteWrittenChord, readSoundingTertianIdentity, soundsCompleteWrittenMembers, soundsCompleteWrittenTones } from "../../writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { nextWrittenVoicingChange } from "../helpers/writtenVoicingChange";
import type { AnalysisSlice } from "../../analysis";
import { leadingTargetDegree, type HarmonyAnalysisService } from "../services/harmony";

/** The local tonic to which a written leading tone owes its resolution.
 * An applied interpretation names its target by degree in the local key. */
export function leadingToneResolutionKey(slice: AnalysisSlice, harmony: HarmonyAnalysisService) {
  const reading = slice.chord && harmony.primaryInterpretation(slice.chord);
  const meaning = reading?.status === "resolved" ? reading.value : undefined;
  const key = meaning?.localKey ?? slice.key;
  const degree = leadingTargetDegree(meaning);
  return degree ? { tonic: scaleDegreePitchClass(key, degree), mode: "major" as const } : key;
}

function writtenDominant(slice: AnalysisSlice) {
  const identity = readCompleteWrittenChord(slice);
  const structure = identity?.structure;
  if (identity && structure?.kind === "tertian" && !structure.extensions.length && !structure.alterations.length &&
      (structure.quality === "major" || structure.quality === "dominant7")) {
    return { root: identity.root, quality: structure.quality };
  }

  // Root position with a doubled root can supply a written V7 without its fifth.
  const bass = slice.notes.bass;
  const seventhChord = readWrittenDominantSeventh(slice.notes);
  if (!slice.completeSatb || !bass || !seventhChord || seventhChord.inversion !== 0 ||
      !allowsWrittenTertianIdentity(slice, seventhChord.root, "dominant7") ||
      !soundsCompleteWrittenTones([seventhChord.root, seventhChord.third, seventhChord.seventh],
        Object.values(slice.notes), bass)) return;
  return { root: seventhChord.root, quality: "dominant7" as const };
}

function allowsObservedTarget(rules: HarmonyRuleContext, frame: AnalysisSlice, landedKey?: KeyLike) {
  const chord = frame.chord;
  const semantics = chord?.semantics;
  if (!chord || !semantics) return true;
  const reading = rules.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || semantics.pedalContext || semantics.cadenceRole || semantics.mixture ||
      semantics.interpretations.length !== 1 || semantics.alternatives?.length || reading.value.designation?.specialRole) return false;
  const { localKey, appliedTarget, source, designation, degree, degreeAlteration } = reading.value;
  const explicit = chord.locked || rules.analysis.project.chordTrack.locked || source !== "inferred";
  if (landedKey) return !explicit || (!appliedTarget && (!localKey || keyEquals(localKey, landedKey)));
  return !localKey && !appliedTarget && (!explicit || (!designation &&
    pitchClassEquals(chord.identity.root, scaleDegreePitchClass(frame.key, degree, degreeAlteration))));
}

function readsIncompleteRootTonic(slice: AnalysisSlice, root: SpelledPitchClass, mode: KeyLike["mode"]) {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass || !pitchClassEquals(bass.pitch, root)) return false;
  if (!allowsWrittenTertianIdentity(slice, root, mode)) return false;
  return soundsCompleteWrittenTones(chordToneSpellings(root, mode).slice(0, 2), Object.values(slice.notes), bass);
}

/** §§15.2, 32.2. Look for an actual local dominant–tonic connection.
 * A diatonic major triad alone does not establish a tonicization. */
export function writtenLocalLeadingToneKey(rules: HarmonyRuleContext, slice: AnalysisSlice): KeyLike | undefined {
  if (!slice.attackVoiceIds.length || !allowsObservedTarget(rules, slice)) return;
  const dominant = writtenDominant(slice);
  if (!dominant) return;
  const tonic = scaleDegreePitchClass({ tonic: dominant.root, mode: "major" }, 4);
  if (pitchClassEquals(tonic, slice.key.tonic)) return;

  const tones = chordToneSpellings(dominant.root, dominant.quality);
  const hasChromaticMember = tones.some(tone => {
    const degree = (stepIndex(tone.step) - stepIndex(slice.key.tonic.step) + 7) % 7 + 1;
    return !pitchClassEquals(tone, scaleDegreePitchClass(slice.key, degree));
  });
  if (!hasChromaticMember) return;
  const motion = nextWrittenVoicingChange(rules, slice, frame => {
    const continuing = writtenDominant(frame);
    return !!continuing && continuing.quality === dominant.quality && pitchClassEquals(continuing.root, dominant.root) &&
      allowsObservedTarget(rules, frame);
  });
  if (!motion) return;
  const { departure, landing } = motion;
  const bass = landing.notes.bass;
  if (!bass || pitchClassEquals(bass.pitch, dominant.root)) return;

  const [, third, , seventh] = tones;
  const fromBass = departure.notes.bass!;
  const bassMove = writtenInterval(fromBass.pitch, bass.pitch);
  const authenticBass = dominant.quality === "dominant7" && pitchClassEquals(fromBass.pitch, dominant.root) &&
    pitchClassEquals(bass.pitch, tonic) &&
    ((bassMove.diatonicSteps === 3 && bassMove.semitones === 5) ||
     (bassMove.diatonicSteps === -4 && bassMove.semitones === -7));
  const thirdVoice = VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, third) &&
    resolvesInVoice(departure, landing, voice, tonic, 1));
  for (const mode of ["major", "minor"] as const) {
    const key = { tonic, mode };
    if (!allowsObservedTarget(rules, landing, key)) continue;
    const tonicThird = chordToneSpellings(tonic, mode)[1];
    const seventhVoice = seventh && VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, seventh) &&
      resolvesInVoice(departure, landing, voice, tonicThird, -1));
    if ((thirdVoice || seventhVoice || authenticBass) && matchesWrittenChord(landing, tonic, mode)) return key;
    if (thirdVoice && seventhVoice && readsIncompleteRootTonic(landing, tonic, mode)) return key;
  }
}

/** E.1 belongs to the third of V or the root of vii°, relative to the
 * actual tonic. VII can also be a stable fifth or a seventh governed by E.2. */
function hasHarmonicLeadingTone(identity: ChordIdentity, key: KeyLike) {
  const { root, structure } = identity;
  if (structure.kind !== "tertian") return false;
  const quality = structure.quality;
  if (pitchClassEquals(root, scaleDegreePitchClass(key, 5)))
    return quality === "major" || quality === "dominant7" || quality === "augmented";
  return pitchClassEquals(root, leadingTonePitchClass(key)) &&
    (quality === "diminished" || quality === "diminished7" || quality === "halfDiminished7");
}

function writtenLeadingHarmony(slice: AnalysisSlice, key: KeyLike) {
  const notes = Object.values(slice.notes).filter(note => !note.nonChordToneRole);
  const leading = leadingTonePitchClass(key);
  if (notes.length < 3 || !notes.some(note => pitchClassEquals(note.pitch, leading))) return false;
  const dominant = scaleDegreePitchClass(key, 5);
  const dominantSeventh = chordToneSpellings(dominant, "dominant7");
  const [root, third, , seventh] = dominantSeventh;
  // A chordal fifth can be omitted. Only the structural notes supply
  // evidence; a marked ornament may coexist with a complete harmony.
  return [
    dominantSeventh, [root, third, seventh], dominantSeventh.slice(0, 3), chordToneSpellings(dominant, "augmented"),
    chordToneSpellings(leading, "diminished"), chordToneSpellings(leading, "diminished7"),
    chordToneSpellings(leading, "halfDiminished7"),
  ].some(tones => soundsCompleteWrittenMembers(tones, notes));
}

function isUnlockedInferredChord(rules: HarmonyRuleContext, chord: NonNullable<AnalysisSlice["chord"]>) {
  if (chord.locked || rules.analysis.project.chordTrack.locked) return false;
  const reading = rules.harmony.primaryInterpretation(chord);
  return reading.status === "resolved" && reading.value.source === "inferred";
}

function writtenDiminishedSeventhTarget(
  rules: HarmonyRuleContext, slice: AnalysisSlice, root: SpelledPitchClass,
): KeyLike | undefined {
  const tones = chordToneSpellings(root, "diminished7");
  const motion = nextWrittenVoicingChange(rules, slice, frame =>
    (!frame.chord || isUnlockedInferredChord(rules, frame.chord)) && hasWrittenVoicing(frame, tones));
  if (!motion) return;

  const { landing } = motion;
  const identity = readCompleteWrittenChord(landing);
  const structure = identity?.structure;
  if (!identity || structure?.kind !== "tertian" ||
      (structure.quality !== "major" && structure.quality !== "minor") ||
      structure.extensions.length || structure.alterations.length) return;
  const target = { tonic: identity.root, mode: structure.quality };
  if (pitchClassEquals(root, leadingTonePitchClass(target)) && allowsObservedTarget(rules, landing, target)) return target;
}

export function leadingToneSourceKey(rules: HarmonyRuleContext, slice: AnalysisSlice): KeyLike | undefined {
  const observed = writtenLocalLeadingToneKey(rules, slice);
  if (observed) return observed;
  const key = leadingToneResolutionKey(slice, rules.harmony);
  const chord = slice.chord;
  if (chord) {
    const { identity } = chord;
    if (identity.structure.kind === "tertian" && identity.structure.quality === "diminished7" &&
        isUnlockedInferredChord(rules, chord)) {
      const written = readSoundingTertianIdentity(slice);
      if (written?.structure.kind === "tertian" && written.structure.quality === "diminished7" &&
          !pitchClassEquals(written.root, identity.root)) {
        // The spellings of a complete diminished seventh distinguish its root
        // from an enharmonically equivalent inferred rotation.
        if (hasHarmonicLeadingTone(written, key)) return key;
        if (hasHarmonicLeadingTone(written, slice.key)) return slice.key;
        return writtenDiminishedSeventhTarget(rules, slice, written.root);
      }
    }
    return hasHarmonicLeadingTone(identity, key) ? key : undefined;
  }

  // In a melody-only exercise the key signature supplies the teaching target.
  // A rest in one or more parts of a harmonized exercise is a different case.
  if (rules.analysis.project.satbTracks.filter(track => track.notes.length > 0).length === 1) return key;
  if (writtenLeadingHarmony(slice, key)) return key;
}
