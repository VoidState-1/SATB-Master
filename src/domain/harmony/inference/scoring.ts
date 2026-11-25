import {
  chordVoicingPolicy,
  chordIdentityToneSpellingForDegree,
  chordIdentityToneSpellings,
  type ChordIdentity,
  type ChordToneDegree,
  resolveChordIdentity,
  functionalTargetForDegree,
  semanticsFromChordDraft,
  type ChordDraft,
  type HarmonySemantics,
  type KeyReference,
  primaryHarmonyInterpretation,
} from "../../chordModel";
import { keyEquals, scaleDegreePitchClass, pitchClassEquals, pitchClassValue, type SpelledPitchClass } from "../../pitch";
import type { NonChordToneRole, KeyEvent } from "../../project";
import { tonalReading } from "../facts/localTonality";
import { hasCompleteWrittenTertianVoicing } from "../facts/writtenVoicing";
import { observationNotes } from "./observations";
import type {
  ChordFitAssessment,
  ChordInferenceObservation,
  FunctionalChordTemplate,
  ChordInferenceCandidate,
} from "./types";
import {
  applyFunctionalDefinition,
  applyFunctionalTarget,
  FUNCTIONAL_BASE_DEFINITIONS,
  functionalDefinition,
  type FunctionalBaseDefinition,
  type FunctionalBaseId,
  type FunctionalChordForm,
} from "../../functionalHarmonyCatalog";

export interface ChordFitOptions {
  readonly allowIncompleteVoicing?: boolean;
  /** 在不放宽其他构成音的前提下，允许指定音级省略。 */
  readonly allowedOmittedChordDegrees?: readonly ChordToneDegree[];
  readonly allowNonChordToneCandidates?: boolean;
}

/** 第一阶段只把一个缺失和弦音视为可接受的不完整织体。 */
const MAX_INFERRED_OMISSIONS = 1;

/** Recognize a literal competing chord even when the local functional
 * catalogue does not offer a candidate with this root and quality. */
export function hasCompleteWrittenTertianChord(observation: ChordInferenceObservation) {
  return hasCompleteWrittenTertianVoicing(observationNotes(observation).map(({ note }) => note.pitch));
}

function chordDegrees(identity: ChordIdentity): readonly ChordToneDegree[] {
  if (identity.structure.kind !== "tertian") return [];
  return chordVoicingPolicy(identity).requiredDegrees;
}

function sameSoundingPitch(left: SpelledPitchClass, right: SpelledPitchClass) {
  return pitchClassValue(left) === pitchClassValue(right);
}

function matchingToneIndex(
  tones: readonly ReturnType<typeof chordIdentityToneSpellings>[number][],
  pitch: SpelledPitchClass,
) {
  const exact = tones.findIndex((tone) => pitchClassEquals(tone, pitch));
  if (exact >= 0) return { index: exact, exact: true };
  const sounding = tones.findIndex((tone) => sameSoundingPitch(tone, pitch));
  return sounding >= 0 ? { index: sounding, exact: false } : undefined;
}

function distinctMatchedToneCount(
  tones: readonly ReturnType<typeof chordIdentityToneSpellings>[number][],
  notes: ReturnType<typeof observationNotes>,
) {
  const matched = new Set<number>();
  for (const { note } of notes) {
    const match = matchingToneIndex(tones, note.pitch);
    if (match) matched.add(pitchClassValue(tones[match.index]));
  }
  return matched.size;
}

function uniqueExtraPitchClasses(
  notes: ReturnType<typeof observationNotes>,
  tones: readonly ReturnType<typeof chordIdentityToneSpellings>[number][],
) {
  const seen = new Set<number>();
  const extras = notes.flatMap(({ note }) => {
    if (matchingToneIndex(tones, note.pitch)) return [];
    const value = pitchClassValue(note.pitch);
    if (seen.has(value)) return [];
    seen.add(value);
    return [{ step: note.pitch.step, alter: note.pitch.alter }];
  });
  return Object.freeze(extras);
}

function assignmentsFor(
  notes: ReturnType<typeof observationNotes>,
  nonChordToneNoteIds: readonly string[],
) {
  const selected = new Set(nonChordToneNoteIds);
  return Object.freeze(
    Object.fromEntries(
      notes.flatMap(({ note }) => {
        const role = note.nonChordToneRole as NonChordToneRole | undefined;
        return role && selected.has(note.id) ? [[note.id, role]] : [];
      }),
    ) as Record<string, NonChordToneRole>,
  );
}

