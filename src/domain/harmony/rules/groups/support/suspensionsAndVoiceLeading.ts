import {
  chordIdentityEquals,
  chordToneSpellings,
  type ChordIdentity,
  type ChordQuality,
  chordIdentityToneSpellings,
} from "../../../../chordModel";
import {
  keyEquals,
  leadingTonePitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  writtenInterval,
  type WrittenInterval,
  type KeyLike,
  isWrittenStep,
  spelledPitchEquals,
  type SpelledPitchClass,
} from "../../../../pitch";
import { VOICE_ORDER } from "../../../../project/voice";
import type { AnalysisSlice, SliceTransition, AnalysisNote } from "../../../analysis";
import { movesToWrittenTone, preparedNinthOverDominantSeventh } from "../../../facts/dominantMotion";
import {
  allowsWrittenTertianIdentity,
  hasWrittenVoicing,
  verifyPreparedSuspensionVoicing,
  type PreparationSupport,
} from "../../../facts/tendencyResolution";
import { soundsDeclaredChord } from "../../../facts/writtenVoicing";
import type { HarmonyRuleContext } from "../../context/createRuleContext";
import { crossesManualPhraseBoundary, activeNotes } from "../../helpers/core";
import type { VoicePairTransitionFact } from "../../sharedFacts";
import { resolvesPreparedDoubleAugmentedFourThree } from "./augmentedSixth";
import { cadentialSixFourInKey, resolvesRaisedSecondApproach } from "./doubleDominant";

const landingQualities: readonly ChordQuality[] = ["major", "minor"];
const preparationQualities: readonly ChordQuality[] = [
  ...landingQualities, "diminished", "dominant7", "minor7", "halfDiminished7",
];

function soundedHarmony(slice: AnalysisSlice, landing: boolean) {
  const bass = slice.notes.bass;
  if (!bass) return;
  const voices = activeNotes(slice);
  if (voices.some(({ note }) => toMidi(note.pitch) < toMidi(bass.pitch))) return;
  const qualities = landing ? landingQualities : preparationQualities;
  const declared = slice.chord?.identity;
  const candidates: ChordIdentity[] = declared ? [declared] : voices.flatMap(({ note }) =>
    qualities.map(quality => ({
      root: note.pitch, bass: bass.pitch,
      structure: { kind: "tertian" as const, quality, extensions: [], alterations: [] },
    })),
  );
  for (const identity of candidates) {
    const { structure } = identity;
    if (structure.kind !== "tertian" || !qualities.includes(structure.quality) ||
        structure.extensions.length || structure.alterations.length ||
        !pitchClassEquals(bass.pitch, identity.bass)) continue;
    const tones = chordToneSpellings(identity.root, structure.quality);
    const counts = tones.map(tone => voices.filter(({ note }) => pitchClassEquals(note.pitch, tone)).length);
    if (counts.reduce((sum, n) => sum + n, 0) !== 4) continue;
    const incompleteTonic = landing && structure.quality === slice.key.mode &&
      pitchClassEquals(bass.pitch, slice.key.tonic) && pitchClassEquals(identity.root, bass.pitch) &&
      counts[0] === 3 && counts[1] === 1;
    if (incompleteTonic || counts.every(Boolean)) return { identity, tones };
  }
}

function effectiveKey(context: HarmonyRuleContext, slice: AnalysisSlice) {
  if (!slice.chord) return slice.key;
  const reading = context.harmony.primaryInterpretation(slice.chord);
  if (reading.status === "ambiguous") return;
  return reading.status === "resolved" ? reading.value.localKey ?? slice.key : slice.key;
}

function plainReading(
  context: HarmonyRuleContext, frame: AnalysisSlice, key: AnalysisSlice["key"], family: "dominant" | "tonic",
) {
  const chord = frame.chord;
  if (!chord?.semantics) return true;
  const { semantics } = chord;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || semantics.interpretations.length !== 1 || semantics.alternatives?.length ||
      semantics.cadenceRole || semantics.mixture || semantics.pedalContext) return false;
  const { localKey, appliedTarget, designation, degree, degreeAlteration } = reading.value;
  return !appliedTarget && (!localKey || keyEquals(localKey, key)) &&
    (!designation || ((designation.kind === "side-degree" || designation.kind === "primary") &&
      !designation.specialRole && (!designation.primaryFunction || designation.primaryFunction === family))) &&
    pitchClassEquals(chord.identity.root, scaleDegreePitchClass(key, degree, degreeAlteration));
}

