import {
  chordToneSpellings,
  primaryHarmonyInterpretation,
  type ChordQuality,
  chordIdentityEquals,
  chordIdentityToneSpellingForDegree,
  type ScaleDegree,
  type KeyReference,
} from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import {
  keyDeclarationEquals,
  keyEquals,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  type SpelledPitchClass,
  leadingTonePitchClass,
  writtenInterval,
  pitchClassValue,
} from "../../pitch";
import {
  continuesWrittenDominantSeventh,
  contextualMinorDominantTonic,
  contextualMinorSixthResolvesToFifth,
  dominantSixthInnerVoices as innerVoices,
  dominantSixthLowerVoices as lowerVoices,
  leadingToneDescendsToTonicFifth,
  movesToWrittenTone,
  resolvesDominantInnerVoice,
  dominantNinthTone,
  preparedNinthOverDominantSeventh,
  writtenDominantNinthResolves,
  readReattackedTonicNinth,
  readWrittenDominantSeventh,
  isMajorTonicSixFour,
  resolvesDoubleAugmentedFourThree,
} from "../facts/dominantMotion";
import {
  candidateComparator,
  createFunctionalCandidate,
  fitDominantSixthSubstitution,
  fitPreparedSuspension,
} from "./candidates";
import { isCanonicalTonicFifthOmission, dominantNinthTemplates, buildFunctionalTemplates } from "./scoring";
import { observationNotes, resolvesTone, writtenFrame, soundingBass } from "./observations";
import type {
  ChordInferenceCandidate,
  ChordInferenceObservation,
  FunctionalChordTemplate,
  ChordInferenceEvidence,
  ChordInferenceOptions,
  ChordInferenceRegion,
} from "./types";
import { continuesInKey } from "./passContext";
import type { VoiceId } from "../../project";
import { VOICE_ORDER } from "../../project/voice";
import { soundsCompleteWrittenChord } from "../facts/writtenVoicing";
import { compareMetricStrength } from "../../rhythm/metric";
import {
  diatonicMinorTarget,
  hasExactWrittenStack,
  proveLocalMinorDeceptiveDominant,
} from "../facts/functionalContext";

type DominantSixthsCandidateSet = readonly ChordInferenceCandidate[];

const isRootDominantSeventh: FunctionalChordTemplate = {
  baseId: "D",
  definition: functionalDefinition("D"),
  form: "seventh",
  localKeyPolicy: "current-key",
  expectedInversion: 0,
};

function exactDominantSixthReading(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && !candidate.fit.nonChordToneNoteIds.length &&
    !candidate.fit.omittedChordDegrees.length;
}

function plainQuality(candidate: ChordInferenceCandidate, quality: ChordQuality) {
  const { structure } = candidate.identity;
  return structure.kind === "tertian" && structure.quality === quality &&
    !structure.extensions.length && !structure.alterations.length;
}

function isInPrintedKey(candidate: ChordInferenceCandidate) {
  if (!candidate.semantics) return false;
  const interpretation = primaryHarmonyInterpretation(candidate.semantics);
  return !interpretation.localKey && !interpretation.appliedTarget;
}

function fifthResolution(
  source: ChordInferenceObservation,
  following: ChordInferenceObservation,
  candidates: DominantSixthsCandidateSet,
) {
  const root = source.bass?.pitch;
  const sixth = source.activeNotes.soprano?.pitch;
  const arrival = following.activeNotes.soprano?.pitch;
  if (!root || !sixth || !arrival || following.soundingPitchClasses.length !== 4 ||
      !movesToWrittenTone(sixth, arrival, chordToneSpellings(root, "dominant7")[2], -1) ||
      !lowerVoices.every(voice => {
        const before = source.activeNotes[voice];
        const after = following.activeNotes[voice];
        return before && after && spelledPitchEquals(before.pitch, after.pitch);
      })) return undefined;

  return candidates.find(candidate =>
    candidate.functionalBaseId === "D" && isInPrintedKey(candidate) &&
    plainQuality(candidate, "dominant7") && exactDominantSixthReading(candidate) &&
    pitchClassEquals(candidate.identity.root, root) && pitchClassEquals(candidate.identity.bass, root),
  );
}

function contextualFifthResolution(
  source: ChordInferenceObservation,
  following: ChordInferenceObservation,
  landing: ChordInferenceObservation | undefined,
  candidates: DominantSixthsCandidateSet,
  manualPhraseTicks: readonly number[],
) {
  if (!landing || !continuesInKey(following, landing) ||
      manualPhraseTicks.some(tick => source.fromTick < tick && tick <= landing.fromTick)) return;
  return candidates.find(candidate => {
    if (!exactDominantSixthReading(candidate)) return false;
    const context = contextualMinorDominantTonic(candidate, source.key);
    if (!context || (context.applied ? source.localKey || following.localKey || landing.localKey
      : !source.localKey || !keyEquals(source.key, { tonic: context.tonic, mode: "minor" }))) return false;
    return contextualMinorSixthResolvesToFifth(
      writtenFrame(source),
      writtenFrame(following),
      writtenFrame(landing),
      context.tonic, context.applied,
    );
  });
}

