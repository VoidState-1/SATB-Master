import type { ProjectDocument, ChordRegion, CadenceAnnotation } from "../../project";
import { buildContextualChordCandidates } from "./candidates";
import { addDominantNinthAlternatives } from "./dominantFamily";
import { chooseNoncadentialTonicSixFours } from "./sixFours";
import { buildChordInferenceRegions, warningsForRegions } from "./segmentation";
import { analyzeChordInferencePaths } from "./scoring";
import type {
  ChordInferenceObservation,
  ChordInferenceOptions,
  ChordInferenceResult,
  ChordInferenceApplyOptions,
  ChordInferenceApplyResult,
  ChordInferenceCandidate,
  ChordInferenceRegion,
  ChordInferenceWarning,
  HarmonyInferenceApplyOptions,
  HarmonyInferenceApplyResult,
  HarmonyInferenceResult,
} from "./types";
import { createId } from "../../project/defaults";
import { cloneProject } from "../../project/selectors";
import { addChordRegion } from "../../editing";
import { isWrittenStep, pitchClassEquals, writtenInterval } from "../../pitch";
import { reconcileCadenceAnnotationStaleness } from "../../project/normalize";
import { VOICE_ORDER } from "../../project/voice";
import { buildMeasures, measureAtTick, ticksPerBeat } from "../../time";
import { detectCadences, type CadenceCandidate } from "../cadence";
import { cadenceInputs } from "../cadence/projectEvidence";
import { inferPhrases, type PhraseAnalysis } from "../phrase";
import { soundsCompleteWrittenChord } from "../facts/writtenVoicing";
import * as diatonicAndPivots from "./diatonicAndPivots";
import * as dominantFamily from "./dominantFamily";
import * as ornaments from "./ornaments";
import * as respellings from "./respellings";
import * as sixFours from "./sixFours";
import { inferLocalKeys } from "./localKeys";

const contextualCandidatePasses = {
  diatonicAndPivots,
  dominantFamily,
  ornaments,
  respellings,
  sixFours,
  inferLocalKeys,
};

function normalizedRange(
  lengthTicks: number,
  options: ChordInferenceOptions,
) {
  const fromTick = Math.max(
    0,
    Math.min(lengthTicks, Math.floor(options.fromTick ?? 0)),
  );
  const toTick = Math.max(
    fromTick,
    Math.min(lengthTicks, Math.floor(options.toTick ?? lengthTicks)),
  );
  return { fromTick, toTick };
}

export function inferChords(
  project: ProjectDocument,
  options: ChordInferenceOptions = {},
): ChordInferenceResult {
  const range = normalizedRange(project.lengthTicks, options);
  if (!(range.toTick > range.fromTick)) {
    return {
      sourceRevision: 0,
      range,
      regions: [],
      unresolvedObservationIndices: [],
      warnings: [
        {
          code: "invalid-range",
          fromTick: range.fromTick,
          toTick: range.toTick,
          message: "推导范围必须包含至少一个有效的时间区间",
        },
      ],
    };
  }
  const { observations, candidates, currentPhraseTicks, withheldStarts, ninthAlternatives } =
    buildContextualChordCandidates(project, options, contextualCandidatePasses);
  const sequence = analyzeChordInferencePaths(observations, candidates);
  // Solve in musical context, but aggregate evidence and write regions only
  // for the requested half-open range. A selection can split a held note.
  let visible: readonly ChordInferenceObservation[] = observations;
  let scored = sequence.candidateSets;
  let selectedPath = chooseNoncadentialTonicSixFours(observations, scored, sequence.selectedPath, currentPhraseTicks);
  if (range.fromTick !== 0 || range.toTick !== project.lengthTicks) {
    const first = observations.findIndex(item => item.toTick > range.fromTick);
    let end = first;
    while (end < observations.length && observations[end].fromTick < range.toTick) end++;
    visible = observations.slice(first, end).map((item, index) => ({
      ...item, index, fromTick: Math.max(item.fromTick, range.fromTick),
      toTick: Math.min(item.toTick, range.toTick),
    }));
    scored = scored.slice(first, end).map((set, index) =>
      set.map(candidate => ({ ...candidate, observationIndex: index })));
    selectedPath = selectedPath.slice(first, end).map((selected, index) =>
      selected && { ...selected, observationIndex: index });
  }
  const regions = addDominantNinthAlternatives(
    buildChordInferenceRegions(visible, scored, selectedPath, withheldStarts), ninthAlternatives,
  );
  return {
    sourceRevision: 0,
    range,
    regions,
    unresolvedObservationIndices: Object.freeze(
      selectedPath.flatMap((candidate, index) => (candidate ? [] : [index])),
    ),
    warnings: warningsForRegions(regions),
  };
}