// A written triad can coincide with a 6–5 suspension. In ex. 36-542b
// the seventh of viiø65 stays above the tonic bass while the other two
// tendency tones have already resolved in their original voices.
function submediantDuringSeventhResolution(
  context: HarmonyRuleContext, prepared: AnalysisSlice, entry: AnalysisSlice, release: AnalysisSlice,
  source: ChordIdentity, target: ChordIdentity,
) {
  const middle = entry.chord, key = release.key;
  if (!middle || middle.startTick !== entry.tick || middle.startTick + middle.durationTicks !== release.tick ||
      key.mode !== "major" || source.structure.kind !== "tertian" || source.structure.quality !== "halfDiminished7" ||
      target.structure.kind !== "tertian" || target.structure.quality !== "major" ||
      !pitchClassEquals(source.root, leadingTonePitchClass(key)) || !pitchClassEquals(target.root, key.tonic) ||
      !pitchClassEquals(target.bass, key.tonic)) return false;
  const [leading, second, fourth, sixth] = chordToneSpellings(source.root, "halfDiminished7");
  const [tonic, third, fifth] = chordToneSpellings(target.root, "major");
  const triad = middle.identity;
  if (!pitchClassEquals(source.bass, second) || !pitchClassEquals(prepared.notes.soprano!.pitch, sixth) ||
      !pitchClassEquals(release.notes.soprano!.pitch, fifth) || !pitchClassEquals(triad.bass, tonic) ||
      !pitchClassEquals(triad.root, sixth) || triad.structure.kind !== "tertian" || triad.structure.quality !== "minor" ||
      triad.structure.extensions.length || triad.structure.alterations.length) return false;

  const onset = prepared.notes.soprano!.startTick;
  if (activeNotes(prepared).some(({ note }) => note.startTick > onset) ||
      crossesManualPhraseBoundary(context, onset, release.tick) ||
      context.slices({ overlapping: { fromTick: onset, toTick: entry.tick } }).any(frame =>
        frame.key.id !== key.id || (frame.chord && !chordIdentityEquals(frame.chord.identity, source)) ||
        !plainReading(context, frame, key, "dominant")) ||
      !plainReading(context, entry, key, "tonic") || !plainReading(context, release, key, "tonic")) return false;

  return (["alto", "tenor"] as const).every(voice => {
    const from = prepared.notes[voice]!, to = entry.notes[voice]!;
    if (to.startTick !== entry.tick) return false;
    return (pitchClassEquals(from.pitch, leading) && movesToWrittenTone(from.pitch, to.pitch, tonic, 1, 1)) ||
      (pitchClassEquals(from.pitch, fourth) && movesToWrittenTone(from.pitch, to.pitch, third, -1, -1));
  });
}

/** Spasobin §36, ex. 36-541–542. Compare the preparation and resolution
 * of one physically held upper note with the same lower voice's descent. */
