import {
  chordIdentityToneSpellings,
  chordIdentityToneSpellingForDegree,
  chordIdentityEquals,
  chordToneSpellings,
  primaryHarmonyInterpretation,
  type ChordIdentity,
  type ChordQuality,
} from "../../chordModel";
import { keyEquals, pitchClassEquals, pitchClassValue, scaleDegreePitchClass, writtenInterval } from "../../pitch";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { canOmitDominantFifth, dominantNinthTone } from "../facts/dominantMotion";
import type { StructuralVoicing } from "../facts/writtenVoicing";
import {
  buildFunctionalTemplates,
  dominantNinthTemplates,
  functionalTemplateKey,
  functionalTier,
  identityForFunctionalTemplate,
  smallNinthAlteration,
  fitChordObservation,
  exactFit,
  fitRatio,
  isCanonicalTonicFifthOmission,
  type ChordFitOptions,
} from "./scoring";
import { soundingBass, buildChordInferenceObservations, observationNotes, observationWithStructuralNotes } from "./observations";
import type {
  ChordInferenceCandidate,
  ChordInferenceEvidence,
  ChordInferenceObservation,
  ChordInferenceOptions,
  ChordInferenceScore,
  FunctionalChordTemplate,
} from "./types";
import type { NonChordToneRole, ProjectDocument } from "../../project";
import { inferPhrases, isCurrentPhraseBoundary } from "../phrase";
import type * as DiatonicAndPivots from "./diatonicAndPivots";
import type * as DominantFamily from "./dominantFamily";
import type * as Ornaments from "./ornaments";
import type * as Respellings from "./respellings";
import type * as SixFours from "./sixFours";
import type * as LocalKeys from "./localKeys";
import type { InferencePassContext } from "./passContext";
import { continuesInKey } from "./passContext";
import { crossesWrittenBoundary } from "../facts/ornamentalMotion";
import { canonicalJson } from "../../canonicalJson";

const FALLBACK_QUALITIES: readonly ChordQuality[] = [
  "major",
  "minor",
  "diminished",
  "augmented",
  "dominant7",
  "minor7",
];

function confidenceFor(
  score: ChordInferenceScore,
  fit: ReturnType<typeof fitChordObservation>,
) {
  // A fallback is useful as an explicit escape hatch, but it is never a
  // functional conclusion and therefore must not reach the default apply
  // path (which accepts medium confidence and above).
  if (score.functionalTier === 4) return "low" as const;
  if (
    score.functionalTier <= 2 &&
    fit.omittedChordDegrees.length === 0 &&
    fit.nonChordToneNoteIds.length === 0 &&
    fit.bassMatchesInversion &&
    fit.spellingConsistent
  )
    return "high" as const;
  if (fit.hardRejected) return "low" as const;
  if (fit.omittedChordDegrees.length <= 1 && fit.nonChordToneNoteIds.length <= 1)
    return "medium" as const;
  return "low" as const;
}

function scoreFor(
  observation: ChordInferenceObservation,
  identity: ChordIdentity,
  fit: ReturnType<typeof fitChordObservation>,
  functionalTierValue: ChordInferenceScore["functionalTier"],
  toneFit = fitRatio(observation, identity, fit),
): ChordInferenceScore {
  const bassFit = fit.bassMatchesInversion ? 1 : 0;
  const spellingFit =
    fit.chordToneNoteIds.length === 0
      ? 0
      : fit.spellingConsistent
        ? 1
        : 0.5;
  const metricFit = observation.metric
    ? observation.metric.role === "downbeat"
      ? 1
      : observation.metric.role === "secondary-accent"
        ? 0.8
        : 0.5
    : 0.5;
  const nonChordTonePenalty = fit.nonChordToneNoteIds.length * 0.3;
  const complexityPenalty =
    fit.omittedChordDegrees.length * 0.2 +
    (identity.structure.kind === "tertian" &&
    identity.structure.extensions.length > 0
      ? 0.05
      : 0);
  const total =
    toneFit * 50 +
    bassFit * 25 +
    spellingFit * 15 +
    metricFit * 5 -
    nonChordTonePenalty * 10 -
    complexityPenalty * 10;
  return {
    functionalTier: functionalTierValue,
    toneFit,
    bassFit,
    spellingFit,
    metricFit,
    contextFit: 0,
    nonChordTonePenalty,
    complexityPenalty,
    total,
  };
}

function evidenceFor(
  fit: ReturnType<typeof fitChordObservation>,
  functional = false,
): readonly ChordInferenceEvidence[] {
  const evidence: ChordInferenceEvidence[] = [];
  if (functional)
    evidence.push({ kind: "functional-template", code: "functional-template" });
  if (fit.chordToneNoteIds.length > 0)
    evidence.push({
      kind: "tone-match",
      code: "chord-tone-match",
      noteIds: fit.chordToneNoteIds,
    });
  if (fit.bassMatchesInversion)
    evidence.push({ kind: "bass-match", code: "inversion-bass-match" });
  if (fit.spellingConsistent)
    evidence.push({ kind: "spelling-match", code: "written-spelling-match" });
  if (fit.omittedChordDegrees.length > 0)
    evidence.push({
      kind: "omitted-tone",
      code: "omitted-chord-tone",
      details: { count: fit.omittedChordDegrees.length },
    });
  if (fit.nonChordToneNoteIds.length > 0) {
    evidence.push({
      kind: "extra-tone",
      code: "extra-pitch-class",
      noteIds: fit.nonChordToneNoteIds,
    });
    for (const noteId of fit.nonChordToneNoteIds) {
      if (fit.nonChordToneAssignments[noteId])
        evidence.push({
          kind: "declared-nonchord-tone",
          code: fit.nonChordToneAssignments[noteId],
          noteIds: [noteId],
        });
    }
  }
  if (fit.hardRejected)
    evidence.push({ kind: "hard-rejection", code: fit.hardRejected });
  return Object.freeze(evidence);
}