/**
 * 四声部中“根音三次 + 三音一次”的根位主和弦省五音写法。
 * 这是一个明确的教学型配置，不要求前一个观察区间已经被识别为 D。
 */
export function isCanonicalTonicFifthOmission(
  observation: ChordInferenceObservation,
  identity: ChordIdentity,
) {
  if (
    !observation.completeSatb ||
    identity.structure.kind !== "tertian" ||
    (identity.structure.quality !== "major" &&
      identity.structure.quality !== "minor") ||
    identity.structure.extensions.length > 0 ||
    identity.structure.alterations.length > 0
  )
    return false;

  const root = chordIdentityToneSpellingForDegree(identity, 1);
  const third = chordIdentityToneSpellingForDegree(identity, 3);
  const fifth = chordIdentityToneSpellingForDegree(identity, 5);
  const notes = observationNotes(observation);
  if (!root || !third || !fifth || notes.length !== 4) return false;
  if (!observation.bass || !sameSoundingPitch(observation.bass.pitch, root))
    return false;

  const rootCount = notes.filter(({ note }) =>
    sameSoundingPitch(note.pitch, root),
  ).length;
  const thirdCount = notes.filter(({ note }) =>
    sameSoundingPitch(note.pitch, third),
  ).length;
  const fifthCount = notes.filter(({ note }) =>
    sameSoundingPitch(note.pitch, fifth),
  ).length;
  const onlyRootAndThird = notes.every(({ note }) =>
    sameSoundingPitch(note.pitch, root) || sameSoundingPitch(note.pitch, third),
  );

  return rootCount === 3 && thirdCount === 1 && fifthCount === 0 && onlyRootAndThird;
}

function classifyChordNotes(
  notes: ReturnType<typeof observationNotes>,
  tones: readonly SpelledPitchClass[],
) {
  const chordToneNoteIds: string[] = [];
  const nonChordToneNoteIds: string[] = [];
  const spellingMatches: string[] = [];

  for (const { note } of notes) {
    const match = matchingToneIndex(tones, note.pitch);
    if (!match) {
      nonChordToneNoteIds.push(note.id);
    } else {
      chordToneNoteIds.push(note.id);
      if (match.exact) spellingMatches.push(note.id);
    }
  }
  return {
    chordToneNoteIds,
    nonChordToneNoteIds,
    spellingConsistent: chordToneNoteIds.length === 0 || spellingMatches.length === chordToneNoteIds.length,
  };
}

function chordFitRejection(
  notes: ReturnType<typeof observationNotes>,
  tones: readonly SpelledPitchClass[],
  identity: ChordIdentity,
  bassMatchesInversion: boolean,
  nonChordToneNoteIds: readonly string[],
  omittedChordDegrees: readonly ChordToneDegree[],
  options: ChordFitOptions,
) {
  const declaredExtra = nonChordToneNoteIds.every((id) =>
    notes.some(({ note }) => note.id === id && note.nonChordToneRole),
  );
  let hardRejected: string | undefined;
  if (notes.length === 0) hardRejected = "no-active-notes";
  else if (!bassMatchesInversion) hardRejected = "bass-mismatch";
  else if (
    identity.structure.kind === "augmented-sixth" &&
    tones.some((tone) =>
      !notes.some(({ note }) => matchingToneIndex([tone], note.pitch)),
    )
  )
    // These variants require their complete pitch structure, including the
    // augmented sixth; tertian degree-omission policies do not apply.
    hardRejected = "missing-augmented-sixth-tone";
  else if (
    nonChordToneNoteIds.length > 0 &&
    !declaredExtra &&
    !options.allowNonChordToneCandidates
  )
    hardRejected = "unexplained-extra-tone";
  else if (omittedChordDegrees.length > MAX_INFERRED_OMISSIONS)
    hardRejected = "too-many-omitted-chord-tones";
  else if (
    omittedChordDegrees.length > 0 &&
    !options.allowIncompleteVoicing &&
    !omittedChordDegrees.every((degree) =>
      options.allowedOmittedChordDegrees?.includes(degree),
    )
  )
    hardRejected = "omitted-chord-tone";
  return hardRejected;
}