export function preparedSuspensionParallel(
  context: HarmonyRuleContext,
  { previous, current, contiguous, sameKey }: SliceTransition,
  fact: VoicePairTransitionFact,
  isPerfect: (interval: WrittenInterval) => boolean,
) {
  const [upper, lower] = fact.voiceIds;
  const [held, earlierLower] = fact.previousNotes;
  const [resolution, moved] = fact.currentNotes;
  if (!contiguous || !sameKey || !previous.completeSatb || !current.completeSatb ||
      earlierLower.id !== moved.id || held.id === resolution.id ||
      resolution.startTick !== current.tick || held.startTick + held.durationTicks !== current.tick ||
      held.startTick >= moved.startTick || moved.startTick <= 0) return;
  const step = writtenInterval(held.pitch, resolution.pitch);
  if (step.diatonicSteps !== -1 || (step.semitones !== -1 && step.semitones !== -2) ||
      (held.nonChordToneRole && held.nonChordToneRole !== "suspension")) return;

  const entry = context.sliceAt(moved.startTick);
  const prepared = context.sliceAt(moved.startTick - 1);
  const lowerBefore = prepared?.notes[lower];
  if (!entry?.completeSatb || !prepared?.completeSatb || !lowerBefore ||
      prepared.notes[upper]?.id !== held.id || entry.notes[upper]?.id !== held.id ||
      lowerBefore.startTick + lowerBefore.durationTicks !== entry.tick ||
      activeNotes(current).some(({ voiceId, note }) =>
        note.nonChordToneRole || (voiceId !== upper && entry.notes[voiceId]?.id !== note.id)) ||
      activeNotes(prepared).some(({ voiceId, note }) => voiceId !== upper && note.nonChordToneRole)) return;
  const partnerStep = writtenInterval(lowerBefore.pitch, moved.pitch);
  if (partnerStep.diatonicSteps !== step.diatonicSteps || partnerStep.semitones !== step.semitones ||
      toMidi(held.pitch) <= toMidi(lowerBefore.pitch) || toMidi(held.pitch) <= toMidi(moved.pitch) ||
      toMidi(resolution.pitch) <= toMidi(moved.pitch) ||
      !isPerfect(writtenInterval(lowerBefore.pitch, held.pitch))) return;

  const accent = context.metric.positionAt(entry.tick);
  const release = context.metric.positionAt(current.tick);
  if (!accent || !release || accent.measureNumber !== release.measureNumber ||
      release.beatPosition - accent.beatPosition > 1 || context.metric.compare(accent, release) !== "stronger" ||
      crossesManualPhraseBoundary(context, prepared.tick, current.tick)) return;

  const from = soundedHarmony(prepared, false);
  const to = soundedHarmony(current, true);
  if (!from || !to || to.tones.some(tone => pitchClassEquals(held.pitch, tone))) return;
  const key = effectiveKey(context, current);
  const prepKey = effectiveKey(context, prepared);
  if (!key || !prepKey || !keyEquals(key, prepKey)) return;
  const sixth = upper === "soprano" && lower === "bass" && entry.chord &&
    !chordIdentityEquals(entry.chord.identity, to.identity) &&
    submediantDuringSeventhResolution(context, prepared, entry, current, from.identity, to.identity)
    ? entry.chord : undefined;
  if (context.slices({ overlapping: { fromTick: prepared.tick, toTick: current.endTick } }).any(slice => {
    if (slice.key.id !== prepared.key.id) return true;
    if (slice.index === prepared.index || !slice.chord) return false;
    const local = effectiveKey(context, slice);
    return !local || !keyEquals(local, key) ||
      (slice.chord.id !== sixth?.id && !chordIdentityEquals(slice.chord.identity, to.identity));
  })) return;

  return { held, lowerBefore, entryTick: entry.tick };
}

function functionalKey(context: HarmonyRuleContext, slice: AnalysisSlice, degree: 1 | 5) {
  const chord = slice.chord;
  if (!chord || chord.semantics?.cadenceRole || chord.semantics?.pedalContext) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== degree ||
      reading.value.degreeAlteration !== 0 || reading.value.appliedTarget) return;
  const { designation, localKey } = reading.value;
  if (designation && (designation.kind !== "primary" ||
      designation.primaryFunction !== (degree === 1 ? "tonic" : "dominant"))) return;
  return localKey ?? slice.key;
}

function preparationSupport(
  context: HarmonyRuleContext,
  slice: AnalysisSlice,
  onset: AnalysisSlice,
  key: KeyLike,
  singleNinth: boolean,
): PreparationSupport {
  if (!slice.completeSatb || slice.key.id !== onset.key.id) return "blocked";
  const notes = activeNotes(slice);
  if (notes.some(({ note }) => note.nonChordToneRole)) return "blocked";
  const chord = slice.chord;
  if (!chord) return "surface";

  if (singleNinth) {
    const tones = chordIdentityToneSpellings(chord.identity);
    const reading = context.harmony.primaryInterpretation(chord);
    const prepKey = reading.status === "resolved" ? reading.value.localKey ?? slice.key : slice.key;
    return keyEquals(prepKey, key) && pitchClassEquals(slice.notes.bass!.pitch, chord.identity.bass) &&
      notes.every(({ note }) => context.harmony.isWrittenChordTone(note, chord)) &&
      tones.every(tone => notes.some(({ note }) => pitchClassEquals(note.pitch, tone))) ? "confirmed" : "blocked";
  }
  const localKey = functionalKey(context, slice, 5);
  const { identity } = chord;
  const { structure } = identity;
  if (!localKey || !keyEquals(localKey, key) || structure.kind !== "tertian" ||
      structure.quality !== "dominant7" || structure.alterations.length || structure.extensions.length ||
      !pitchClassEquals(identity.root, scaleDegreePitchClass(key, 5)) ||
      !pitchClassEquals(slice.notes.bass!.pitch, identity.bass)) return "blocked";

  const tones = chordIdentityToneSpellings(identity);
  return tones.every(tone => notes.some(({ note }) => pitchClassEquals(note.pitch, tone)))
    ? "confirmed"
    : "surface";
}