export function candidateComparator(
  left: ChordInferenceCandidate,
  right: ChordInferenceCandidate,
) {
  return (
    left.score.functionalTier - right.score.functionalTier ||
    right.score.total - left.score.total ||
    left.id.localeCompare(right.id)
  );
}

function isRootPositionNinthFit(
  observation: ChordInferenceObservation, identity: ChordIdentity, fit: ReturnType<typeof fitChordObservation>,
) {
  if (observation.soundingPitchClasses.length !== 4 || fit.omittedChordDegrees.length ||
      fit.nonChordToneNoteIds.length) return false;
  const bass = soundingBass(observation);
  const ninth = dominantNinthTone(identity);
  if (!bass || !ninth || !pitchClassEquals(bass, identity.root)) return false;
  return Object.values(observation.activeNotes).some(note => {
    if (pitchClassValue(note.pitch) !== pitchClassValue(ninth)) return false;
    const interval = writtenInterval(bass, note.pitch);
    return interval.semitones > 12 &&
      (!pitchClassEquals(note.pitch, ninth) || interval.diatonicSteps >= 8);
  });
}

export function createFunctionalCandidate(
  observation: ChordInferenceObservation,
  template: ReturnType<typeof buildFunctionalTemplates>[number],
  options: ChordInferenceOptions & Pick<ChordFitOptions, "allowedOmittedChordDegrees">,
): ChordInferenceCandidate | undefined {
  const { identity, semantics } = identityForFunctionalTemplate(
    template,
    observation.key,
    observation.localKey,
  );
  const canonicalTonicOmission =
    (template.baseId === "T" || template.baseId === "t") &&
    isCanonicalTonicFifthOmission(observation, identity);
  const fit = fitChordObservation(
    observation,
    identity,
    template.baseId === "T" || template.baseId === "t"
      ? {
          ...options,
          allowedOmittedChordDegrees:
            options.allowCadentialTonicOmission || canonicalTonicOmission
            ? [5]
            : options.allowedOmittedChordDegrees,
        }
      : options,
  );
  if (fit.hardRejected) return undefined;
  if (template.form === "ninth" && !isRootPositionNinthFit(observation, identity, fit)) return undefined;
  // The raised leading tone anchors this minor-key reading. An enharmonic
  // pivot with a respelled root cannot establish the same local DVII.
  if (template.baseId === "DVII" && observation.key.mode === "minor" &&
      template.form === "seventh" && !Object.values(observation.activeNotes).some(
        (note) => note?.pitch.step === identity.root.step && note.pitch.alter === identity.root.alter,
      ))
    return undefined;
  const score = scoreFor(observation, identity, fit, template.appliedTarget ? 1 : functionalTier(template.baseId));
  // The existing, literal large-ninth path stays eligible at high confidence.
  // A newly inferred small ninth stays reviewable until the score supports it.
  const needsNinthEvidence = template.form === "ninth" &&
    (!fit.spellingConsistent || template.alterations?.some(alteration => alteration.degree === 9));
  const confidence = needsNinthEvidence ? "low" : confidenceFor(score, fit);
  return {
    id: `${observation.index}:${functionalTemplateKey(template, observation.key)}`,
    observationIndex: observation.index,
    identity,
    semantics,
    functionalBaseId: template.baseId,
    fit,
    score,
    confidence,
    evidence: observation.localKey
      ? [...evidenceFor(fit, true), { kind: "sequence-context", code: "local-key-cadence" }]
      : evidenceFor(fit, true),
  } satisfies ChordInferenceCandidate;
}

export function createAbsoluteCandidate(
  observation: ChordInferenceObservation,
  root: (typeof observation.soundingPitchClasses)[number],
  quality: ChordQuality,
  options: ChordInferenceOptions,
  ninthAlteration?: 0 | -1,
) {
  const tones = chordToneSpellings(root, quality);
  const bass = observation.bass &&
    tones.some((tone) =>
      tone.step === observation.bass?.pitch.step &&
      tone.alter === observation.bass?.pitch.alter,
    )
    ? { step: observation.bass.pitch.step, alter: observation.bass.pitch.alter }
    : root;
  const identity: ChordIdentity = {
    root,
    bass,
    structure: {
      kind: "tertian",
      quality,
      extensions: ninthAlteration === undefined ? [] : [9],
      alterations: ninthAlteration === -1 ? [smallNinthAlteration] : [],
    },
  };
  const fit = fitChordObservation(observation, identity, options);
  if (fit.hardRejected) return undefined;
  if (ninthAlteration !== undefined && (!fit.spellingConsistent ||
      !isRootPositionNinthFit(observation, identity, fit))) return undefined;
  const score = scoreFor(observation, identity, fit, 4);
  return {
    id: `${observation.index}:absolute:${root.step}:${root.alter}:${quality}${ninthAlteration === undefined ? "" : `:9:${ninthAlteration}`}`,
    observationIndex: observation.index,
    identity,
    fit,
    score,
    confidence: confidenceFor(score, fit),
    evidence: evidenceFor(fit),
  } satisfies ChordInferenceCandidate;
}