export function fitChordObservation(
  observation: ChordInferenceObservation,
  identity: ChordIdentity,
  options: ChordFitOptions = {},
): ChordFitAssessment {
  const notes = observationNotes(observation);
  const tones = chordIdentityToneSpellings(identity);
  const { chordToneNoteIds, nonChordToneNoteIds, spellingConsistent } = classifyChordNotes(notes, tones);

  const omittedChordDegrees = chordDegrees(identity).filter((degree) => {
    const tone = chordIdentityToneSpellingForDegree(identity, degree);
    return tone && !notes.some(({ note }) => matchingToneIndex([tone], note.pitch));
  });
  const bassMatchesInversion =
    !observation.bass ||
    sameSoundingPitch(observation.bass.pitch, identity.bass);
  const hardRejected = chordFitRejection(
    notes, tones, identity, bassMatchesInversion, nonChordToneNoteIds, omittedChordDegrees, options,
  );

  return {
    matchedNoteIds: Object.freeze(notes.map(({ note }) => note.id)),
    chordToneNoteIds: Object.freeze(chordToneNoteIds),
    nonChordToneNoteIds: Object.freeze(nonChordToneNoteIds),
    nonChordToneAssignments: assignmentsFor(notes, nonChordToneNoteIds),
    omittedChordDegrees: Object.freeze(omittedChordDegrees),
    extraPitchClasses: uniqueExtraPitchClasses(notes, tones),
    bassMatchesInversion,
    spellingConsistent,
    ...(hardRejected ? { hardRejected } : {}),
  };
}

export function fitRatio(
  observation: ChordInferenceObservation,
  identity: ChordIdentity,
  fit: ChordFitAssessment,
) {
  const tones = chordIdentityToneSpellings(identity);
  const matched = distinctMatchedToneCount(tones, observationNotes(observation));
  return tones.length === 0 ? 0 : matched / tones.length;
}

const largeDominantNinth: FunctionalChordTemplate = {
  baseId: "D", definition: functionalDefinition("D"), form: "ninth",
  localKeyPolicy: "current-key", expectedInversion: 0,
};
export const smallNinthAlteration = { degree: 9, alter: -1 } as const;
const smallDominantNinth: FunctionalChordTemplate = {
  ...largeDominantNinth, alterations: [smallNinthAlteration],
};

export const dominantNinthTemplates = [largeDominantNinth, smallDominantNinth] as const;

function inversionsFor(
  definition: FunctionalBaseDefinition,
  form: FunctionalChordForm,
) {
  if (definition.fixedInversion !== undefined)
    return [definition.fixedInversion] as const;
  const maximum =
    form === "ninth"
      ? 0
      : form === "seventh"
        ? 3
        : 2;
  return Array.from({ length: maximum + 1 }, (_, index) =>
    index as 0 | 1 | 2 | 3,
  );
}

export function buildFunctionalTemplates(
  key: KeyEvent,
): readonly FunctionalChordTemplate[] {
  return Object.freeze(
    FUNCTIONAL_BASE_DEFINITIONS.filter((definition) =>
      definition.id !== "DD++43" &&
      (key.mode === "minor" || (definition.id !== "dtIII" && definition.id !== "dVII")),
    ).flatMap((definition) =>
      definition.forms.flatMap((form) =>
        inversionsFor(definition, form).map((expectedInversion) => ({
          baseId: definition.id,
          definition,
          form,
          localKeyPolicy: "current-key" as const,
          expectedInversion,
        })),
      ),
    ),
  );
}

export function draftForFunctionalTemplate(
  template: FunctionalChordTemplate,
  key: KeyEvent,
): ChordDraft {
  const { definition, form, expectedInversion } = template;
  const quality = definition.quality(key.mode, form);
  const draft = applyFunctionalDefinition(
    {
      degree: 1,
      degreeAlteration: 0,
      quality,
      extensions: form === "ninth" ? [9] : [],
      alterations: [],
      inversion: expectedInversion,
      source: "inferred",
      confidence: "probable",
    },
    definition,
    key.mode,
  );
  return {
    ...(template.appliedTarget
      ? applyFunctionalTarget(draft, functionalTargetForDegree(template.appliedTarget), key.mode)
      : draft),
    ...(template.alterations ? { alterations: [...template.alterations] } : {}),
    interpretationId: `inferred:${definition.id}:${form}:${expectedInversion}${template.appliedTarget ? "/" + template.appliedTarget : ""}`,
    source: "inferred",
    confidence: "probable",
  };
}