function tonicResolution(
  source: ChordInferenceObservation,
  following: ChordInferenceObservation,
  candidates: DominantSixthsCandidateSet,
  heldDominant: boolean,
) {
  const key = following.key;
  const root = source.bass?.pitch;
  const sixth = source.activeNotes.soprano?.pitch;
  const arrival = following.activeNotes.soprano?.pitch;
  if (!root || !sixth || !arrival || !movesToWrittenTone(sixth, arrival, key.tonic, -2)) return undefined;
  const tonicCandidates = candidates.filter(candidate =>
    candidate.functionalBaseId === (key.mode === "major" ? "T" : "t") && isInPrintedKey(candidate) &&
    plainQuality(candidate, key.mode) && pitchClassEquals(candidate.identity.root, key.tonic) &&
    pitchClassEquals(candidate.identity.bass, key.tonic));
  const completeTonic = tonicCandidates.some(exactDominantSixthReading);
  const newBass = source.bass?.startTick === source.fromTick;
  if ((!newBass && (!heldDominant || !completeTonic)) ||
      (!completeTonic && !tonicCandidates.some(candidate => isCanonicalTonicFifthOmission(following, candidate.identity)))) {
    return undefined;
  }

  const [, leadingTone, , seventh] = chordToneSpellings(root, "dominant7");
  const tonicFifth = completeTonic ? scaleDegreePitchClass(key, 5) : undefined;
  if (!newBass && !innerVoices.some(voice => leadingToneDescendsToTonicFifth(
    source.activeNotes[voice]?.pitch, following.activeNotes[voice]?.pitch, leadingTone, tonicFifth,
  ))) return undefined;
  const resolves = innerVoices.every(voice => resolvesDominantInnerVoice(
    source.activeNotes[voice]?.pitch,
    following.activeNotes[voice]?.pitch,
    leadingTone,
    seventh,
    key.tonic,
    sixth,
    tonicFifth,
  ));
  if (!resolves) return undefined;
  return createFunctionalCandidate(source, isRootDominantSeventh, { allowNonChordToneCandidates: true });
}

function continuesHeldDominant(
  previous: ChordInferenceObservation | undefined,
  source: ChordInferenceObservation,
  previousCandidates: DominantSixthsCandidateSet | undefined,
  manualPhraseTicks: readonly number[],
) {
  const bass = source.bass;
  return Boolean(previous && bass && !previous.localKey && continuesInKey(previous, source) &&
    !manualPhraseTicks.some(tick => previous.fromTick < tick && tick <= source.fromTick) &&
    continuesWrittenDominantSeventh(previous.activeNotes, source.activeNotes, bass.pitch) &&
    previousCandidates?.some(candidate =>
      candidate.functionalBaseId === "D" && isInPrintedKey(candidate) &&
      plainQuality(candidate, "dominant7") && exactDominantSixthReading(candidate) &&
      pitchClassEquals(candidate.identity.root, bass.pitch) && pitchClassEquals(candidate.identity.bass, bass.pitch),
    ));
}

export function withDominantSixthSubstitutions(
  observations: readonly ChordInferenceObservation[],
  sets: readonly DominantSixthsCandidateSet[],
  meetsMinimumConfidence: (candidate: ChordInferenceCandidate) => boolean,
  manualPhraseTicks: readonly number[] = [],
) {
  return sets.map((existing, observationIndex) => {
    const source = observations[observationIndex];
    const following = observations[observationIndex + 1];
    const soprano = source.activeNotes.soprano;
    const bass = source.bass;
    if (!source.completeSatb || source.soundingPitchClasses.length !== 4 ||
        soprano?.startTick !== source.fromTick || !bass ||
        !following?.completeSatb ||
        !continuesInKey(source, following) ||
        manualPhraseTicks.some(tick => source.fromTick < tick && tick <= following.fromTick) ||
        existing.some(candidate => candidate.confidence !== "low" && exactDominantSixthReading(candidate)) ||
        [source, following].some(item => observationNotes(item).some(({ note }) => note.nonChordToneRole))) return existing;

    const followingCandidates = sets[following.index];
    const newBass = bass.startTick === source.fromTick;
    const contextual = newBass && contextualFifthResolution(
      source, following, observations[observationIndex + 2], followingCandidates, manualPhraseTicks,
    );
    if (contextual) {
      const candidate = fitDominantSixthSubstitution(source, contextual, "fifth");
      return candidate && meetsMinimumConfidence(candidate) ? [...existing, candidate].sort(candidateComparator) : existing;
    }
    if (source.localKey || following.localKey ||
        !pitchClassEquals(bass.pitch, scaleDegreePitchClass(source.key, 5)) ||
        !pitchClassEquals(soprano.pitch, scaleDegreePitchClass(source.key, 3))) return existing;
    const anchor = newBass ? fifthResolution(source, following, followingCandidates) : undefined;
    const reading = anchor ?? tonicResolution(source, following, followingCandidates,
      !newBass && continuesHeldDominant(observations[observationIndex - 1], source, sets[observationIndex - 1], manualPhraseTicks));
    const candidate = reading && fitDominantSixthSubstitution(source, reading, anchor ? "fifth" : "tonic");
    return candidate && meetsMinimumConfidence(candidate)
      ? [...existing, candidate].sort(candidateComparator)
      : existing;
  });
}

const seventhTemplate: FunctionalChordTemplate = {
  baseId: "D", localKeyPolicy: "current-key", definition: functionalDefinition("D"),
  form: "seventh", expectedInversion: 0,
};

function connectsDominantNinth(a: ChordInferenceObservation, b: ChordInferenceObservation, boundaries: readonly number[]) {
  return a.toTick === b.fromTick && keyEquals(a.key, b.key) && !boundaries.some(tick => a.fromTick < tick && tick <= b.fromTick);
}

function written(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && !candidate.fit.nonChordToneNoteIds.length;
}

function suppliesPreparation(candidate: ChordInferenceCandidate) {
  if (!candidate.semantics || !written(candidate) || candidate.fit.omittedChordDegrees.length) return false;
  const reading = primaryHarmonyInterpretation(candidate.semantics);
  return !reading.appliedTarget && reading.designation?.primaryFunction === "subdominant";
}