export function buildChordInferenceCandidates(
  observation: ChordInferenceObservation,
  options: ChordInferenceOptions = {},
) {
  const functionalCandidates: ChordInferenceCandidate[] = buildFunctionalTemplates(observation.key)
    .flatMap(template => template.form === "ninth" ? dominantNinthTemplates : [template])
    .map((template) => createFunctionalCandidate(observation, template, options))
    .filter((candidate): candidate is ChordInferenceCandidate => !!candidate);

  // This exact four-part texture is a canonical tonic reading. Keep it
  // deterministic even when incomplete-voicing or absolute fallback options
  // would otherwise introduce equally-scored alternatives.
  const canonicalTonicCandidates = functionalCandidates.filter(
    (candidate) =>
      (candidate.functionalBaseId === "T" || candidate.functionalBaseId === "t") &&
      isCanonicalTonicFifthOmission(observation, candidate.identity),
  );
  if (canonicalTonicCandidates.length > 0)
    return Object.freeze(canonicalTonicCandidates.sort(candidateComparator));

  const candidates: ChordInferenceCandidate[] = [...functionalCandidates];

  if (options.allowAbsoluteFallback) {
    for (const root of observation.soundingPitchClasses) {
      for (const quality of FALLBACK_QUALITIES) {
        const candidate = createAbsoluteCandidate(observation, root, quality, options);
        if (candidate) candidates.push(candidate);
      }
    }
    const bass = observation.bass?.pitch;
    if (bass) {
      const root = { step: bass.step, alter: bass.alter };
      for (const ninth of [0, -1] as const) {
        const candidate = createAbsoluteCandidate(observation, root, "dominant7", options, ninth);
        if (candidate && !functionalCandidates.some(item => chordIdentityEquals(item.identity, candidate.identity))) {
          candidates.push(candidate);
        }
      }
    }
  }

  return Object.freeze(candidates.sort(candidateComparator));
}


const ORNAMENT_FIT_REJECTIONS = [
  "bass-mismatch",
  "unexplained-extra-tone",
  "omitted-chord-tone",
  "too-many-omitted-chord-tones",
];

export function fitContextualOrnament(
  anchor: ChordInferenceCandidate,
  observation: ChordInferenceObservation,
  assignments: Readonly<Record<string, NonChordToneRole>>,
  evidenceCode: string,
  structuralBass?: StructuralVoicing["bass"],
): ChordInferenceCandidate | undefined {
  const noteIds = Object.keys(assignments);
  if (!noteIds.length) return;
  const { hardRejected, ...surface } = fitChordObservation(observation, anchor.identity, {
    allowIncompleteVoicing: true,
    allowNonChordToneCandidates: true,
  });
  // A melodic bass can pass through another chord member. Its spelling is
  // consonant, but only the proven endpoint supplies this inversion's bass.
  const bass = observation.bass;
  const displacedMember = bass && structuralBass?.ornament && structuralBass.sounding.id === bass.id &&
    !surface.bassMatchesInversion && surface.chordToneNoteIds.includes(bass.id) &&
    pitchClassEquals(structuralBass.structural.pitch, anchor.identity.bass);
  const written = displacedMember ? { ...surface,
    chordToneNoteIds: surface.chordToneNoteIds.filter(id => id !== bass.id),
    nonChordToneNoteIds: [...surface.nonChordToneNoteIds, bass.id],
  } : surface;
  if (hardRejected && !ORNAMENT_FIT_REJECTIONS.includes(hardRejected)) return;
  if (!written.spellingConsistent ||
      written.nonChordToneNoteIds.length !== noteIds.length ||
      !written.nonChordToneNoteIds.every(id => Object.hasOwn(assignments, id)) ||
      (!written.bassMatchesInversion &&
        (!observation.bass || !Object.hasOwn(assignments, observation.bass.id)))) return;
  if (observationNotes(observation).some(({ note }) =>
    Object.hasOwn(assignments, note.id) && note.nonChordToneRole &&
    note.nonChordToneRole !== assignments[note.id])) return;

  const byRole = new Map<NonChordToneRole, string[]>();
  for (const [id, role] of Object.entries(assignments)) {
    const ids = byRole.get(role) ?? [];
    ids.push(id);
    byRole.set(role, ids);
  }
  const fit = { ...written, nonChordToneAssignments: Object.freeze({ ...assignments }) };
  return {
    id: `${observation.index}:${evidenceCode}:${anchor.id}`,
    observationIndex: observation.index,
    identity: anchor.identity,
    semantics: anchor.semantics,
    functionalBaseId: anchor.functionalBaseId,
    fit,
    score: scoreFor(observation, anchor.identity, fit, anchor.score.functionalTier),
    confidence: "medium",
    evidence: [
      ...evidenceFor(written, true),
      { kind: "sequence-context", code: evidenceCode, noteIds },
      ...Array.from(byRole, ([role, ids]) => ({
        kind: "inferred-nonchord-tone" as const, code: role, noteIds: ids,
      })),
    ],
  };
}

function restoredObservation(observation: ChordInferenceObservation, voicing: StructuralVoicing): ChordInferenceObservation {
  return observationWithStructuralNotes(observation, Object.fromEntries(voicing.voices.map(item => [item.voice, item.structural])));
}

export function structuralOrnamentTemplates(observation: ChordInferenceObservation) {
  return buildFunctionalTemplates(observation.key)
    .filter(template => template.form !== "ninth" && template.baseId !== "K46")
    .flatMap(template => {
      const { identity } = identityForFunctionalTemplate(template, observation.key, observation.localKey);
      return identity.structure.kind === "tertian" ? [{ template, identity }] : [];
    });
}

export function anchorForStructuralOrnament(
  observation: ChordInferenceObservation, voicing: StructuralVoicing, template: FunctionalChordTemplate,
) {
  return createFunctionalCandidate(restoredObservation(observation, voicing), template, {
    allowedOmittedChordDegrees: isRestoredDominantFifthOmission(voicing, template.baseId, voicingIdentity(observation, template))
      ? [5] : undefined,
  });
}

function voicingIdentity(observation: ChordInferenceObservation, template: FunctionalChordTemplate) {
  return identityForFunctionalTemplate(template, observation.key, observation.localKey).identity;
}

function isRestoredDominantFifthOmission(
  voicing: StructuralVoicing, base: ChordInferenceCandidate["functionalBaseId"], identity: ChordIdentity,
) {
  return (base === "D" || base === "DD") && identity.structure.kind === "tertian" &&
    identity.structure.quality === "dominant7" && !identity.structure.extensions.length &&
    !identity.structure.alterations.length && voicing.missing.length === 1 &&
    pitchClassEquals(voicing.missing[0], chordIdentityToneSpellingForDegree(identity, 5)!) &&
    !!voicing.bass && canOmitDominantFifth(identity.root, voicing.bass.structural.pitch,
      voicing.voices.map(item => item.structural.pitch));
}