function heldNinthOverDominantSeventh(context: HarmonyRuleContext, slice: AnalysisSlice) {
  const { chord, notes: { bass } } = slice;
  if (!chord || bass?.startTick !== slice.tick) return [];
  const key = functionalKey(context, slice, 5);
  if (!key || !pitchClassEquals(chord.identity.root, scaleDegreePitchClass(key, 5))) return [];
  const before = context.sliceAt(slice.tick - 1), landing = context.sliceAt(slice.endTick);
  if (!before?.chord || !landing?.chord || !soundsDeclaredChord(before) ||
      !keyEquals(before.key, slice.key) || !keyEquals(landing.key, slice.key) ||
      !chordIdentityEquals(chord.identity, landing.chord.identity) ||
      context.analysis.phraseBoundaries.some(boundary =>
        boundary.source === "manual" && !boundary.stale && before.tick < boundary.tick && boundary.tick <= landing.tick)) return [];
  const landingKey = functionalKey(context, landing, 5);
  const preparation = context.harmony.primaryInterpretation(before.chord);
  const preparationKey = preparation.status === "resolved" ? preparation.value.localKey ?? before.key : before.key;
  if (!landingKey || !keyEquals(key, landingKey) || !keyEquals(key, preparationKey)) return [];
  const noteId = preparedNinthOverDominantSeventh(
    chord.identity, before.notes, slice.notes, landing.notes, slice.tick, landing.tick,
    context.metric.positionAt(slice.tick), context.metric.positionAt(landing.tick),
  );
  return noteId ? [noteId] : [];
}

/** Limit the score proof to the part of the note that is outside the
 * annotated harmony. The caller leaves all persisted roles untouched. */
export function heldSuspensionsAt(context: HarmonyRuleContext, slice: AnalysisSlice): readonly string[] {
  const { chord } = slice;
  const bass = slice.notes.bass;
  if (!chord || !bass || !slice.completeSatb) return [];
  const { root, bass: writtenBass, structure } = chord.identity;
  if (structure.kind === "tertian" && structure.quality === "dominant7")
    return heldNinthOverDominantSeventh(context, slice);
  if (structure.kind !== "tertian" || (structure.quality !== "major" && structure.quality !== "minor") ||
      structure.alterations.length || structure.extensions.length ||
      !pitchClassEquals(root, bass.pitch) || !pitchClassEquals(root, writtenBass)) return [];

  // Use the actual bass attack, since a label can divide a held voicing
  // into several slices without adding any musical attack.
  const onset = context.sliceAt(bass.startTick);
  if (!onset || onset.tick !== bass.startTick) return [];
  const tones = chordIdentityToneSpellings(chord.identity);
  const singleNinth = activeNotes(onset).some(({ note }) => pitchClassEquals(note.pitch, tones[1]));
  const targetKey = (part: AnalysisSlice) => {
    if (!singleNinth) return functionalKey(context, part, 1);
    const reading = part.chord && context.harmony.primaryInterpretation(part.chord);
    return reading?.status === "resolved" ? reading.value.localKey ?? part.key : part.key;
  };
  const key = targetKey(slice);
  if (!key || (!singleNinth && (structure.quality !== key.mode || !pitchClassEquals(root, key.tonic)))) return [];
  const isSameTarget = (part: AnalysisSlice) => {
    if (part.key.id !== onset.key.id || !part.chord ||
        !chordIdentityEquals(part.chord.identity, chord.identity)) return false;
    const localKey = targetKey(part);
    return localKey !== undefined && keyEquals(localKey, key);
  };
  if (!isSameTarget(onset)) return [];
  if (activeNotes(onset).some(({ note }) => note.nonChordToneRole))
    return [];

  const beatTicks = context.analysis.project.ppq;
  const timeline = context.slices({ overlapping: {
    fromTick: Math.max(0, onset.tick - beatTicks - 1),
    toTick: onset.tick + beatTicks + 1,
  } }).toArray();
  const onsetIndex = timeline.findIndex(part => part.index === onset.index);
  const verified = verifyPreparedSuspensionVoicing({
    slices: timeline.map(part => ({ fromTick: part.tick, toTick: part.endTick, notes: part.notes })),
    onsetIndex,
    key,
    beatTicks,
    metricAt: context.metric.positionAt,
    preparationAt: (index, loneNinth) => preparationSupport(context, timeline[index], onset, key, loneNinth),
  });
  if (!verified || verified.singleNinth !== singleNinth || slice.tick < verified.fromTick || slice.endTick > verified.toTick) return [];

  const prep = timeline[verified.preparationIndex];
  const resolution = timeline[verified.resolutionIndex];
  if (context.analysis.phraseBoundaries.some(boundary =>
    !boundary.stale && prep.tick < boundary.tick && boundary.tick <= verified.toTick,
  ) || !timeline.slice(onsetIndex, verified.resolutionIndex + 1).every(isSameTarget)) return [];

  const resolvedNotes = activeNotes(resolution);
  if (!resolvedNotes.every(({ note }) => !note.nonChordToneRole &&
    context.harmony.isWrittenChordTone(note, chord),
  ) || !tones.every(tone => resolvedNotes.some(({ note }) => pitchClassEquals(note.pitch, tone)))) return [];

  return verified.motions.map(({ noteId }) => noteId);
}

