import { createId } from "../../project/defaults";
import { cloneProject } from "../../project/selectors";
import { addChordRegion } from "../../editing";
import type { ChordRegion, ProjectDocument } from "../../project";
import type {
  ChordInferenceApplyOptions,
  ChordInferenceApplyResult,
  ChordInferenceCandidate,
  ChordInferenceRegion,
  ChordInferenceResult,
  ChordInferenceWarning,
} from "./types";

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