export function identityForFunctionalTemplate(
  template: FunctionalChordTemplate,
  key: KeyEvent,
  localKey?: KeyReference,
) {
  const draft = { ...draftForFunctionalTemplate(template, key), localKey };
  return {
    draft,
    identity: resolveChordIdentity(draft, key),
    semantics: semanticsFromChordDraft(draft),
  } satisfies {
    draft: ChordDraft;
    identity: ChordIdentity;
    semantics: HarmonySemantics;
  };
}

export function functionalTier(baseId: FunctionalBaseId): 0 | 1 | 2 {
  if (baseId === "DD" || baseId === "DDVII") return 1;
  if (
    baseId === "K46" ||
    baseId === "N6" ||
    baseId === "It+6" ||
    baseId === "Fr+6" ||
    baseId === "Ger+6" ||
    baseId === "DD++43"
  )
    return 2;
  return 0;
}

export function functionalTemplateKey(
  template: FunctionalChordTemplate,
  key: KeyReference,
) {
  const target = template.appliedTarget ? `/${template.appliedTarget}` : "";
  const alterations = template.alterations?.map(({ degree, alter }) => `:${degree}(${alter})`).join("") ?? "";
  return `${key.tonic.step}:${key.tonic.alter}:${key.mode}:${template.baseId}:${template.form}:${template.expectedInversion}${target}${alterations}`;
}

function samePitchStructure(
  left: ChordInferenceCandidate,
  right: ChordInferenceCandidate,
) {
  return JSON.stringify(left.identity) === JSON.stringify(right.identity);
}

function transitionScore(
  previous: ChordInferenceCandidate,
  current: ChordInferenceCandidate,
  previousObservation: ChordInferenceObservation,
  currentObservation: ChordInferenceObservation,
) {
  if (previousObservation.key.id !== currentObservation.key.id) return 0;
  const previousReading = tonalReading(previous.semantics, previousObservation.key);
  const currentReading = tonalReading(current.semantics, currentObservation.key);
  const sameCenter = keyEquals(previousReading.key, currentReading.key);
  let score = 0;
  if (samePitchStructure(previous, current)) score += 8;
  if (
    previous.functionalBaseId &&
    previous.functionalBaseId === current.functionalBaseId
  )
    score += 4;
  if (
    previous.identity.root.step === current.identity.root.step &&
    previous.identity.root.alter === current.identity.root.alter
  )
    score += 3;
  const target = previousReading.interpretation?.appliedTarget;
  const currentDegree = currentReading.interpretation?.degree;
  if (target && (sameCenter ? currentDegree === target.degree :
      currentDegree === 1 && pitchClassEquals(current.identity.root, currentReading.key.tonic) &&
      pitchClassEquals(currentReading.key.tonic, scaleDegreePitchClass(previousReading.key, target.degree)))) score += 10;
  if (
    sameCenter && (previous.functionalBaseId === "K46" ||
      previous.functionalBaseId === "N6" ||
      previous.functionalBaseId === "It+6" ||
      previous.functionalBaseId === "Fr+6" ||
      previous.functionalBaseId === "Ger+6") &&
    current.functionalBaseId === "D"
  )
    score += 14;
  if (
    currentObservation.metric?.role === "subdivision" &&
    !samePitchStructure(previous, current)
  )
    score -= 2;
  if (previousObservation.key.mode !== currentObservation.key.mode) score -= 8;
  if (
    previousObservation.key.tonic.step !== currentObservation.key.tonic.step ||
    previousObservation.key.tonic.alter !== currentObservation.key.tonic.alter
  )
    score -= 8;
  return score;
}

interface PathState {
  readonly score: number;
  readonly previousIndex?: number;
}