function matchesCadentialHarmony(
  context: HarmonyRuleContext, slice: AnalysisSlice, key: KeyLike,
  root: SpelledPitchClass, quality: ChordQuality, degree: 1 | 5,
) {
  if (!allowsWrittenTertianIdentity(slice, root, quality)) return false;
  const chord = slice.chord;
  if (!chord) return true;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status === "unavailable") return true;
  return reading.status === "resolved" && !reading.value.appliedTarget &&
    reading.value.degree === degree && reading.value.degreeAlteration === 0 &&
    keyEquals(reading.value.localKey ?? slice.key, key);
}

/** 斯波索宾 §9.3 例 9–108b。属音低音换位时，女高音可下跳到属和弦的三音或五音。 */
export function isClosingCadentialOverlap(
  context: HarmonyRuleContext, { previous, current, contiguous, sameKey }: SliceTransition,
  fact: VoicePairTransitionFact,
) {
  if (fact.voiceIds[0] !== "soprano" || fact.voiceIds[1] !== "alto" ||
      !contiguous || !sameKey || !previous.completeSatb || !current.completeSatb) return false;
  const [sopranoBefore, altoBefore] = fact.previousNotes;
  const [soprano, alto] = fact.currentNotes;
  if (toMidi(soprano.pitch) >= toMidi(altoBefore.pitch) ||
      toMidi(alto.pitch) > toMidi(sopranoBefore.pitch) ||
      writtenInterval(sopranoBefore.pitch, soprano.pitch).diatonicSteps > -2) return false;

  const bassBefore = previous.notes.bass!, bass = current.notes.bass!;
  const bassMotion = writtenInterval(bassBefore.pitch, bass.pitch);
  if (Math.abs(bassMotion.diatonicSteps) !== 7 || Math.abs(bassMotion.semitones) !== 12 ||
      VOICE_ORDER.some((voice, index) => index > 0 &&
        toMidi(current.notes[VOICE_ORDER[index - 1]]!.pitch) < toMidi(current.notes[voice]!.pitch))) return false;

  const dominantEnd = current.chord ? current.chord.startTick + current.chord.durationTicks : current.endTick;
  const landing = context.sliceAt(dominantEnd);
  if (!landing?.completeSatb || !keyEquals(landing.key, current.key) ||
      crossesManualPhraseBoundary(context, previous.tick, landing.tick)) return false;
  const key = effectiveKey(context, current.chord ? current : previous.chord ? previous : landing);
  if (!key) return false;
  const [dominant, third, fifth, seventh] = chordToneSpellings(scaleDegreePitchClass(key, 5), "dominant7");
  if (!pitchClassEquals(bass.pitch, dominant) ||
      (!pitchClassEquals(soprano.pitch, third) && !pitchClassEquals(soprano.pitch, fifth))) return false;

  const tonic = chordToneSpellings(key.tonic, key.mode);
  const sourceRole = previous.chord?.semantics?.cadenceRole;
  if ((sourceRole && sourceRole !== "cadential64") ||
      !matchesCadentialHarmony(context, previous, key, key.tonic, key.mode, 1) ||
      !(hasWrittenVoicing(previous, tonic) ||
        (sourceRole === "cadential64" && hasWrittenVoicing(previous, [tonic[0], dominant])))) return false;

  const actualDominant = matchesCadentialHarmony(context, current, key, dominant, "major", 5) &&
      (hasWrittenVoicing(current, [dominant, third, fifth]) || hasWrittenVoicing(current, [dominant, third]));
  const actualSeventh = matchesCadentialHarmony(context, current, key, dominant, "dominant7", 5) &&
      (hasWrittenVoicing(current, [dominant, third, fifth, seventh]) ||
        hasWrittenVoicing(current, [dominant, third, seventh]));
  return (actualDominant || actualSeventh) &&
    !landing.chord?.semantics?.cadenceRole &&
    pitchClassEquals(landing.notes.bass!.pitch, key.tonic) &&
    matchesCadentialHarmony(context, landing, key, key.tonic, key.mode, 1) &&
    (hasWrittenVoicing(landing, tonic) || hasWrittenVoicing(landing, tonic.slice(0, 2)));
}