/** A verified projection is not a relaxed vertical filter. Every extra
 * pitch has a same-voice path, and all target members must be realized. */
export function fitStructuralOrnament(
  anchor: ChordInferenceCandidate, observation: ChordInferenceObservation, voicing: StructuralVoicing,
) {
  if (!voicing.bass || voicing.unresolved.length) return;
  const motions = voicing.voices.flatMap(item => item.ornament ? [item.ornament] : []);
  const restored = restoredObservation(observation, voicing);
  const tonicOmission = (anchor.functionalBaseId === "T" || anchor.functionalBaseId === "t") &&
    isCanonicalTonicFifthOmission(restored, anchor.identity);
  if (!motions.length || (voicing.missing.length && !tonicOmission &&
      !isRestoredDominantFifthOmission(voicing, anchor.functionalBaseId, anchor.identity))) return;
  const assignments = Object.fromEntries(voicing.voices.flatMap(item =>
    item.ornament ? [[item.sounding.id, item.ornament.role]] : []));
  const candidate = fitContextualOrnament(anchor, observation, assignments, "written-structural-voicing", voicing.bass);
  if (!candidate) return;
  const result = scoreVerifiedOrnament(candidate, restored, false);
  return {
    ...result,
    evidence: [...result.evidence, ...motions.map(motion => ({
      kind: "sequence-context" as const, code: `written-${motion.role}-path`,
      noteIds: [motion.departure.note.id, ...motion.ornaments.map(note => note.id), motion.arrival.note.id],
      details: {
        voice: motion.voice, entryTick: motion.entryTick, departureTick: motion.departure.tick,
        arrivalTick: motion.arrival.tick, crossedSlices: motion.crossedSliceTicks.length,
        ...(motion.arrival.confirmedAtTick !== undefined && { confirmedAtTick: motion.arrival.confirmedAtTick }),
      },
    }))],
  };
}

/** Measure the written chord-member coverage after restoring the tones
 * displaced by verified ornaments. Keep the surface fit and ornament cost. */
export function scoreVerifiedOrnament(
  candidate: ChordInferenceCandidate,
  restored: ChordInferenceObservation,
  corroborated: boolean,
): ChordInferenceCandidate {
  const toneFit = fitRatio(restored, candidate.identity, candidate.fit);
  // Credit corroboration from both sides of the ornament while retaining
  // the cost of every sounding non-chord tone.
  const bassFit = restored.bass && pitchClassEquals(restored.bass.pitch, candidate.identity.bass) ? 1 : 0;
  const contextFit = Math.max(0, toneFit - candidate.score.toneFit) * 50 +
    Math.max(0, bassFit - candidate.score.bassFit) * 25 + (corroborated ? 8 : 0);
  return {
    ...candidate,
    score: { ...candidate.score, contextFit, total: candidate.score.total + contextFit },
  };
}

export function fitSimultaneousNeighbors(
  anchor: ChordInferenceCandidate,
  observation: ChordInferenceObservation,
  noteIds: readonly string[],
): ChordInferenceCandidate | undefined {
  const { hardRejected, ...written } = fitChordObservation(observation, anchor.identity, {
    allowIncompleteVoicing: true, allowNonChordToneCandidates: true,
  });
  // The paired, written return has proved both displaced chord members.
  // Keep their omission in the fit without broadening ordinary voicing inference.
  if ((hardRejected && (hardRejected !== "too-many-omitted-chord-tones" ||
      noteIds.length !== 2 || written.omittedChordDegrees.length !== 2)) ||
      !written.spellingConsistent || written.nonChordToneNoteIds.length !== noteIds.length ||
      !noteIds.every(id => written.nonChordToneNoteIds.includes(id))) return;
  const fit = {
    ...written,
    nonChordToneAssignments: Object.freeze(Object.fromEntries(noteIds.map(id => [id, "neighbor" as const]))),
  };
  return {
    ...anchor,
    id: `${observation.index}:simultaneous-neighbors:${anchor.id}`,
    observationIndex: observation.index,
    fit,
    score: scoreFor(observation, anchor.identity, fit, anchor.score.functionalTier),
    confidence: "medium",
    evidence: [...evidenceFor(fit, true),
      { kind: "sequence-context", code: "written-double-neighbor", noteIds },
      { kind: "inferred-nonchord-tone", code: "neighbor", noteIds },
    ],
  };
}

export function fitFifthOmissionRevoicing(
  anchor: ChordInferenceCandidate,
  observation: ChordInferenceObservation,
  noteIds: readonly string[],
  family: "triad" | "seventh",
): ChordInferenceCandidate | undefined {
  return fitOmittedMember(anchor, observation, 5, `${family}-revoicing`, noteIds);
}

function fitOmittedMember(
  anchor: ChordInferenceCandidate, observation: ChordInferenceObservation, degree: 1 | 5,
  pattern: string, noteIds: readonly string[],
): ChordInferenceCandidate | undefined {
  const fit = fitChordObservation(observation, anchor.identity, { allowedOmittedChordDegrees: [degree] });
  if (fit.hardRejected || !fit.spellingConsistent || fit.nonChordToneNoteIds.length ||
      fit.omittedChordDegrees.length !== 1 || fit.omittedChordDegrees[0] !== degree) return undefined;
  return {
    ...anchor,
    id: `${observation.index}:${pattern}:${anchor.id}`,
    observationIndex: observation.index,
    fit,
    score: scoreFor(observation, anchor.identity, fit, anchor.score.functionalTier),
    confidence: "medium",
    evidence: [...evidenceFor(fit, true), {
      kind: "sequence-context", code: degree === 5 ? `single-voice-${pattern}` : pattern, noteIds,
    }],
  };
}