function readDominantNinthVoicing(source: ChordInferenceObservation) {
  const bass = soundingBass(source);
  if (!bass || source.soundingPitchClasses.length !== 4 ||
      !pitchClassEquals(bass, scaleDegreePitchClass(source.key, 5))) return;
  const candidate = dominantNinthTemplates
    .map(template => createFunctionalCandidate(source, template, {}))
    .find(item => item && written(item));
  if (!candidate) return;
  const ninth = dominantNinthTone(candidate.identity);
  const seventh = chordIdentityToneSpellingForDegree(candidate.identity, 7);
  if (!ninth || !seventh) return;
  const voiceWithTone = (tone: SpelledPitchClass) => VOICE_ORDER.find(voice => {
    const note = source.activeNotes[voice];
    return note && !note.nonChordToneRole && pitchClassEquals(note.pitch, tone);
  });
  const ninthVoice = voiceWithTone(ninth);
  const seventhVoice = voiceWithTone(seventh);
  const ninthNote = ninthVoice && source.activeNotes[ninthVoice];
  if (!ninthNote || !seventhVoice) return;

  return { bass, candidate, ninthVoice, ninthNote, seventhVoice };
}

function proveDominantNinth(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  boundaries: readonly number[],
  index: number,
  source: ChordInferenceObservation,
  { bass, candidate, ninthVoice, ninthNote, seventhVoice }: NonNullable<ReturnType<typeof readDominantNinthVoicing>>,
) {
  const previous = observations[index - 1], landing = observations[index + 1];
  const retainsPitch = (other: ChordInferenceObservation, voice: VoiceId) => {
    const note = other.activeNotes[voice];
    const prior = source.activeNotes[voice];
    return !!prior && !!note && !note.nonChordToneRole && spelledPitchEquals(note.pitch, prior.pitch);
  };
  const heldFromPreparation = previous && connectsDominantNinth(previous, source, boundaries) &&
    previous.activeNotes[ninthVoice]?.id === ninthNote.id;
  const prepared = heldFromPreparation && sets[index - 1].some(suppliesPreparation) &&
    retainsPitch(previous, seventhVoice);
  const nextNote = landing && connectsDominantNinth(source, landing, boundaries) ? landing.activeNotes[ninthVoice] : undefined;
  const arrival = nextNote && !nextNote.nonChordToneRole && nextNote.startTick === landing.fromTick &&
    ninthNote.startTick + ninthNote.durationTicks === landing.fromTick ? nextNote : undefined;
  const tonic = arrival && sets[index + 1].some(target =>
    (target.functionalBaseId === "T" || target.functionalBaseId === "t") &&
    written(target) && !target.fit.omittedChordDegrees.length &&
    writtenDominantNinthResolves(candidate.identity, target.identity, ninthNote.pitch, arrival.pitch));
  const landingBass = arrival && soundingBass(landing);
  const suspension = arrival && landingBass && pitchClassEquals(landingBass, bass) &&
    pitchClassEquals(arrival.pitch, bass) &&
    VOICE_ORDER.filter(voice => voice !== "bass" && voice !== ninthVoice).every(voice => retainsPitch(landing, voice))
    ? createFunctionalCandidate(landing, seventhTemplate, {})
    : undefined;
  const resolvedSuspension = arrival && suspension && written(suspension) &&
    writtenDominantNinthResolves(candidate.identity, suspension.identity, ninthNote.pitch, arrival.pitch);
  if (!prepared && !tonic && !resolvedSuspension) return;

  const evidence: ChordInferenceEvidence[] = [];
  if (prepared) evidence.push({
    kind: "sequence-context", code: "dominant-ninth-preparation", noteIds: [ninthNote.id],
    details: { atTick: source.fromTick },
  });
  if (tonic && arrival) evidence.push({
    kind: "sequence-context", code: "dominant-ninth-to-tonic", noteIds: [ninthNote.id, arrival.id],
    details: { atTick: landing.fromTick },
  });
  if (resolvedSuspension && arrival) evidence.push({
    kind: "sequence-context", code: "dominant-ninth-same-root-9-8", noteIds: [ninthNote.id, arrival.id],
    details: { atTick: landing.fromTick },
  });
  const proven = {
    ...candidate,
    confidence: "high" as const,
    evidence: [...candidate.evidence, ...evidence],
  };
  return { proven, previous, landing, heldFromPreparation, resolvedSuspension, suspension };
}

function dominantNinthSuspensionAlternative(
  source: ChordInferenceObservation,
  { candidate, ninthNote }: NonNullable<ReturnType<typeof readDominantNinthVoicing>>,
  { previous, landing, heldFromPreparation, resolvedSuspension, suspension }: NonNullable<ReturnType<typeof proveDominantNinth>>,
  previousCandidates: readonly ChordInferenceCandidate[],
  options: ChordInferenceOptions,
) {
  const preparationBass = previous?.bass;
  const supportedSuspension = resolvedSuspension && suspension && options.allowNonChordToneCandidates !== false &&
    heldFromPreparation && preparationBass &&
    previousCandidates.some(anchor => soundsCompleteWrittenChord(
      anchor.identity, Object.values(previous.activeNotes).filter(note => note !== undefined), preparationBass,
    ) && !chordIdentityEquals(anchor.identity, candidate.identity)) &&
    preparedNinthOverDominantSeventh(
      suspension.identity, previous.activeNotes, source.activeNotes, landing.activeNotes,
      source.fromTick, landing.fromTick, source.metric, landing.metric,
    ) === ninthNote.id;
  return supportedSuspension
    ? fitPreparedSuspension(suspension, source, [{ noteId: ninthNote.id, figure: "9-8" }])
    : undefined;
}