function primaryRootPositionKey(context: HarmonyRuleContext, slice: AnalysisSlice, degree: 1 | 5) {
  const chord = slice.chord;
  if (!chord || chord.semantics?.pedalContext || chord.semantics?.cadenceRole) return;
  const interpretation = context.harmony.primaryInterpretation(chord);
  if (interpretation.status !== "resolved") return;
  const reading = interpretation.value;
  if (reading.degree !== degree || reading.degreeAlteration !== 0 || reading.appliedTarget ||
      (reading.designation && reading.designation.kind !== "primary")) return;
  const key = reading.localKey ?? slice.key;
  const root = scaleDegreePitchClass(key, degree);
  const { structure } = chord.identity;
  if (structure.kind !== "tertian" || structure.extensions.length || structure.alterations.length ||
      structure.quality !== (degree === 5 ? "dominant7" : key.mode) ||
      !pitchClassEquals(chord.identity.root, root) || !pitchClassEquals(chord.identity.bass, root)) return;
  return key;
}

function isPreparedSeventh(
  context: HarmonyRuleContext,
  transition: SliceTransition,
  seventhVoice: "alto" | "tenor",
) {
  const { previous: source, current: arrival } = transition;
  const seventh = source.notes[seventhVoice]!;
  const onset = Math.max(...Object.values(source.notes).map(note => note!.startTick));
  const before = context.sliceAt(onset - 1);
  const earlier = before?.notes[seventhVoice];
  if (!before?.completeSatb || before.key.id !== source.key.id || !earlier || earlier.nonChordToneRole ||
      context.analysis.phraseBoundaries.some(boundary =>
        !boundary.stale && onset <= boundary.tick && boundary.tick <= arrival.tick,
      )) return false;
  const entry = writtenInterval(earlier.pitch, seventh.pitch);
  return spelledPitchEquals(earlier.pitch, seventh.pitch) ||
    (entry.diatonicSteps === -1 && entry.semitones < 0 && isWrittenStep(entry));
}

function closesWithPlagalSupplement(
  context: HarmonyRuleContext, transition: SliceTransition, tonicEnd: number, soundEnd: number,
) {
  const cadences = context.analysis.cadenceCandidates;
  return cadences.some(cadence =>
    cadence.confidence !== "ambiguous" && cadence.kind === "full" && cadence.form === "authentic" &&
    cadence.completion === "perfect" && cadence.fromTick <= transition.previous.tick && cadence.toTick === tonicEnd,
  ) && cadences.some(cadence =>
    cadence.confidence !== "ambiguous" && cadence.kind === "supplementary" && cadence.form === "plagal" &&
    cadence.fromTick === tonicEnd && cadence.toTick === soundEnd,
  );
}