function overlaps(left: ChordRegion, right: ChordRegion) {
  return (
    left.startTick < right.startTick + right.durationTicks &&
    right.startTick < left.startTick + left.durationTicks
  );
}

function chordOverhangs(existing: ChordRegion, replacement: ChordRegion): ChordRegion[] {
  const existingEnd = existing.startTick + existing.durationTicks;
  const replacementEnd = replacement.startTick + replacement.durationTicks;
  const before = existing.startTick < replacement.startTick;
  return [
    ...(before ? [{ ...existing, durationTicks: replacement.startTick - existing.startTick }] : []),
    ...(replacementEnd < existingEnd ? [{
      ...existing,
      id: before ? createId("chord") : existing.id,
      startTick: replacementEnd,
      durationTicks: existingEnd - replacementEnd,
    }] : []),
  ];
}

function selectedForApply(
  region: ChordInferenceRegion,
  { selection, candidateChoices }: ChordInferenceApplyOptions,
) {
  if (selection && !selection.has(region.id)) return;
  const choice = candidateChoices?.get(region.id);
  if (choice !== undefined) {
    if (region.selected?.id === choice) return region.selected;
    // Alternatives in a merged region may only fit one of its observations.
    if (region.observationIndices.length === 1) return region.alternatives.find(candidate => candidate.id === choice);
    return;
  }
  return selection || region.status === "resolved" ? region.selected : undefined;
}

function regionFromCandidate(
  region: ChordInferenceRegion,
  candidate: ChordInferenceCandidate,
): ChordRegion {
  return {
    id: createId("chord"),
    startTick: region.fromTick,
    durationTicks: region.toTick - region.fromTick,
    identity: structuredClone(candidate.identity),
    ...(candidate.semantics
      ? { semantics: structuredClone(candidate.semantics) }
      : {}),
    locked: false,
  };
}

function addWarning(
  warnings: ChordInferenceWarning[],
  warning: ChordInferenceWarning,
) {
  warnings.push(warning);
}

function noteIsLockedForInference(
  project: ProjectDocument,
  track: ProjectDocument["satbTracks"][number],
  note: ProjectDocument["satbTracks"][number]["notes"][number],
) {
  if (track.locked || note.locked) return true;
  return project.exercise.editableRanges.some(
    (range) =>
      range.editable === false &&
      range.voiceIds.includes(track.voice) &&
      note.startTick < range.toTick &&
      note.startTick + note.durationTicks > range.fromTick,
  );
}