/** Spasobin §23.3–5 supplies distinct facts about preparation and exit.
 * An accented ninth held from an exact preparation chord also permits a
 * parallel reading as a suspension over the written V7. */
export function withDominantNinths(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  boundaries: readonly number[],
  options: ChordInferenceOptions,
) {
  const result = sets.slice();
  const alternate = new Map<string, ChordInferenceCandidate>();
  for (const [index, source] of observations.entries()) {
    const voicing = readDominantNinthVoicing(source);
    if (!voicing) continue;
    const proof = proveDominantNinth(observations, sets, boundaries, index, source, voicing);
    if (!proof) continue;
    const { proven, resolvedSuspension, suspension } = proof;
    const otherReadings = result[index].filter(item => item.id !== proven.id &&
      (item.semantics || !chordIdentityEquals(item.identity, proven.identity)));
    const parallel = dominantNinthSuspensionAlternative(source, voicing, proof, sets[index - 1], options);
    // The same writing supports both accounts in §23.5. Keep the choice
    // alongside the literal path so its continuity bonus cannot erase V9.
    if (parallel) alternate.set(proven.id, { ...parallel, confidence: "high" });
    result[index] = [...otherReadings, proven].sort(candidateComparator);
    if (resolvedSuspension && suspension &&
        !result[index + 1].some(existing => existing.id === suspension.id && written(existing))) {
      result[index + 1] = [...result[index + 1].filter(existing => existing.id !== suspension.id), suspension]
        .sort(candidateComparator);
    }
  }
  return { candidates: result, alternate };
}

export function addDominantNinthAlternatives(
  regions: readonly ChordInferenceRegion[],
  alternate: ReadonlyMap<string, ChordInferenceCandidate>,
) {
  return Object.freeze(regions.map(region => {
    const literal = region.selected;
    if (!literal || region.observationIndices.length !== 1) return region;
    const choice = alternate.get(literal.id);
    if (!choice) {
      const structure = literal.identity.structure;
      const isolatedSmallNinth = literal.functionalBaseId === "D" && literal.confidence === "low" &&
        region.status === "ambiguous" && structure.kind === "tertian" && structure.extensions.includes(9) &&
        structure.alterations.some(change => change.degree === 9 && change.alter === -1) && written(literal);
      return isolatedSmallNinth ? { ...region, reviewCandidateIds: [literal.id] } : region;
    }
    return {
      ...region,
      reviewCandidateIds: [literal.id, choice.id],
      alternatives: Object.freeze([
        { ...choice, observationIndex: literal.observationIndex },
        ...region.alternatives.filter(item => !chordIdentityEquals(item.identity, choice.identity)),
      ].slice(0, 3)),
    };
  }));
}

type AppliedDominantsCandidateSet = readonly ChordInferenceCandidate[];

function exactAppliedDominantReading(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && !candidate.fit.nonChordToneNoteIds.length && !candidate.fit.omittedChordDegrees.length;
}

function tonicizationTargets(arrival: ChordInferenceObservation, candidates: AppliedDominantsCandidateSet) {
  const targets = new Map<ScaleDegree, "major" | "minor">();
  if (arrival.soundingPitchClasses.length !== 3) return targets;
  for (const candidate of candidates) {
    const { structure, root } = candidate.identity;
    if (!candidate.semantics || !exactAppliedDominantReading(candidate) || structure.kind !== "tertian" ||
        (structure.quality !== "major" && structure.quality !== "minor")) continue;
    const meaning = primaryHarmonyInterpretation(candidate.semantics);
    // V already has its own double-dominant templates.
    if (!meaning.appliedTarget && [2, 3, 4, 6, 7].includes(meaning.degree) &&
        pitchClassEquals(root, scaleDegreePitchClass(arrival.key, meaning.degree))) {
      targets.set(meaning.degree, structure.quality);
    }
  }
  return targets;
}

function leadingToneCandidates(
  source: ChordInferenceObservation, arrival: ChordInferenceObservation, target: ScaleDegree,
  mode: "major" | "minor", templates: readonly FunctionalChordTemplate[], options: ChordInferenceOptions,
) {
  if (source.soundingPitchClasses.length !== 4) return [];
  const tonic = scaleDegreePitchClass(source.key, target);
  const leading = leadingTonePitchClass({ tonic, mode });
  const resolves = (["soprano", "alto", "tenor", "bass"] as const).some(voice => {
    const before = source.activeNotes[voice]?.pitch, after = arrival.activeNotes[voice]?.pitch;
    return before && after && pitchClassEquals(before, leading) && pitchClassEquals(after, tonic) &&
      writtenInterval(before, after).semitones === 1;
  });
  if (!resolves) return [];
  const qualities: ChordQuality[] = mode === "major" ? ["halfDiminished7", "diminished7"] : ["diminished7"];
  const candidates: ChordInferenceCandidate[] = [];
  for (const template of templates.filter(t => t.baseId === "DVII" && t.form === "seventh")) {
    for (const quality of qualities) {
      const candidate = createFunctionalCandidate(source, {
        ...template, appliedTarget: target, definition: { ...template.definition, quality: () => quality },
      }, options);
      if (candidate?.confidence === "high" && exactAppliedDominantReading(candidate)) {
        candidates.push(withTargetEvidence(candidate, "applied-leading-seventh-resolution", target));
      }
    }
  }
  return candidates;
}