/** Three held members of an applied seventh can spell vii° until the
 * fourth voice enters on the root. No sounding part changed harmony. */
function withDelayedDominantRoots(
  { observations, currentPhraseTicks, minimumConfidence }: InferencePassContext,
  candidates: CandidateSets, withheld: ReadonlySet<number>,
) {
  if (minimumConfidence === "high") return candidates;
  return candidates.map((existing, i) => {
    const part = observations[i], arrival = observations[i + 1];
    const leading = existing[0];
    if (!leading?.semantics || existing.length !== 1 || !exactFit(leading) ||
        leading.identity.structure.kind !== "tertian" || leading.identity.structure.quality !== "diminished" ||
        !arrival?.completeSatb || part.completeSatb || !continuesInKey(part, arrival) ||
        part.key.tick !== arrival.key.tick || withheld.has(part.fromTick) || withheld.has(arrival.fromTick) ||
        part.toTick - part.fromTick >= (part.measureBeatTicks ?? 0) ||
        crossesWrittenBoundary(currentPhraseTicks, part.fromTick, arrival.fromTick)) return existing;
    const held = observationNotes(part);
    if (held.length !== 3 || held.some(({ voiceId, note }) =>
      note.nonChordToneRole || arrival.activeNotes[voiceId]?.id !== note.id)) return existing;
    const entering = observationNotes(arrival).find(({ voiceId }) => !part.activeNotes[voiceId]);
    const target = primaryHarmonyInterpretation(leading.semantics);
    if (!entering || entering.voiceId === "bass" || entering.note.nonChordToneRole || !target.appliedTarget) return existing;
    const readings = candidates[i + 1].filter(c => {
      if (!exactFit(c) || !c.semantics || c.identity.structure.kind !== "tertian" ||
          c.identity.structure.quality !== "dominant7" || !pitchClassEquals(c.identity.root, entering.note.pitch)) return false;
      const next = primaryHarmonyInterpretation(c.semantics);
      return target.degree === 7 && next.degree === 5 &&
        canonicalJson(next.appliedTarget) === canonicalJson(target.appliedTarget) &&
        keyEquals(next.localKey ?? arrival.key, target.localKey ?? part.key);
    });
    if (readings.length !== 1) return existing;
    const fit = fitOmittedMember(readings[0], part, 1, "delayed-dominant-root",
      [...held.map(({ note }) => note.id), entering.note.id]);
    return fit ? [fit] : existing;
  });
}

export function fitProlongedHarmony(
  anchor: ChordInferenceCandidate,
  observation: ChordInferenceObservation,
  movingId: string,
): ChordInferenceCandidate | undefined {
  const fit = fitChordObservation(observation, anchor.identity, {
    allowIncompleteVoicing: true, allowNonChordToneCandidates: true,
  });
  if (fit.hardRejected || !fit.spellingConsistent ||
      fit.nonChordToneNoteIds.length !== 1 || fit.nonChordToneNoteIds[0] !== movingId) return;
  return {
    ...anchor,
    id: `${observation.index}:prolonged:${anchor.id}`,
    observationIndex: observation.index,
    fit,
    score: scoreFor(observation, anchor.identity, fit, anchor.score.functionalTier),
    confidence: "medium",
    evidence: [...evidenceFor(fit, true), {
      kind: "sequence-context", code: "prolonged-harmony", noteIds: [movingId],
    }],
  };
}

export function fitAnticipation(
  anchor: ChordInferenceCandidate,
  observation: ChordInferenceObservation,
  anticipated: readonly string[],
): ChordInferenceCandidate | undefined {
  const { hardRejected, ...literal } = fitChordObservation(observation, anchor.identity);
  if (!literal.spellingConsistent || literal.nonChordToneNoteIds.length !== anticipated.length ||
      !anticipated.every(id => literal.nonChordToneNoteIds.includes(id))) return;
  if (hardRejected && !ORNAMENT_FIT_REJECTIONS.includes(hardRejected)) return;

  const fit = {
    ...literal,
    nonChordToneAssignments: Object.freeze(Object.fromEntries(
      anticipated.map(id => [id, "anticipation" as const]),
    )),
  };
  return {
    ...anchor,
    id: `${observation.index}:anticipation:${anchor.id}`,
    observationIndex: observation.index,
    fit,
    score: scoreFor(observation, anchor.identity, fit, anchor.score.functionalTier),
    confidence: "medium",
    evidence: [...evidenceFor(literal, true), { kind: "inferred-nonchord-tone", code: "anticipation", noteIds: anticipated }],
  };
}

export function fitPreparedSuspension(
  anchor: ChordInferenceCandidate,
  observation: ChordInferenceObservation,
  suspensions: readonly { noteId: string; figure: "4-3" | "9-8" }[],
): ChordInferenceCandidate | undefined {
  const hasFourth = suspensions.some(motion => motion.figure === "4-3");
  const fit = fitChordObservation(observation, anchor.identity, {
    allowNonChordToneCandidates: true,
    allowedOmittedChordDegrees: hasFourth ? [3] : [],
  });
  if (fit.hardRejected || !fit.spellingConsistent || fit.omittedChordDegrees.length !== (hasFourth ? 1 : 0) ||
      (hasFourth && fit.omittedChordDegrees[0] !== 3) || fit.nonChordToneNoteIds.length !== suspensions.length ||
      !suspensions.every(({ noteId }) => fit.nonChordToneNoteIds.includes(noteId))) return;
  return {
    ...anchor,
    id: `${observation.index}:prepared-suspension:${anchor.id}`,
    observationIndex: observation.index,
    fit,
    score: scoreFor(observation, anchor.identity, fit, anchor.score.functionalTier),
    confidence: "medium",
    // A held note also belongs to the preparation chord. Its suspension
    // evidence covers only the slice between the anchor attack and resolution.
    evidence: [...evidenceFor(fit, true), ...suspensions.map(({ noteId, figure }) => ({
      kind: "inferred-nonchord-tone" as const,
      code: "prepared-suspension",
      noteIds: [noteId],
      details: { figure, fromTick: observation.fromTick, toTick: observation.toTick },
    }))],
  };
}