export function applyChordInference(
  project: ProjectDocument,
  result: ChordInferenceResult,
  options: ChordInferenceApplyOptions,
): ChordInferenceApplyResult {
  const warnings: ChordInferenceWarning[] = [];
  const selectedRegions = result.regions.flatMap(region => {
    const candidate = selectedForApply(region, options);
    return candidate ? [{ region, candidate }] : [];
  });
  if (selectedRegions.length === 0)
    return {
      project,
      skipped: Object.freeze(warnings),
      appliedRegionCount: 0,
      writtenNonChordToneRoleCount: 0,
    };
  if (project.chordTrack.locked) {
    for (const { region } of selectedRegions)
      addWarning(warnings, {
        code: "locked-chord",
        fromTick: region.fromTick,
        toTick: region.toTick,
        message: "和弦轨已锁定，推导结果未应用",
      });
    return {
      project,
      skipped: Object.freeze(warnings),
      appliedRegionCount: 0,
      writtenNonChordToneRoleCount: 0,
    };
  }

  let next = cloneProject(project);
  const appliedRegions: typeof selectedRegions = [];
  let writtenNonChordToneRoleCount = 0;
  for (const { region, candidate } of selectedRegions) {
    const proposed = regionFromCandidate(region, candidate);
    const overlappers = next.chordTrack.regions.filter((existing) =>
      overlaps(existing, proposed),
    );
    const lockedOverlap = overlappers.find((existing) => existing.locked);
    if (lockedOverlap) {
      addWarning(warnings, {
        code: "locked-chord",
        fromTick: region.fromTick,
        toTick: region.toTick,
        message: "推导区段与锁定和弦重叠，未应用",
      });
      continue;
    }
    if (options.mode === "fill-gaps" && overlappers.length > 0) {
      addWarning(warnings, {
        code: "overlap",
        fromTick: region.fromTick,
        toTick: region.toTick,
        message: "推导区段已有和弦，填补空白模式下未覆盖",
      });
      continue;
    }
    let candidateProject = next;
    if (options.mode === "replace-unlocked" && overlappers.length > 0) {
      const overlapIds = new Set(overlappers.map((existing) => existing.id));
      candidateProject = cloneProject(next);
      candidateProject.chordTrack.regions = candidateProject.chordTrack.regions.flatMap(existing =>
        !overlapIds.has(existing.id) ? [existing] : options.selection ? chordOverhangs(existing, proposed) : []);
    }
    const added = addChordRegion(candidateProject, proposed);
    if (added.error) {
      addWarning(warnings, {
        code: added.error.includes("调性") ? "key-boundary" : "overlap",
        fromTick: region.fromTick,
        toTick: region.toTick,
        message: added.error,
      });
      continue;
    }
    next = added.project;
    appliedRegions.push({ region, candidate });
  }

  if (options.writeNonChordToneRoles) {
    for (const { region, candidate } of appliedRegions) {
      const assignments = candidate.fit.nonChordToneAssignments;
      for (const [noteId, role] of Object.entries(assignments)) {
        const track = next.satbTracks.find((candidate) =>
          candidate.notes.some((note) => note.id === noteId),
        );
        const note = track?.notes.find((candidate) => candidate.id === noteId);
        // A clipped inference region can still carry evidence from a held note.
        if (!track || !note ||
            note.startTick < result.range.fromTick || note.startTick >= result.range.toTick) continue;
        if (noteIsLockedForInference(next, track, note)) {
          addWarning(warnings, {
            code: "locked-note",
            fromTick: region.fromTick,
            toTick: region.toTick,
            message: "音符已锁定，非和弦音角色未写入",
            noteIds: [noteId],
          });
          continue;
        }
        if (note.nonChordToneRole === role) continue;
        note.nonChordToneRole = role;
        writtenNonChordToneRoleCount += 1;
      }
    }
  }
  if (appliedRegions.length === 0)
    return {
      project,
      skipped: Object.freeze(warnings),
      appliedRegionCount: 0,
      writtenNonChordToneRoleCount: 0,
    };
  if (next !== project) next.updatedAt = new Date().toISOString();
  return {
    project: next,
    skipped: Object.freeze(warnings),
    appliedRegionCount: appliedRegions.length,
    writtenNonChordToneRoleCount,
  };
}

function samePhraseBoundaries(
  left: readonly ProjectDocument["structure"]["phraseBoundaries"][number][],
  right: readonly ProjectDocument["structure"]["phraseBoundaries"][number][],
) {
  return (
    left.length === right.length &&
    left.every((boundary, index) => {
      const candidate = right[index];
      return (
        boundary.id === candidate.id &&
        boundary.tick === candidate.tick &&
        boundary.source === candidate.source &&
        boundary.confidence === candidate.confidence &&
        boundary.locked === candidate.locked &&
        boundary.inferenceFingerprint === candidate.inferenceFingerprint &&
        boundary.stale === candidate.stale
      );
    })
  );
}

function conflictsWithPedalContinuation(
  annotation: CadenceAnnotation,
  continuation: CadenceCandidate,
  landingTick: number,
) {
  if (annotation.stale || annotation.toTick <= continuation.fromTick ||
      continuation.toTick <= annotation.fromTick) return false;
  // Agreement is about which cadence owns the landing and release. The
  // annotated preparation and completion may express a finer reading.
  return annotation.kind !== continuation.kind ||
    (annotation.form !== undefined && annotation.form !== continuation.form) ||
    annotation.fromTick >= landingTick || annotation.toTick !== continuation.toTick;
}