function withTargetEvidence(candidate: ChordInferenceCandidate, code: string, target: ScaleDegree): ChordInferenceCandidate {
  return { ...candidate, evidence: [...candidate.evidence, { kind: "sequence-context", code, details: { target } }] };
}

/** A chromatic dominant is an applied reading only when its written target follows. */
export function withAppliedDominants(
  observations: readonly ChordInferenceObservation[], sets: readonly AppliedDominantsCandidateSet[], options: ChordInferenceOptions,
  hardBoundaries: readonly number[] = [],
) {
  const result = sets.slice();
  let continuedTarget: ScaleDegree | undefined;
  for (let i = observations.length - 2; i >= 0; i--) {
    const source = observations[i], arrival = observations[i + 1];
    const nextTarget = continuedTarget;
    continuedTarget = undefined;
    if (!source.completeSatb || !arrival.completeSatb || !continuesInKey(source, arrival) ||
        source.key.id !== arrival.key.id ||
        hardBoundaries.some(tick => source.fromTick < tick && tick <= arrival.fromTick)) continue;
    // A tripled root and a single major third can articulate V without
    // its fifth. The third must lead by written semitone into an actual
    // tonic of the key or a witnessed diatonic target.
    if (!sets[i].length && options.minConfidence !== "high" && soundingBass(source) && source.soundingPitchClasses.length === 2) {
      for (const target of sets[i + 1]) {
        if (!target.semantics || !exactAppliedDominantReading(target) || target.identity.structure.kind !== "tertian" ||
            !["major", "minor"].includes(target.identity.structure.quality)) continue;
        const meaning = primaryHarmonyInterpretation(target.semantics);
        if (meaning.appliedTarget || meaning.degreeAlteration || !pitchClassEquals(target.identity.root, scaleDegreePitchClass(source.key, meaning.degree))) continue;
        const key = { tonic: target.identity.root, mode: "major" as const };
        const root = scaleDegreePitchClass(key, 5);
        if (!pitchClassEquals(source.bass!.pitch, root) || observationNotes(source).filter(({ note }) => pitchClassEquals(note.pitch, root)).length !== 3 ||
            !resolvesTone(source, arrival, leadingTonePitchClass(key), key.tonic, 1)) continue;
        const baseId = meaning.degree === 5 ? "DD" : "D";
        const candidate = createFunctionalCandidate(source, { baseId, definition: functionalDefinition(baseId), form: "triad",
          localKeyPolicy: "current-key", expectedInversion: 0, appliedTarget: [1, 5].includes(meaning.degree) ? undefined : meaning.degree },
        { ...options, allowedOmittedChordDegrees: [5] });
        if (candidate?.fit.spellingConsistent) result[i] = [withTargetEvidence(candidate, "resolved-dominant-without-fifth", meaning.degree)];
      }
    }
    const scale = Array.from({ length: 7 }, (_, index) => scaleDegreePitchClass(source.key, index + 1));
    if (source.key.mode === "minor") scale.push(leadingTonePitchClass(source.key));
    const diatonic = source.soundingPitchClasses.every(p => scale.some(tone => pitchClassEquals(p, tone)));
    if (diatonic && (source.soundingPitchClasses.length !== 4 || sets[i].some(exactAppliedDominantReading))) continue;

    let goal = arrival;
    let arrivals = tonicizationTargets(goal, sets[i + 1]);
    // A target bass can arrive before a prepared upper voice settles. Require
    // the same bass pitch and a complete written target within one pulse.
    if (!arrivals.size && !sets[i + 1].some(exactAppliedDominantReading) && soundingBass(arrival)) {
      for (let j = i + 2; j < observations.length; j++) {
        const next = observations[j];
        if (!continuesInKey(observations[j - 1], next) || source.key.id !== next.key.id ||
            next.fromTick - arrival.fromTick > (arrival.measureBeatTicks ?? 0) ||
            hardBoundaries.some(t => arrival.fromTick < t && t <= next.fromTick) ||
            !next.bass || !spelledPitchEquals(next.bass.pitch, arrival.bass!.pitch)) break;
        arrivals = tonicizationTargets(next, sets[j]);
        if (arrivals.size) { goal = next; break; }
        if (sets[j].some(exactAppliedDominantReading)) break;
      }
    }
    const targets = new Set(arrivals.keys());
    if (nextTarget) targets.add(nextTarget);
    if (!targets.size) continue;
    const templates = buildFunctionalTemplates(source.key);
    const added = [...arrivals].flatMap(([target, mode]) => leadingToneCandidates(source, goal, target, mode, templates, options));
    if (added.length && arrivals.size === 1) continuedTarget = [...arrivals.keys()][0];
    const hasHomeReading = sets[i].some(exactAppliedDominantReading);
    for (const template of templates.filter(t => t.baseId === "D" && t.form !== "ninth")) {
      // A fifth relationship alone cannot displace a well-spelled home triad.
      if (template.form === "triad" && hasHomeReading) continue;
      for (const target of targets) {
        const candidate = createFunctionalCandidate(source, { ...template, appliedTarget: target }, options);
        if (!candidate || candidate.confidence !== "high" || !exactAppliedDominantReading(candidate)) continue;
        continuedTarget = target;
        added.push(withTargetEvidence(candidate, "applied-dominant-resolution", target));
      }
    }
    if (added.length) result[i] = [...sets[i], ...added].sort(candidateComparator);
  }
  return result;
}

/** Recover a tonicization when the resolution triad is established one
 * event after the dominant's written target bass arrives. */