export function fitDominantSixthSubstitution(
  observation: ChordInferenceObservation,
  reading: ChordInferenceCandidate,
  resolution: "fifth" | "tonic",
): ChordInferenceCandidate | undefined {
  const soprano = observation.activeNotes.soprano;
  const { identity } = reading;
  if (!soprano || !observation.bass || !pitchClassEquals(observation.bass.pitch, identity.root)) return;
  const literalFit = fitChordObservation(observation, identity, { allowNonChordToneCandidates: true });
  if (literalFit.hardRejected || !literalFit.spellingConsistent || literalFit.omittedChordDegrees.length ||
      literalFit.nonChordToneNoteIds.length !== 1 || literalFit.nonChordToneNoteIds[0] !== soprano.id) return;

  const fit = {
    ...literalFit,
    chordToneNoteIds: literalFit.matchedNoteIds,
    nonChordToneNoteIds: Object.freeze([]),
    nonChordToneAssignments: Object.freeze({}),
    extraPitchClasses: Object.freeze([]),
  };
  const score = scoreFor(observation, identity, fit, reading.score.functionalTier, 1);
  return {
    ...reading,
    id: `${observation.index}:dominant-sixth-substitution:${reading.id}`,
    observationIndex: observation.index,
    fit,
    score,
    confidence: confidenceFor(score, fit),
    evidence: [...evidenceFor(literalFit, true).filter(evidence => evidence.kind !== "extra-tone"),
      { kind: "sequence-context", code: "dominant-sixth-substitution",
        noteIds: [soprano.id], details: { resolution } },
    ],
  };
}

export function candidateDescription(candidate: ChordInferenceCandidate) {
  const noteCount = candidate.fit.matchedNoteIds.length;
  return candidate.functionalBaseId
    ? `${candidate.functionalBaseId} · ${noteCount} 个观察音`
    : `绝对结构 · ${noteCount} 个观察音`;
}

/** A revoicing on the same dominant bass can omit one upper member of K64. */
export function fitCadentialRevoicing(anchor: ChordInferenceCandidate, observation: ChordInferenceObservation) {
  const fit = fitChordObservation(observation, anchor.identity, { allowIncompleteVoicing: true });
  if (!observation.completeSatb || fit.hardRejected || !fit.spellingConsistent || fit.nonChordToneNoteIds.length ||
      fit.omittedChordDegrees.length !== 1) return;
  return {
    ...anchor, id: `${observation.index}:revoiced:${anchor.id}`, observationIndex: observation.index,
    fit, confidence: "medium" as const, score: scoreFor(observation, anchor.identity, fit, anchor.score.functionalTier),
    evidence: [...evidenceFor(fit, true), { kind: "sequence-context" as const, code: "cadential64-revoicing" }],
  };
}

export function createLoweredSupertonic(
  item: ChordInferenceObservation, quality: "major" | "major7", inversion: 0 | 1 | 2 | 3,
) {
  return createFunctionalCandidate(item, {
    baseId: "SII", localKeyPolicy: "current-key",
    definition: { ...functionalDefinition("SII"), degreeAlteration: -1, minorDegreeAlteration: -1,
      quality: () => quality },
    form: quality === "major7" ? "seventh" : "triad", expectedInversion: inversion,
  }, {});
}

/** Spasobin §47.5–6 distinguishes root-position flat II and its major seventh
 * from the familiar first-inversion triad. Their characteristic continuation
 * supplies the predominant reading, including a seventh added to the triad. */
export function withLoweredSupertonics(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
) {
  const result = sets.slice();
  let leadsToDominant = false;
  for (let i = observations.length - 1; i >= 0; i--) {
    const item = observations[i], next = observations[i + 1];
    const continuation: boolean = leadsToDominant && !!next && keyEquals(item.key, next.key);
    const direct = sets[i].filter(c => c.semantics && !primaryHarmonyInterpretation(c.semantics).appliedTarget &&
      c.fit.spellingConsistent && !c.fit.nonChordToneNoteIds.length);
    leadsToDominant = direct.some(c => c.functionalBaseId === "D" || c.functionalBaseId === "DVII") ||
      !!continuation && direct.some(c => c.functionalBaseId === "K46");
    if (!continuation || !item.completeSatb || !item.bass) continue;
    const root = scaleDegreePitchClass(item.key, 2, -1);
    const quality = item.soundingPitchClasses.length === 4 ? "major7" : "major";
    const tones = chordToneSpellings(root, quality);
    if (tones.length !== item.soundingPitchClasses.length ||
        !tones.every(tone => item.soundingPitchClasses.some(p => pitchClassEquals(p, tone)))) continue;
    const inversion = tones.findIndex(tone => pitchClassEquals(tone, item.bass!.pitch));
    if (inversion < 0 || inversion > 3) continue;
    if (quality === "major" && inversion !== 0) {
      if (inversion === 1) leadsToDominant = true;
      continue;
    }
    const lowered = createLoweredSupertonic(item, quality, inversion as 0 | 1 | 2 | 3);
    if (!lowered?.fit.spellingConsistent) continue;
    leadsToDominant = true;
    result[i] = [...sets[i], { ...lowered, id: lowered.id + ":lowered",
      evidence: [...lowered.evidence, { kind: "sequence-context" as const, code: "lowered-supertonic-resolution" }],
    }].sort(candidateComparator);
  }
  return result;
}

export function candidateHasNonChordToneAssignments(
  candidate: ChordInferenceCandidate,
) {
  return Object.keys(candidate.fit.nonChordToneAssignments).length > 0;
}

