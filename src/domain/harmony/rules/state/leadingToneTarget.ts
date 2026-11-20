import { chordToneSpellings } from "../../../chordModel";
import {
  keyEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals,
  type KeyLike, type SpelledPitchClass,
} from "../../../pitch";
import { VOICE_ORDER } from "../../../project";
import { readWrittenDominantSeventh } from "../../writtenDominantSeventh";
import { allowsWrittenTertianIdentity, matchesWrittenChord, resolvesInVoice } from "../../writtenResolution";
import { readCompleteWrittenChord, soundsCompleteWrittenTones } from "../../writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import type { AnalysisSlice } from "../../analysis";
import type { HarmonyAnalysisService } from "../services/harmony";

/** The local tonic to which a written leading tone owes its resolution.
 * An applied interpretation names its target by degree in the local key. */
export function leadingToneResolutionKey(slice: AnalysisSlice, harmony: HarmonyAnalysisService) {
  const reading = slice.chord && harmony.primaryInterpretation(slice.chord);
  const meaning = reading?.status === "resolved" ? reading.value : undefined;
  const key = meaning?.localKey ?? slice.key;
  if (!meaning?.appliedTarget) return key;
  return { tonic: scaleDegreePitchClass(key, meaning.appliedTarget.degree), mode: "major" as const };
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

function sameWrittenVoicing(left: AnalysisSlice, right: AnalysisSlice) {
  return right.completeSatb && VOICE_ORDER.every(voice =>
    spelledPitchEquals(left.notes[voice]!.pitch, right.notes[voice]!.pitch));
}

function departureFromWrittenDominant(
  rules: HarmonyRuleContext, opened: AnalysisSlice, dominant: NonNullable<ReturnType<typeof writtenDominant>>,
) {
  let departure = opened;
  while (true) {
    const landing = rules.sliceAt(departure.endTick);
    if (!landing || landing.tick !== departure.endTick || !keyEquals(opened.key, landing.key) ||
        crossesManualPhraseBoundary(rules, departure.tick, landing.tick)) return;
    // Key reminders and written reattacks can subdivide an unchanged voicing.
    // Resolutions are measured from the events actually ending at the change.
    if (!sameWrittenVoicing(departure, landing)) return { departure, landing };
    const continuing = writtenDominant(landing);
    if (!continuing || continuing.quality !== dominant.quality || !pitchClassEquals(continuing.root, dominant.root) ||
        !allowsObservedTarget(rules, landing)) return;
    departure = landing;
  }
}

function readsIncompleteRootTonic(slice: AnalysisSlice, root: SpelledPitchClass, mode: KeyLike["mode"]) {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass || !pitchClassEquals(bass.pitch, root)) return false;
  if (!allowsWrittenTertianIdentity(slice, root, mode)) return false;
  return soundsCompleteWrittenTones(chordToneSpellings(root, mode).slice(0, 2), Object.values(slice.notes), bass);
}

/** §§15.2, 32.2. Identify the actual local tonic before collecting E.1.
 * A complete tonic needs one written tendency-tone resolution. An incomplete
 * tonic on its own bass needs both. A tonic six-four still leaves the
 * dominant in the bass and cannot establish this target on its own. */
export function writtenLocalLeadingToneKey(rules: HarmonyRuleContext, slice: AnalysisSlice): KeyLike | undefined {
  const homeLeading = leadingTonePitchClass(slice.key);
  if (!slice.attackVoiceIds.some(voice => pitchClassEquals(slice.notes[voice]!.pitch, homeLeading)) ||
      !allowsObservedTarget(rules, slice)) return;
  const dominant = writtenDominant(slice);
  if (!dominant) return;
  const tonic = scaleDegreePitchClass({ tonic: dominant.root, mode: "major" }, 4);
  if (pitchClassEquals(tonic, slice.key.tonic)) return;

  const motion = departureFromWrittenDominant(rules, slice, dominant);
  if (!motion) return;
  const { departure, landing } = motion;
  const bass = landing.notes.bass;
  if (!bass || pitchClassEquals(bass.pitch, dominant.root)) return;

  const [, third, , seventh] = chordToneSpellings(dominant.root, dominant.quality);
  const thirdVoice = VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, third) &&
    resolvesInVoice(departure, landing, voice, tonic, 1));
  for (const mode of ["major", "minor"] as const) {
    const key = { tonic, mode };
    if (!allowsObservedTarget(rules, landing, key)) continue;
    const tonicThird = chordToneSpellings(tonic, mode)[1];
    const seventhVoice = seventh && VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, seventh) &&
      resolvesInVoice(departure, landing, voice, tonicThird, -1));
    if ((thirdVoice || seventhVoice) && matchesWrittenChord(landing, tonic, mode)) return key;
    if (thirdVoice && seventhVoice && readsIncompleteRootTonic(landing, tonic, mode)) return key;
  }
}