export function withReattackedTonicNinths(
  observations: readonly ChordInferenceObservation[],
  sets: readonly AppliedDominantsCandidateSet[],
  options: ChordInferenceOptions,
  phraseBoundaryTicks: readonly number[],
) {
  const result = sets.slice();
  for (let i = 0; i + 2 < observations.length; i++) {
    const [source, onset, settled] = [observations[i], observations[i + 1], observations[i + 2]];
    if ([onset, settled].some(part => !keyDeclarationEquals(part.key, source.key)) ||
        phraseBoundaryTicks.some(tick => source.fromTick < tick && tick <= settled.fromTick) ||
        !onset.metric || !settled.metric || onset.metric.level < 2 ||
        onset.metric.measureNumber !== settled.metric.measureNumber ||
        settled.metric.beatPosition - onset.metric.beatPosition > 1 ||
        compareMetricStrength(onset.metric, settled.metric) !== "stronger") continue;
    const proof = readReattackedTonicNinth(writtenFrame(source), writtenFrame(onset), tick =>
      tick === settled.fromTick ? writtenFrame(settled) : undefined);
    if (!proof || sets[i + 1].some(exactAppliedDominantReading)) continue;
    const { tonic, mode } = proof.key;
    const anchor = sets[i + 2].find(candidate => exactAppliedDominantReading(candidate) && candidate.fit.bassMatchesInversion &&
      candidate.identity.structure.kind === "tertian" && candidate.identity.structure.quality === mode &&
      !candidate.identity.structure.extensions.length && !candidate.identity.structure.alterations.length &&
      pitchClassEquals(candidate.identity.root, tonic) && pitchClassEquals(candidate.identity.bass, tonic));
    if (!anchor) continue;

    const hasSource = sets[i].some(candidate => exactAppliedDominantReading(candidate) && candidate.fit.bassMatchesInversion &&
      candidate.identity.structure.kind === "tertian" && candidate.identity.structure.quality === "dominant7" &&
      !candidate.identity.structure.extensions.length && !candidate.identity.structure.alterations.length &&
      pitchClassEquals(candidate.identity.root, proof.root));
    const evidence = { kind: "sequence-context" as const, code: "reattacked-tonic-ninth-resolution",
      noteIds: [proof.repeated.id], details: { arrivalTick: onset.fromTick, confirmationTick: proof.settledTick } };
    if (!hasSource) {
      const target = [...tonicizationTargets(settled, [anchor]).keys()][0];
      if (!target) continue;
      const template = buildFunctionalTemplates(source.key).find(item =>
        item.baseId === "D" && item.form === "seventh" && item.expectedInversion === 1);
      const candidate = template && createFunctionalCandidate(source, { ...template, appliedTarget: target }, options);
      if (candidate?.confidence !== "high" || !exactAppliedDominantReading(candidate) ||
          !pitchClassEquals(candidate.identity.root, proof.root)) continue;
      result[i] = [...result[i], { ...candidate, evidence: [...candidate.evidence, evidence] }].sort(candidateComparator);
    }
    if (options.allowNonChordToneCandidates === false || options.minConfidence === "high") continue;
    const candidate = fitPreparedSuspension(anchor, onset, [{ noteId: proof.repeated.id, figure: "9-8" }]);
    if (!candidate) continue;
    const fit = { ...candidate.fit, nonChordToneAssignments: { ...candidate.fit.nonChordToneAssignments,
      [proof.repeated.id]: "suspension" as const } };
    result[i + 1] = [...result[i + 1], { ...candidate, fit, evidence: [...candidate.evidence, evidence] }]
      .sort(candidateComparator);
  }
  return result;
}

const degrees = [1, 2, 3, 4, 5, 6, 7] as const;

/** In harmonic major the lowered sixth gives iiø7 (§21.1) or the
 * diminished supertonic in first inversion (§19.1). */
export function harmonicMajorPreparation(item: ChordInferenceObservation, next: ChordInferenceObservation, key: KeyReference) {
  if (key.mode !== "major" || !item.completeSatb || !next.completeSatb || !item.bass || !next.bass ||
      ![3, 4].includes(item.soundingPitchClasses.length) || observationNotes(item).some(({ note }) => note.nonChordToneRole)) return;
  const quality: "halfDiminished7" | "diminished" = item.soundingPitchClasses.length === 4 ? "halfDiminished7" : "diminished";
  const ii = chordToneSpellings(scaleDegreePitchClass(key, 2), quality);
  if (!ii.every(tone => item.soundingPitchClasses.some(p => pitchClassEquals(p, tone)))) return;
  const inversion = ii.findIndex(tone => pitchClassEquals(tone, item.bass!.pitch)) as 0 | 1 | 2 | 3;
  if (quality === "diminished" && inversion !== 1) return;
  const dominant = scaleDegreePitchClass(key, 5);
  const exactTriad = (tones: ReturnType<typeof chordToneSpellings>) =>
    tones.every(tone => next.soundingPitchClasses.some(p => pitchClassEquals(p, tone))) &&
    next.soundingPitchClasses.length === tones.length;
  const seventh = readWrittenDominantSeventh(next.activeNotes);
  if (seventh && pitchClassEquals(seventh.root, dominant) ||
      exactTriad(chordToneSpellings(dominant, "major")) ||
      pitchClassEquals(next.bass.pitch, dominant) && inversion !== 3 && exactTriad(chordToneSpellings(key.tonic, "major")))
    return { inversion, quality };
}

/** Recognize a sequence only after two consecutive fourth-related root
 * changes. The written sonority of each link supplies its root and quality;
 * the link alone does not establish a new key. */