type ContextualCandidatePasses = {
  diatonicAndPivots: typeof DiatonicAndPivots;
  dominantFamily: typeof DominantFamily;
  ornaments: typeof Ornaments;
  respellings: typeof Respellings;
  sixFours: typeof SixFours;
  inferLocalKeys: typeof LocalKeys.inferLocalKeys;
};

type CandidateSets = readonly (readonly ChordInferenceCandidate[])[];

function confidenceRank(value: "high" | "medium" | "low") {
  return value === "high" ? 2 : value === "medium" ? 1 : 0;
}

function initialCandidates({
  observations, options, terminalTicks, meetsMinimumConfidence,
}: InferencePassContext) {
  const candidateSets: ChordInferenceCandidate[][] = [];
  observations.forEach((observation, index) => {
    const previousCandidates = candidateSets[index - 1] ?? [];
    const followsDominant = previousCandidates.some(
      (candidate) =>
        candidate.functionalBaseId === "D" &&
        candidate.fit.omittedChordDegrees.length === 0 &&
        candidate.fit.nonChordToneNoteIds.length === 0,
    );
    const candidates = buildChordInferenceCandidates(observation, {
      ...options,
      allowCadentialTonicOmission:
        terminalTicks.has(observation.toTick) && followsDominant,
    }).filter(meetsMinimumConfidence);
    candidateSets.push(candidates);
  });
  return candidateSets;
}

function prepareInferenceContext(
  project: ProjectDocument,
  options: ChordInferenceOptions,
  inferLocalKeys: ContextualCandidatePasses["inferLocalKeys"],
) {
  const fullScore = buildChordInferenceObservations(project);
  const minimumConfidence = options.minConfidence ?? "low";
  const meetsMinimumConfidence = (candidate: ChordInferenceCandidate) =>
    confidenceRank(candidate.confidence) >= confidenceRank(minimumConfidence);
  // Phrase boundaries are normally written after chord inference. Precompute
  // the note/rhythm-only structure here so an inferred middle-phrase cadence
  // can still unlock the terminal tonic's permitted fifth omission.
  const phraseAnalysis = inferPhrases({
    ...project,
    // Existing chord annotations must not bias a fresh chord inference run.
    chordRegions: [],
  });
  const terminalTicks = new Set(
    phraseAnalysis.boundaries.map((boundary) => boundary.tick),
  );
  const manualPhraseTicks = project.structure.phraseBoundaries
    .filter(boundary => boundary.source === "manual")
    .map(boundary => boundary.tick);
  const localKeys = inferLocalKeys(fullScore, terminalTicks, manualPhraseTicks, project.ppq);
  const observations = fullScore.map(item => {
    const localKey = localKeys.get(item.index)?.key;
    return localKey ? { ...item, key: { ...item.key, ...localKey }, localKey } : item;
  });
  const phraseBoundaryTicks = project.structure.phraseBoundaries
    .filter(boundary => isCurrentPhraseBoundary(project, boundary))
    .map(boundary => boundary.tick);
  const currentPhraseTicks = [...new Set([...terminalTicks, ...phraseBoundaryTicks])];
  return {
    observations, options, ppq: project.ppq, localKeys, terminalTicks, phraseBoundaryTicks,
    currentPhraseTicks, manualPhraseTicks, minimumConfidence, meetsMinimumConfidence,
  } satisfies InferencePassContext;
}

function expandCoreCandidates(
  { observations, options, currentPhraseTicks, manualPhraseTicks }: InferencePassContext,
  candidates: CandidateSets,
  { diatonicAndPivots, dominantFamily }: ContextualCandidatePasses,
) {
  const { withWrittenPivotSevenths, withDiatonicSevenths } = diatonicAndPivots;
  const { withAppliedSequences, withAppliedDominants, withReattackedTonicNinths } = dominantFamily;
  // Establish candidate harmonies before resolving ornamental notes against them.
  candidates = withWrittenPivotSevenths(observations, candidates, options);
  candidates = withDiatonicSevenths(observations, candidates, options, manualPhraseTicks);
  candidates = withLoweredSupertonics(observations, candidates);
  candidates = withAppliedSequences(observations, candidates, options, manualPhraseTicks);
  candidates = withAppliedDominants(observations, candidates, options, manualPhraseTicks);
  candidates = diatonicAndPivots.withAppliedLeadingSeventhPreparations(observations, candidates, options, manualPhraseTicks);
  return withReattackedTonicNinths(observations, candidates, options, currentPhraseTicks);
}

function classifyEarlyOrnamentsAndSixFours(
  { observations, options, ppq, phraseBoundaryTicks, currentPhraseTicks, minimumConfidence, localKeys }: InferencePassContext,
  candidates: CandidateSets,
  { ornaments, sixFours }: ContextualCandidatePasses,
) {
  const { withAnticipations, withPreparedSuspensions, withProlongedHarmony, simultaneousNeighborCandidates } = ornaments;
  const { classifySixFours } = sixFours;
  candidates = withAnticipations(observations, candidates, options, ppq, phraseBoundaryTicks);
  candidates = withPreparedSuspensions(observations, candidates, options, ppq, phraseBoundaryTicks);
  candidates = withProlongedHarmony(observations, candidates, options, ppq, phraseBoundaryTicks);
  const doubleNeighbors = simultaneousNeighborCandidates(observations, candidates, options, ppq, phraseBoundaryTicks);
  const classified = classifySixFours(
    observations, candidates, minimumConfidence !== "high", currentPhraseTicks, doubleNeighbors,
    minimumConfidence !== "high" && options.allowNonChordToneCandidates !== false ? ppq : undefined,
  );
  if (minimumConfidence === "high" || options.allowNonChordToneCandidates === false) return classified;
  return classified.map((existing, i) => {
    const leadIn = localKeys.get(i)?.cadentialLeadIn;
    if (!leadIn || leadIn.onsetIndex !== i) return existing;
    const anchor = classified[leadIn.settledIndex].find(candidate => candidate.functionalBaseId === "K46");
    const fitted = anchor && fitContextualOrnament(anchor, observations[i],
      { [leadIn.noteId]: "suspension" }, "written-local-cadential-preparation");
    return fitted ? [scoreVerifiedOrnament(fitted, observations[leadIn.settledIndex], true)] : existing;
  });
}

