import { createId } from "../../project/defaults";
import { cloneProject } from "../../project/selectors";
import { addChordRegion } from "../../editing";
import type { ChordRegion, ProjectDocument } from "../../project";
import type {
  ChordInferenceApplyOptions,
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

function selectedForApply(
  region: ChordInferenceRegion,
  selection: ReadonlySet<string> | undefined,
) {
  if (!region.selected) return false;
  if (selection) return selection.has(region.id);
  return region.status === "resolved";
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

export function applyChordInference(
  project: ProjectDocument,
  result: ChordInferenceResult,
  options: ChordInferenceApplyOptions,
) {
  const warnings: ChordInferenceWarning[] = [];
  const selectedRegions = result.regions.filter((region) =>
    selectedForApply(region, options.selection),
  );
  if (selectedRegions.length === 0)
    return { project, skipped: Object.freeze(warnings) };
  if (project.chordTrack.locked) {
    for (const region of selectedRegions)
      addWarning(warnings, {
        code: "locked-chord",
        fromTick: region.fromTick,
        toTick: region.toTick,
        message: "和弦轨已锁定，推导结果未应用",
      });
    return { project, skipped: Object.freeze(warnings) };
  }

  let next = cloneProject(project);
  const appliedRegions: ChordInferenceRegion[] = [];
  for (const region of selectedRegions) {
    const candidate = region.selected!;
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
      candidateProject.chordTrack.regions = candidateProject.chordTrack.regions.filter(
        (existing) => !overlapIds.has(existing.id),
      );
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
    appliedRegions.push(region);
  }

  if (options.writeNonChordToneRoles) {
    for (const region of appliedRegions) {
      const assignments = region.selected?.fit.nonChordToneAssignments ?? {};
      for (const [noteId, role] of Object.entries(assignments)) {
        const track = next.satbTracks.find((candidate) =>
          candidate.notes.some((note) => note.id === noteId),
        );
        const note = track?.notes.find((candidate) => candidate.id === noteId);
        if (!track || !note) continue;
        if (note.locked) {
          addWarning(warnings, {
            code: "locked-note",
            fromTick: region.fromTick,
            toTick: region.toTick,
            message: "音符已锁定，非和弦音角色未写入",
            noteIds: [noteId],
          });
          continue;
        }
        note.nonChordToneRole = role;
      }
    }
  }
  if (next !== project) next.updatedAt = new Date().toISOString();
  return { project: next, skipped: Object.freeze(warnings) };
}