function appliedSequenceIndices(
  observations: readonly ChordInferenceObservation[],
  stacks: readonly ReturnType<typeof readWrittenDominantSeventh>[],
  connected: (left: ChordInferenceObservation, right: ChordInferenceObservation) => boolean,
) {
  const chain = new Set<number>();
  let start = 0, links = 0;
  for (let i = 0; i < stacks.length; i++) {
    const current = stacks[i], next = stacks[i + 1];
    if (current && next && connected(observations[i], observations[i + 1])) {
      if (pitchClassEquals(current.root, next.root)) continue;
      if (pitchClassValue(current.target) === pitchClassValue(next.root)) {
        links++;
        if (links >= 2) {
          for (let j = start; j <= i; j++) chain.add(j);
          start = i + 1;
        }
        continue;
      }
    }
    start = i + 1;
    links = 0;
  }
  return chain;
}

export function withAppliedSequences(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
  hardBoundaries: readonly number[] = [],
) {
  const connected = (left: ChordInferenceObservation, right: ChordInferenceObservation) =>
    continuesInKey(left, right) && left.key.id === right.key.id &&
    !hardBoundaries.some(tick => left.fromTick < tick && tick <= right.fromTick);
  const stacks = observations.map(item => readWrittenDominantSeventh(item.activeNotes));
  const chain = appliedSequenceIndices(observations, stacks, connected);
  return observations.map((item, i) => {
    const existing = sets[i];
    const next = observations[i + 1];
    if (next && connected(item, next)) {
      const prep = harmonicMajorPreparation(item, next, item.key);
      if (prep) {
        const chord = createFunctionalCandidate(item, {
          baseId: "SII", definition: { ...functionalDefinition("SII"), quality: () => prep.quality },
          form: prep.quality === "diminished" ? "triad" : "seventh",
          expectedInversion: prep.inversion, localKeyPolicy: "current-key",
        }, options);
        if (chord) return [...existing.filter(c => c.id !== chord.id), { ...chord, id: chord.id + ":harmonic-major", evidence: [...chord.evidence,
          { kind: "sequence-context" as const, code: "harmonic-major-supertonic" }] }];
      }
    }
    const stack = stacks[i];
    if (!stack || !chain.has(i)) return existing;
    // At an enharmonic pivot the source spelling still determines the written
    // target (e.g. Db7 points to Gb even if the next root is spelled F#).
    const target = degrees.find(degree => pitchClassEquals(scaleDegreePitchClass(item.key, degree), stack.target));
    const matching = existing.find(c => c.functionalBaseId && c.fit.spellingConsistent &&
      c.identity.structure.kind === "tertian" && c.identity.structure.quality === "dominant7" &&
      pitchClassEquals(c.identity.root, stack.root));
    const local = target ? item : { ...item, key: { ...item.key, tonic: stack.target, mode: "major" as const }, localKey: undefined };
    const chord = matching ?? createFunctionalCandidate(local, {
      baseId: "D", definition: functionalDefinition("D"), form: "seventh", expectedInversion: stack.inversion,
      localKeyPolicy: "current-key", appliedTarget: target === 1 ? undefined : target,
    }, { ...options, allowIncompleteVoicing: true });
    if (!chord || options.minConfidence === "high" && chord.confidence !== "high") return existing;
    const candidate = { ...chord,
      // Applied targets in the document format carry a diatonic degree only.
      // Keep the absolute identity and resolution evidence for a chromatic target.
      ...(!target && !matching ? { semantics: undefined, functionalBaseId: undefined } : {}),
      evidence: [...chord.evidence, { kind: "sequence-context" as const, code: "dominant-seventh-chain",
        details: { targetStep: stack.target.step, targetAlter: stack.target.alter } }],
    };
    return [candidate, ...existing.filter(c => c !== matching && c.fit.spellingConsistent)];
  });
}

type Frame = ChordInferenceObservation;
type DoubleAugmentedFourThreeCandidateSet = readonly ChordInferenceCandidate[];

const doubleAugmentedFourThree: FunctionalChordTemplate = {
  baseId: "DD++43",
  definition: functionalDefinition("DD++43"),
  form: "triad",
  localKeyPolicy: "current-key",
  expectedInversion: 0,
};

function exact(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && candidate.fit.bassMatchesInversion &&
    !candidate.fit.omittedChordDegrees.length && !candidate.fit.nonChordToneNoteIds.length &&
    !candidate.fit.extraPitchClasses.length;
}

function connectsDoubleAugmentedFourThree(left: Frame, right: Frame, boundaries: readonly number[]) {
  return continuesInKey(left, right) &&
    !boundaries.some(tick => left.fromTick < tick && tick <= right.fromTick);
}

function hasDominantBassAnchor(frame: Frame, set: DoubleAugmentedFourThreeCandidateSet) {
  const bass = soundingBass(frame);
  if (!bass || !pitchClassEquals(bass, scaleDegreePitchClass(frame.key, 5))) return false;
  return set.some(candidate => exact(candidate) &&
    (isMajorTonicSixFour(candidate.identity, frame.key) ||
      (candidate.functionalBaseId === "D" && pitchClassEquals(candidate.identity.root, bass))));
}

function hasRootTonic(frame: Frame, set: DoubleAugmentedFourThreeCandidateSet) {
  const bass = soundingBass(frame);
  return !!bass && pitchClassEquals(bass, frame.key.tonic) &&
    set.some(candidate => candidate.functionalBaseId === "T" && exact(candidate) &&
      pitchClassEquals(candidate.identity.root, bass));
}

/** The written ♯2 distinguishes DD++43 from Ger+6 (Spasobin 30-451).
 * An independently sounded tonic or dominant frame establishes the key,
 * while the resolution rule remains responsible for individual motions. */