function tonicClosesScore(context: HarmonyRuleContext, transition: SliceTransition, key: KeyLike, beatTicks: number) {
  const { current: arrival } = transition;
  const slices = context.slices({ overlapping: {
    fromTick: arrival.tick, toTick: context.analysis.project.lengthTicks,
  } }).toArray();
  let last = slices.length - 1;
  while (last >= 0 && Object.values(slices[last].notes).every(note => !note)) last--;
  if (last < 0) return false;
  const ending = slices.slice(0, last + 1);
  const soundEnd = slices[last].endTick;
  if (ending.some(slice => slice.key.id !== arrival.key.id)) return false;
  const [root, third, fifth] = chordToneSpellings(key.tonic, key.mode);
  let surfaceTicks = 0;
  let stable = true;
  for (const slice of ending) {
    const { soprano, bass } = slice.notes;
    const tonicKey = slice.chord ? primaryRootPositionKey(context, slice, 1) : undefined;
    const tonicLabel = !slice.chord || (!!tonicKey && keyEquals(key, tonicKey));
    if (!slice.completeSatb || !tonicLabel || !soprano || !bass ||
        !pitchClassEquals(soprano.pitch, root) || !pitchClassEquals(bass.pitch, root)) {
      return stable && slice.tick - arrival.tick >= beatTicks &&
        closesWithPlagalSupplement(context, transition, slice.tick, soundEnd);
    }
    const notes = Object.values(slice.notes) as AnalysisNote[];
    stable = notes.every(note => !note.nonChordToneRole &&
      [root, third, fifth].some(tone => pitchClassEquals(note.pitch, tone)),
    ) && notes.some(note => pitchClassEquals(note.pitch, third));
    if (!stable) {
      // A brief intervening ornament can leave the actual outer tonic held,
      // but the final sounding slice must again voice the tonic.
      surfaceTicks += slice.endTick - slice.tick;
      const attack = Math.max(...notes.map(note => note.startTick));
      const previous = context.sliceAt(slice.tick - 1);
      if (surfaceTicks > beatTicks / 2 || context.metric.positionAt(attack)?.role !== "subdivision" ||
          soprano.id !== previous?.notes.soprano?.id || bass.id !== previous?.notes.bass?.id) return false;
    }
  }
  return stable && soundEnd - arrival.tick >= beatTicks;
}

/** A narrow reading of Spasobin, ch. 16 §3. The voicing and its actual
 * closing context must support the exception to the contrary-octave rule. */
export function isCadentialContraryOctave(context: HarmonyRuleContext, transition: SliceTransition) {
  const { previous: source, current: arrival } = transition;
  if (!transition.contiguous || source.key.id !== arrival.key.id || !source.completeSatb || !arrival.completeSatb ||
      Object.values(source.notes).some(note => note?.nonChordToneRole) ||
      Object.values(arrival.notes).some(note => note?.nonChordToneRole || note?.startTick !== arrival.tick)) return false;
  for (const slice of [source, arrival]) {
    const lowest = toMidi(slice.notes.bass!.pitch);
    const highest = toMidi(slice.notes.soprano!.pitch);
    if ([slice.notes.alto!, slice.notes.tenor!].some(note => {
      const pitch = toMidi(note.pitch);
      return pitch < lowest || pitch > highest;
    })) return false;
  }
  const key = primaryRootPositionKey(context, arrival, 1);
  if (!key) return false;
  const dominantKey = primaryRootPositionKey(context, source, 5);
  if (!dominantKey || !keyEquals(key, dominantKey)) return false;
  const accent = context.metric.positionAt(arrival.tick);
  if (!accent || accent.level < 2 ||
      context.metric.compare(accent, context.metric.positionAt(source.tick)) !== "stronger") return false;
  const beatTicks = context.analysis.metricTimeline.measures[accent.measureNumber - 1]?.beatLength;
  if (!beatTicks) return false;

  const [root, leading, , seventh] = chordToneSpellings(scaleDegreePitchClass(key, 5), "dominant7");
  for (const voice of ["soprano", "bass"] as const) {
    const before = source.notes[voice]!;
    const after = arrival.notes[voice]!;
    const steps = Math.abs(writtenInterval(before.pitch, after.pitch).diatonicSteps);
    if (!pitchClassEquals(before.pitch, root) || !pitchClassEquals(after.pitch, key.tonic) ||
        (steps !== 3 && steps !== 4)) return false;
  }
  const leadingVoice = pitchClassEquals(source.notes.alto!.pitch, leading) ? "alto" : "tenor";
  const seventhVoice = leadingVoice === "alto" ? "tenor" : "alto";
  const leadingBefore = source.notes[leadingVoice]!;
  const leadingAfter = arrival.notes[leadingVoice]!;
  const seventhBefore = source.notes[seventhVoice]!;
  const seventhAfter = arrival.notes[seventhVoice]!;
  const leadingMotion = writtenInterval(leadingBefore.pitch, leadingAfter.pitch);
  const seventhMotion = writtenInterval(seventhBefore.pitch, seventhAfter.pitch);
  if (!pitchClassEquals(leadingBefore.pitch, leading) || !pitchClassEquals(leadingAfter.pitch, key.tonic) ||
      leadingMotion.diatonicSteps !== 1 || leadingMotion.semitones !== 1 ||
      !pitchClassEquals(seventhBefore.pitch, seventh) ||
      !pitchClassEquals(seventhAfter.pitch, scaleDegreePitchClass(key, 3)) ||
      seventhMotion.diatonicSteps !== -1 || seventhMotion.semitones >= 0 || !isWrittenStep(seventhMotion)) return false;
  return isPreparedSeventh(context, transition, seventhVoice) && tonicClosesScore(context, transition, key, beatTicks);
}