function pedalContinuationMidpoint(project: ProjectDocument, phrases: PhraseAnalysis) {
  if (phrases.template.kind !== "duple") return undefined;
  const [division] = phrases.template.boundaries;
  if (division.distanceToTarget !== 0 || division.support !== "moderate" ||
      !division.evidence.some(item => item.code === "all-voices-end") ||
      project.structure.phraseBoundaries.some(boundary => boundary.source === "manual" || boundary.locked)) return undefined;

  const tick = division.tick;
  const closingMeasure = measureAtTick(buildMeasures(project), tick - 1);
  if (!closingMeasure || closingMeasure.endTick !== tick) return undefined;
  const pedal = project.satbTracks.find(track => track.id === "bass")?.notes.find(note =>
    note.startTick < closingMeasure.startTick && note.startTick + note.durationTicks === tick);
  if (!pedal || project.keyEvents.some(event => pedal.startTick < event.tick && event.tick <= tick)) return undefined;

  // Test the continuous reading without storing it. The normal detector must
  // prove the V7 resolution, held outer voices and joint final release itself.
  const analysis = cadenceInputs({
    ...project, structure: { ...project.structure, phraseBoundaries: [] },
  });
  const index = analysis.slices.findIndex(slice => slice.tick === tick);
  const before = analysis.slices[index - 1]?.notes.soprano;
  const after = analysis.slices[index]?.notes.soprano;
  if (!before || !after || before.startTick + before.durationTicks !== tick ||
      before.durationTicks > ticksPerBeat(project.ppq, closingMeasure.denominator)) return undefined;
  const soprano = writtenInterval(before.pitch, after.pitch);
  if (soprano.diatonicSteps !== -1 || !isWrittenStep(soprano)) return undefined;

  const continuation = detectCadences(analysis).find(candidate =>
    candidate.observedLandingTick === tick && candidate.evidence.some(item => item.code === "closing-tonic-revoicing"));
  if (!continuation || project.chordTrack.cadenceAnnotations.some(annotation =>
    conflictsWithPedalContinuation(annotation, continuation, tick))) return undefined;
  const hadContrastingHarmonyOverPedal = analysis.slices.some(slice => {
    const identity = slice.chord?.identity;
    return slice.tick < closingMeasure.startTick && slice.notes.bass?.id === pedal.id &&
      slice.completeSatb && identity && !pitchClassEquals(identity.root, pedal.pitch) &&
      soundsCompleteWrittenChord(identity, VOICE_ORDER.map(voice => slice.notes[voice]!), slice.notes.bass);
  });
  return hadContrastingHarmonyOverPedal ? { tick, phraseId: continuation.phraseId } : undefined;
}

function applyInferredPhraseBoundaries(project: ProjectDocument) {
  const phraseAnalysis = inferPhrases({
    ...project,
    chordRegions: project.chordTrack.regions,
  });
  const omittedMidpoint = pedalContinuationMidpoint(project, phraseAnalysis);
  const template = omittedMidpoint === undefined ? phraseAnalysis.template.kind : "single";
  const boundaries = phraseAnalysis.boundaries.filter(
    (boundary) => boundary.tick > 0 && boundary.tick < project.lengthTicks &&
      boundary.tick !== omittedMidpoint?.tick,
  );
  if (samePhraseBoundaries(project.structure.phraseBoundaries, boundaries)) {
    return {
      project,
      boundaryCount: boundaries.filter((boundary) => boundary.source === "inferred")
        .length,
      template,
    };
  }
  const next = cloneProject(project);
  next.structure.phraseBoundaries = boundaries.map((boundary) => ({
    ...boundary,
  }));
  if (omittedMidpoint && project.structure.phraseBoundaries.some(boundary => boundary.tick === omittedMidpoint.tick)) {
    // Preserve the owner of a non-conflicting annotation saved under the old split.
    next.chordTrack.cadenceAnnotations = next.chordTrack.cadenceAnnotations.map(annotation =>
      !annotation.stale && phraseAnalysis.segments.some(phrase =>
        phrase.id === annotation.phraseId && phrase.fromTick <= annotation.fromTick && annotation.toTick <= phrase.toTick)
        ? { ...annotation, phraseId: omittedMidpoint.phraseId }
        : annotation);
  }
  reconcileCadenceAnnotationStaleness(next);
  next.updatedAt = new Date().toISOString();
  return {
    project: next,
    boundaryCount: boundaries.filter((boundary) => boundary.source === "inferred")
      .length,
    template,
  };
}

/**
 * 创建完整和声推导的第一阶段结果。乐句依赖最终写入的和弦，
 * 因而在 applyHarmonyInference 中才计算。
 */
export function inferHarmony(
  project: ProjectDocument,
  options: ChordInferenceOptions = {},
): HarmonyInferenceResult {
  return {
    chordInference: inferChords(project, options),
  };
}

export function applyHarmonyInference(
  project: ProjectDocument,
  result: HarmonyInferenceResult,
  options: HarmonyInferenceApplyOptions,
): HarmonyInferenceApplyResult {
  const chordApplied = applyChordInference(
    project,
    result.chordInference,
    options,
  );
  const phrasesApplied = applyInferredPhraseBoundaries(chordApplied.project);
  return {
    ...chordApplied,
    project: phrasesApplied.project,
    appliedPhraseBoundaryCount: phrasesApplied.boundaryCount,
    appliedPhraseTemplate: phrasesApplied.template,
  };
}