export function withDoubleAugmentedFourThree(
  observations: readonly Frame[],
  sets: readonly DoubleAugmentedFourThreeCandidateSet[],
  manualPhraseTicks: readonly number[],
  meetsMinimumConfidence: (candidate: ChordInferenceCandidate) => boolean,
) {
  return sets.map((existing, index) => {
    const before = observations[index];
    const after = observations[index + 1];
    const bass = soundingBass(before);
    if (before.key.mode !== "major" || before.soundingPitchClasses.length !== 4 ||
        !bass || !pitchClassEquals(bass, scaleDegreePitchClass(before.key, 6, -1)) ||
        !after || !connectsDoubleAugmentedFourThree(before, after, manualPhraseTicks)) return existing;

    const candidate = createFunctionalCandidate(before, doubleAugmentedFourThree, {});
    if (!candidate || !exact(candidate) || !meetsMinimumConfidence(candidate)) return existing;
    if (!resolvesDoubleAugmentedFourThree(before.activeNotes, after.activeNotes, before.key)) {
      // Retain other exact readings when the near context is inconclusive.
      if (existing.some(exact)) return existing;
      const previous = observations[index - 1];
      const settled = observations[index + 2];
      const metric = after.metric;
      const hasNearAnchor = settled && metric && after.bass && !sets[index + 1].some(exact) &&
        after.bass.id === settled.bass?.id && connectsDoubleAugmentedFourThree(after, settled, manualPhraseTicks) &&
        settled.metric?.measureNumber === metric.measureNumber &&
        settled.metric.beatPosition - metric.beatPosition <= 1 &&
        hasDominantBassAnchor(settled, sets[index + 2]);
      const returnsToTonic = previous && connectsDoubleAugmentedFourThree(previous, before, manualPhraseTicks) &&
        hasRootTonic(previous, sets[index - 1]) && hasRootTonic(after, sets[index + 1]) &&
        VOICE_ORDER.some(voice => {
          const note = before.activeNotes[voice];
          return note && pitchClassEquals(note.pitch, before.key.tonic) &&
            previous.activeNotes[voice]?.id === note.id && after.activeNotes[voice]?.id === note.id;
        });
      if (!hasDominantBassAnchor(after, sets[index + 1]) && !hasNearAnchor && !returnsToTonic) return existing;
    }
    return [...existing.filter(item => item.functionalBaseId !== "Ger+6"), candidate].sort(candidateComparator);
  });
}

const isDeceptiveRootDominantSeventh = {
  baseId: "D",
  definition: functionalDefinition("D"),
  form: "seventh",
  expectedInversion: 0,
  localKeyPolicy: "current-key",
} as const;

function hasNearbyMinorTonic(
  observations: readonly ChordInferenceObservation[], arrivalIndex: number, key: KeyReference,
  ppq: number, crossesPhrase: (from: number, to: number) => boolean,
) {
  const arrival = observations[arrivalIndex];
  const tones = chordToneSpellings(key.tonic, "minor");
  for (let i = arrivalIndex + 1; i < observations.length; i++) {
    const item = observations[i];
    const previous = observations[i - 1];
    if (!item.completeSatb || previous.toTick !== item.fromTick || item.key.id !== arrival.key.id ||
        crossesPhrase(previous.fromTick, item.fromTick) || item.fromTick - arrival.fromTick > 2 * ppq) break;
    // A tonic stack may begin the hypothesized local key. A different inferred key ends the search.
    if (item.localKey && !keyEquals(item.localKey, key)) break;
    const bass = item.bass?.pitch;
    if (bass && (item.activeNotes.bass?.startTick === item.fromTick) &&
        (pitchClassEquals(bass, tones[0]) || pitchClassEquals(bass, tones[2])) &&
        hasExactWrittenStack(item, tones)) return true;
  }
  return false;
}

/** Recover an otherwise missing source when a local minor target is independently supported. */
export function withDeceptiveDominants(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions, ppq: number, phraseBoundaryTicks: readonly number[],
) {
  const crossesPhrase = (from: number, through: number) =>
    phraseBoundaryTicks.some(tick => from < tick && tick <= through);
  return sets.map((existing, i) => {
    if (existing.length) return existing;
    const source = observations[i], arrival = observations[i + 1];
    if (!arrival || !keyDeclarationEquals(source.key, arrival.key) ||
        arrival.metric?.role !== "downbeat" || crossesPhrase(source.fromTick, arrival.fromTick)) return existing;

    const proof = proveLocalMinorDeceptiveDominant(source, arrival);
    if (!proof) return existing;
    const { key } = proof;
    const appliedTarget = diatonicMinorTarget(source.key, key.tonic);
    if (!appliedTarget && !hasNearbyMinorTonic(observations, i + 1, key, ppq, crossesPhrase)) return existing;

    const candidate = appliedTarget
      ? createFunctionalCandidate(source, { ...isDeceptiveRootDominantSeventh, appliedTarget }, options)
      : createFunctionalCandidate({ ...source, key: { ...source.key, ...key }, localKey: key }, isDeceptiveRootDominantSeventh, options);
    if (!candidate || candidate.confidence !== "high") return existing;
    // This source-only reading supplies neither cadence nor key-span evidence.
    return [{ ...candidate, evidence: [
      ...candidate.evidence.filter(evidence => appliedTarget || evidence.code !== "local-key-cadence"),
      { kind: "sequence-context" as const, code: "local-deceptive-dominant-resolution",
        details: { targetStep: key.tonic.step, targetAlter: key.tonic.alter } },
    ] }];
  });
}