function forwardPathStates(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
  fromIndex: number,
  toIndex: number,
) {
  const states: PathState[][] = [];
  for (let index = fromIndex; index < toIndex; index += 1) {
    const currentCandidates = candidateSets[index].slice(0, 32);
    const currentStates: PathState[] = [];
    for (let candidateIndex = 0; candidateIndex < currentCandidates.length; candidateIndex += 1) {
      const candidate = currentCandidates[candidateIndex];
      let best: PathState = {
        score: index === fromIndex ? candidate.score.total : Number.NEGATIVE_INFINITY,
      };
      if (index > fromIndex) {
        const previousCandidates = candidateSets[index - 1].slice(0, 32);
        for (let previousIndex = 0; previousIndex < previousCandidates.length; previousIndex += 1) {
          const previousState = states[index - fromIndex - 1][previousIndex];
          if (!previousState) continue;
          const value =
            previousState.score +
            candidate.score.total +
            transitionScore(
              previousCandidates[previousIndex],
              candidate,
              observations[index - 1],
              observations[index],
            );
          if (
            value > best.score ||
            (value === best.score &&
              previousIndex < (best.previousIndex ?? Number.POSITIVE_INFINITY))
          )
            best = { score: value, previousIndex };
        }
      }
      currentStates.push(best);
    }
    states.push(currentStates);
  }
  return states;
}

function scoreRunCandidates(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
  fromIndex: number,
  toIndex: number,
  states: readonly (readonly PathState[])[],
) {
  // Forward + backward scores give every candidate the same complete-run
  // context, including competing continuations rather than the selected path.
  const suffixScores: number[][] = [];
  const scoredCandidates: ChordInferenceCandidate[][] = [];
  for (let offset = states.length - 1; offset >= 0; offset -= 1) {
    const index = fromIndex + offset;
    const candidates = candidateSets[index].slice(0, 32);
    suffixScores[offset] = candidates.map((candidate) => {
      if (index === toIndex - 1) return 0;
      return Math.max(...candidateSets[index + 1].slice(0, 32).map((next, nextIndex) =>
        transitionScore(candidate, next, observations[index], observations[index + 1]) +
        next.score.total + suffixScores[offset + 1][nextIndex],
      ));
    });
    scoredCandidates[offset] = candidates.map((candidate, candidateIndex) => ({
      ...candidate,
      pathScore: states[offset][candidateIndex].score + suffixScores[offset][candidateIndex],
    }));
  }
  return scoredCandidates;
}

function analyzeRun(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
  fromIndex: number,
  toIndex: number,
) {
  const states = forwardPathStates(observations, candidateSets, fromIndex, toIndex);
  const lastStates = states.at(-1) ?? [];
  const scoredCandidates = scoreRunCandidates(observations, candidateSets, fromIndex, toIndex, states);
  let currentIndex = lastStates.reduce(
    (bestIndex, state, index) =>
      state.score > lastStates[bestIndex].score ? index : bestIndex,
    0,
  );
  const selected: ChordInferenceCandidate[] = [];
  for (let stateIndex = states.length - 1; stateIndex >= 0; stateIndex -= 1) {
    selected[stateIndex] = scoredCandidates[stateIndex][currentIndex];
    currentIndex = states[stateIndex][currentIndex].previousIndex ?? 0;
  }
  return { selected, scoredCandidates };
}

/** Scores all retained candidates and selects a deterministic path per run. */
export function analyzeChordInferencePaths(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
) {
  const selected: Array<ChordInferenceCandidate | undefined> = Array.from(
    { length: observations.length },
    () => undefined,
  );
  const scoredCandidateSets: Array<readonly ChordInferenceCandidate[]> = Array.from(
    { length: observations.length },
    () => Object.freeze([]),
  );
  let index = 0;
  while (index < observations.length) {
    while (index < observations.length && candidateSets[index].length === 0)
      index += 1;
    const fromIndex = index;
    while (index < observations.length && candidateSets[index].length > 0)
      index += 1;
    if (index <= fromIndex) continue;
    const run = analyzeRun(observations, candidateSets, fromIndex, index);
    run.selected.forEach((candidate, offset) => {
      selected[fromIndex + offset] = candidate;
      scoredCandidateSets[fromIndex + offset] = Object.freeze(run.scoredCandidates[offset]);
    });
  }
  return {
    selectedPath: Object.freeze(selected),
    candidateSets: Object.freeze(scoredCandidateSets),
  };
}

export function selectChordInferencePath(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
) {
  return analyzeChordInferencePaths(observations, candidateSets).selectedPath;
}