/** Both outside notes must be the prepared upper voices of the same K64 release. */
export function preparedCadentialPair(
  context: HarmonyRuleContext, slice: AnalysisSlice, outside: ReturnType<typeof activeNotes>,
) {
  if (outside.length !== 2 || !slice.chord || !slice.completeSatb) return false;
  const reading = context.harmony.primaryInterpretation(slice.chord);
  if (reading.status !== "resolved" || reading.value.degree !== 1 ||
      reading.value.degreeAlteration !== 0 || reading.value.appliedTarget) return false;
  const key = reading.value.localKey ?? slice.key;
  if (key.mode !== "major" || !cadentialSixFourInKey(context, slice, key)) return false;

  const span = context.spanAt(slice.tick);
  const link = span && context.spanNeighborhood(span).incoming;
  if (!link?.connection.contiguous || !link.connection.sameKey) return false;
  const { sourceBoundary: before, targetBoundary: entry } = link;
  const chord = before.chord;
  const bass = before.notes.bass;
  if (!chord || !bass || !before.completeSatb || entry.chord?.id !== slice.chord.id ||
      entry.notes.bass?.startTick !== entry.tick ||
      outside.some(({ voiceId, note }) => voiceId === "bass" ||
        before.notes[voiceId]?.id !== note.id || entry.notes[voiceId]?.id !== note.id)) return false;

  const source = context.harmony.primaryInterpretation(chord);
  if (source.status !== "resolved") return false;
  const sourceKey = source.value.localKey ?? before.key;
  if (!keyEquals(sourceKey, key)) return false;

  const release = outside[0].note.startTick + outside[0].note.durationTicks;
  if (context.analysis.phraseBoundaries.some(mark =>
    !mark.stale && link.source.span.fromTick < mark.tick && mark.tick <= release)) return false;
  const structure = chord.identity.structure;
  if (structure.kind === "augmented-sixth") {
    // A German label may conflict with written #II. The resolution proof
    // checks the actual spelling; the source voicing rule keeps its diagnosis.
    return (structure.variant === "doubleAugmented43" || structure.variant === "german") &&
      pitchClassEquals(chord.identity.root, bass.pitch) && pitchClassEquals(chord.identity.bass, bass.pitch) &&
      resolvesPreparedDoubleAugmentedFourThree(context, link, key);
  }

  if (structure.quality !== "diminished7") return false;
  const raised = outside.find(({ note }) => pitchClassEquals(note.pitch, scaleDegreePitchClass(key, 2, 1)));
  if (!raised) return false;
  const landing = context.sliceAt(release);
  if (!landing || landing.chord?.id !== slice.chord.id || slice.endTick > release ||
      outside.some(({ voiceId, note }) => note.startTick + note.durationTicks !== release ||
        landing.notes[voiceId]?.startTick !== release)) return false;
  // The common tonic can rearticulate with the arriving bass, but neither
  // supporting part changes again when the two suspensions release.
  if (activeNotes(entry).some(({ voiceId, note }) =>
    !outside.some(part => part.voiceId === voiceId) && landing.notes[voiceId]?.id !== note.id)) return false;
  const accent = context.metric.positionAt(entry.tick);
  const weak = context.metric.positionAt(release);
  if (!accent || !weak || accent.measureNumber !== weak.measureNumber ||
      weak.beatPosition - accent.beatPosition > 1 || context.metric.compare(accent, weak) !== "stronger") return false;
  return context.melodyTransitions({ voiceId: raised.voiceId }).any(motion =>
    motion.current.id === raised.note.id && resolvesRaisedSecondApproach(context, motion));
}

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
  return keyEquals(localKey, key) &&
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