function expandDominantFamilyAndPivots(
  {
    observations, options, ppq, localKeys, phraseBoundaryTicks, currentPhraseTicks,
    manualPhraseTicks, minimumConfidence, meetsMinimumConfidence,
  }: InferencePassContext,
  candidates: CandidateSets,
  { dominantFamily, diatonicAndPivots, sixFours, respellings }: ContextualCandidatePasses,
) {
  const { withDeceptiveDominants, withDominantSixthSubstitutions, withDoubleAugmentedFourThree } = dominantFamily;
  const {
    withPassingTonicSevenths, withNeapolitanPivotDominants,
    withThirdInversionResolutions, withLeadingSeventhIntoConfirmedKey,
  } = diatonicAndPivots;
  const { withSingleVoiceRevoicings } = sixFours;
  const { withWholeWrittenTriadRespellings } = respellings;
  candidates = withDeceptiveDominants(observations, candidates, options, ppq, phraseBoundaryTicks);
  candidates = withDominantSixthSubstitutions(observations, candidates, meetsMinimumConfidence, manualPhraseTicks);
  candidates = withPassingTonicSevenths(observations, candidates, options, currentPhraseTicks);
  candidates = withNeapolitanPivotDominants(
    observations, candidates, options, localKeys, currentPhraseTicks,
  );
  candidates = withDoubleAugmentedFourThree(
    observations, candidates, manualPhraseTicks, meetsMinimumConfidence,
  );
  if (minimumConfidence !== "high") {
    candidates = withSingleVoiceRevoicings(observations, candidates, ppq, phraseBoundaryTicks, currentPhraseTicks);
  }
  candidates = withThirdInversionResolutions(observations, candidates, options, currentPhraseTicks);
  candidates = withLeadingSeventhIntoConfirmedKey(
    observations, candidates, options, localKeys, currentPhraseTicks,
  );
  return withWholeWrittenTriadRespellings(observations, candidates, currentPhraseTicks);
}

function recoverLateOrnamentsAndRespellings(
  { observations, options, ppq, localKeys, currentPhraseTicks, manualPhraseTicks, meetsMinimumConfidence }: InferencePassContext,
  candidates: CandidateSets,
  { ornaments, diatonicAndPivots, respellings }: ContextualCandidatePasses,
) {
  const { withWrittenLowerNeighborPairs, withUpperPassingTones } = ornaments;
  const { withNeapolitanPivotSixths } = diatonicAndPivots;
  const { withRaisedFifthResolutions, withSpelledSeventhsOverItalian, withContextualWrittenRespellings } = respellings;
  const lowerNeighbors = withWrittenLowerNeighborPairs(observations, candidates, options, currentPhraseTicks);
  candidates = withUpperPassingTones(
    observations, lowerNeighbors.candidateSets, options, currentPhraseTicks, ppq,
  );
  candidates = withNeapolitanPivotSixths(observations, candidates, localKeys, currentPhraseTicks);
  candidates = withRaisedFifthResolutions(observations, candidates, manualPhraseTicks, meetsMinimumConfidence);
  candidates = withSpelledSeventhsOverItalian(observations, candidates, currentPhraseTicks, ppq, options);
  candidates = withContextualWrittenRespellings(observations, candidates, options, currentPhraseTicks, manualPhraseTicks);
  return { candidates, withheldStarts: lowerNeighbors.withheldStarts };
}

function recoverNinthsAndContextualOrnaments(
  { observations, options, ppq, currentPhraseTicks, manualPhraseTicks }: InferencePassContext,
  candidates: CandidateSets,
  withheldStarts: ReturnType<typeof Ornaments.withWrittenLowerNeighborPairs>["withheldStarts"],
  { dominantFamily, ornaments }: ContextualCandidatePasses,
) {
  const { withDominantNinths } = dominantFamily;
  const { withContextualOrnaments } = ornaments;
  const ninths = withDominantNinths(observations, candidates, manualPhraseTicks, options);
  candidates = withContextualOrnaments(
    observations, ninths.candidates, options, ppq, currentPhraseTicks, withheldStarts,
  );
  return { candidates, ninthAlternatives: ninths.alternate };
}

/** Each pass reads its predecessor's candidates. Score the path only after
 * both the harmonic and the voice-leading evidence are available. */
export function buildContextualChordCandidates(
  project: ProjectDocument,
  options: ChordInferenceOptions,
  passes: ContextualCandidatePasses,
) {
  const context = prepareInferenceContext(project, options, passes.inferLocalKeys);
  const initial = initialCandidates(context);
  const core = expandCoreCandidates(context, initial, passes);
  const classified = classifyEarlyOrnamentsAndSixFours(context, core, passes);
  const dominantsAndPivots = expandDominantFamilyAndPivots(context, classified, passes);
  const late = recoverLateOrnamentsAndRespellings(context, dominantsAndPivots, passes);
  const { candidates, ninthAlternatives } = recoverNinthsAndContextualOrnaments(
    context,
    late.candidates,
    late.withheldStarts,
    passes,
  );

  const continued = withDelayedDominantRoots(context, candidates, late.withheldStarts);
  return {
    observations: context.observations,
    candidates: passes.sixFours.resolveFiguredPedals(context.observations, continued, context.currentPhraseTicks,
      context.minimumConfidence !== "high" && options.allowNonChordToneCandidates !== false, late.withheldStarts),
    currentPhraseTicks: context.currentPhraseTicks,
    withheldStarts: late.withheldStarts,
    ninthAlternatives,
  };
}
