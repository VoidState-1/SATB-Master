import {
  chordDraftFromIdentity,
  inversionBassOptions,
  harmonySemanticsCompatibleWithIdentity,
  maximumInversionForDraft,
  resolveChordIdentity,
  semanticsFromChordDraft,
} from "./chordModel";
import {
  cloneProject,
  createId,
  getAllPlayableTracks,
  getMusicalTrack,
  type ChordDraft,
  type CadenceAnnotation,
  type ChordRegion,
  type ChordTrack,
  type NoteEvent,
  type ProjectDocument,
} from "./project";
import { pitchClassEquals, toMidi } from "./pitch";
import { keyAtTick } from "./time";
import { cadenceChordCoverage } from "./project/cadenceCoverage";
import { detectProjectCadences } from "./harmony/cadence/projectEvidence";
import { matchingObservedCadence } from "./harmony/cadence/confirmation";
import { reconcileCadenceAnnotationStaleness } from "./project/normalize";

export interface EditResult {
  project: ProjectDocument;
  error?: string;
}

export function addPhraseBoundary(project: ProjectDocument, tick: number): EditResult {
  if (!Number.isInteger(tick) || tick <= 0 || tick >= project.lengthTicks)
    return { project, error: "乐句边界必须位于工程内部" };
  const existing = project.structure.phraseBoundaries.find(
    (boundary) => boundary.tick === tick,
  );
  if (existing?.source === "manual")
    return { project, error: "该位置已经存在人工乐句边界" };
  const next = cloneProject(project);
  if (existing) {
    next.structure.phraseBoundaries = next.structure.phraseBoundaries.map(
      (boundary) => {
        if (boundary.id !== existing.id) return boundary;
        const {
          inferenceFingerprint: _inferenceFingerprint,
          stale: _stale,
          ...manualBoundary
        } = boundary;
        return {
          ...manualBoundary,
          source: "manual",
          confidence: "certain",
        };
      },
    );
  } else {
    next.structure.phraseBoundaries.push({
      id: createId("phrase-boundary"),
      tick,
      source: "manual",
      confidence: "certain",
    });
  }
  next.structure.phraseBoundaries.sort((left, right) => left.tick - right.tick);
  reconcileCadenceAnnotationStaleness(next);
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function deletePhraseBoundary(
  project: ProjectDocument,
  boundaryId: string,
): EditResult {
  const boundary = project.structure.phraseBoundaries.find(
    (item) => item.id === boundaryId,
  );
  if (!boundary) return { project, error: "找不到要删除的乐句边界" };
  if (boundary.locked) return { project, error: "该乐句边界已锁定" };
  const next = cloneProject(project);
  next.structure.phraseBoundaries = next.structure.phraseBoundaries.filter(
    (item) => item.id !== boundaryId,
  );
  reconcileCadenceAnnotationStaleness(next);
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

function overlaps(a: NoteEvent, b: NoteEvent) {
  return (
    a.startTick < b.startTick + b.durationTicks &&
    b.startTick < a.startTick + a.durationTicks
  );
}

function hasValidNoteValues(note: NoteEvent) {
  return (
    Number.isInteger(note.startTick) &&
    note.startTick >= 0 &&
    Number.isInteger(note.durationTicks) &&
    note.durationTicks > 0 &&
    Number.isInteger(toMidi(note.pitch)) &&
    toMidi(note.pitch) >= 0 &&
    toMidi(note.pitch) <= 127 &&
    Number.isInteger(note.velocity) &&
    note.velocity >= 1 &&
    note.velocity <= 127
  );
}

function isRangeLocked(
  project: ProjectDocument,
  trackId: string,
  note: NoteEvent,
) {
  const track = getMusicalTrack(project, trackId);
  if (track.kind === "auxiliary") return false;
  return project.exercise.editableRanges.some(
    (range) =>
      range.editable === false &&
      range.voiceIds.includes(track.voice) &&
      note.startTick < range.toTick &&
      note.startTick + note.durationTicks > range.fromTick,
  );
}

function canEditNote(
  project: ProjectDocument,
  trackId: string,
  note?: NoteEvent,
) {
  const track = getMusicalTrack(project, trackId);
  if (track.locked) return false;
  if (note?.locked) return false;
  return note ? !isRangeLocked(project, trackId, note) : true;
}

export function addNote(
  project: ProjectDocument,
  trackId: string,
  note: NoteEvent,
): EditResult {
  const track = getMusicalTrack(project, trackId);
  if (!canEditNote(project, trackId, note))
    return { project, error: "该声部或时间范围已锁定" };
  if (!hasValidNoteValues(note)) return { project, error: "音符参数无效" };
  if (
    note.startTick < 0 ||
    note.startTick + note.durationTicks > project.lengthTicks
  ) {
    return { project, error: "音符超出工程时间范围" };
  }
  if (
    track.monophonic &&
    track.notes.some((candidate) => overlaps(candidate, note))
  ) {
    // 四部写作中的每条轨道是单旋律声部，重叠必须在命令层拒绝，不能依赖播放时“最后音符优先”。
    return { project, error: "同一声部不能出现重叠音符" };
  }

  const next = cloneProject(project);
  getMusicalTrack(next, trackId).notes.push(note);
  getMusicalTrack(next, trackId).notes.sort(
    (a, b) => a.startTick - b.startTick,
  );
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function updateNote(
  project: ProjectDocument,
  trackId: string,
  noteId: string,
  patch: Partial<
    Pick<
      NoteEvent,
      | "startTick"
      | "durationTicks"
      | "pitch"
      | "velocity"
      | "locked"
      | "spellingSource"
      | "nonChordToneRole"
    >
  >,
): EditResult {
  const track = getMusicalTrack(project, trackId);
  const current = track.notes.find((note) => note.id === noteId);
  if (!current) return { project, error: "找不到要编辑的音符" };
  if (track.locked) return { project, error: "该声部已锁定" };
  if (current.locked && patch.locked !== false)
    return { project, error: "该音符已锁定" };
  if (isRangeLocked(project, trackId, current))
    return { project, error: "该音符位于锁定区间" };

  const updated = { ...current, ...patch, stale: false };
  if (!hasValidNoteValues(updated)) return { project, error: "音符参数无效" };
  if (
    updated.startTick < 0 ||
    updated.durationTicks <= 0 ||
    updated.startTick + updated.durationTicks > project.lengthTicks
  ) {
    return { project, error: "音符超出工程时间范围" };
  }
  if (
    track.monophonic &&
    track.notes.some(
      (candidate) => candidate.id !== noteId && overlaps(candidate, updated),
    )
  ) {
    return { project, error: "移动后会与同声部音符重叠" };
  }
  if (isRangeLocked(project, trackId, updated))
    return { project, error: "移动后会进入锁定区间" };

  const next = cloneProject(project);
  const nextTrack = getMusicalTrack(next, trackId);
  nextTrack.notes = nextTrack.notes.map((note) =>
    note.id === noteId ? updated : note,
  );
  nextTrack.notes.sort((a, b) => a.startTick - b.startTick);
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function transformNotes(
  project: ProjectDocument,
  noteIds: Set<string>,
  transform: (note: NoteEvent, trackId: string) => NoteEvent,
): EditResult {
  const next = cloneProject(project);
  let transformed = 0;
  let hasLockedNote = false;

  for (const track of getAllPlayableTracks(next)) {
    if (track.locked && track.notes.some((note) => noteIds.has(note.id)))
      return { project, error: `${track.name}已锁定` };
    track.notes = track.notes.map((note) => {
      if (!noteIds.has(note.id)) return note;
      if (note.locked || isRangeLocked(project, track.id, note)) {
        hasLockedNote = true;
        return note;
      }
      transformed += 1;
      const updated = transform(note, track.id);
      if (!hasValidNoteValues(updated)) hasLockedNote = true;
      if (isRangeLocked(project, track.id, updated)) hasLockedNote = true;
      return updated;
    });
    if (hasLockedNote)
      return { project, error: "选区包含锁定音符或会产生无效参数" };
    const ordered = [...track.notes].sort((a, b) => a.startTick - b.startTick);
    for (let index = 0; index < ordered.length; index += 1) {
      const note = ordered[index];
      if (
        note.startTick < 0 ||
        note.durationTicks <= 0 ||
        note.startTick + note.durationTicks > project.lengthTicks
      ) {
        return { project, error: "批量操作会使音符超出工程范围" };
      }
      if (track.monophonic && index > 0 && overlaps(ordered[index - 1], note))
        return { project, error: "批量操作会造成同声部音符重叠" };
    }
    track.notes = ordered;
  }

  if (transformed === 0) return { project, error: "没有可编辑的音符" };
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function deleteNotes(
  project: ProjectDocument,
  noteIds: Set<string>,
): EditResult {
  const next = cloneProject(project);
  let deleted = 0;

  for (const track of getAllPlayableTracks(next)) {
    if (track.locked) continue;
    track.notes = track.notes.filter((note) => {
      if (
        !noteIds.has(note.id) ||
        note.locked ||
        isRangeLocked(project, track.id, note)
      )
        return true;
      deleted += 1;
      return false;
    });
  }

  if (deleted === 0) return { project, error: "没有可删除的音符" };
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function splitNote(
  project: ProjectDocument,
  trackId: string,
  noteId: string,
  splitTick: number,
): EditResult {
  const track = getMusicalTrack(project, trackId);
  const current = track.notes.find((note) => note.id === noteId);
  if (!current) return { project, error: "找不到要切分的音符" };
  if (!canEditNote(project, trackId, current))
    return { project, error: "该音符或所在范围已锁定" };
  const endTick = current.startTick + current.durationTicks;
  if (splitTick <= current.startTick || splitTick >= endTick)
    return { project, error: "切分点必须位于音符内部" };

  const next = cloneProject(project);
  const nextTrack = getMusicalTrack(next, trackId);
  nextTrack.notes = nextTrack.notes
    .flatMap((note) =>
      note.id === noteId
        ? [
            { ...note, durationTicks: splitTick - note.startTick },
            {
              ...note,
              id: createId("note"),
              startTick: splitTick,
              durationTicks: endTick - splitTick,
            },
          ]
        : note,
    )
    .sort((a, b) => a.startTick - b.startTick);
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

function chordRegionsOverlap(a: ChordRegion, b: ChordRegion) {
  return (
    a.startTick < b.startTick + b.durationTicks &&
    b.startTick < a.startTick + a.durationTicks
  );
}

function hasValidChordDraft(draft: ChordDraft) {
  const requiredInversion = draft.augmentedSixthVariant
    ? 0
    : draft.extensions?.includes(9)
      ? 0
      : draft.designation?.kind === "cadential64"
        ? 2
        : draft.designation?.kind === "neapolitan"
          ? 1
          : undefined;
  const maximumInversion = maximumInversionForDraft(draft);
  return (
    Number.isInteger(draft.degree) &&
    draft.degree >= 1 &&
    draft.degree <= 7 &&
    Number.isInteger(draft.degreeAlteration) &&
    draft.degreeAlteration >= -2 &&
    draft.degreeAlteration <= 2 &&
    Number.isInteger(draft.inversion) &&
    draft.inversion >= 0 &&
    draft.inversion <= maximumInversion &&
    (requiredInversion === undefined ||
      draft.inversion === requiredInversion) &&
    (draft.appliedTarget === undefined ||
      (Number.isInteger(draft.appliedTarget) &&
        draft.appliedTarget >= 1 &&
        draft.appliedTarget <= 7))
  );
}

function chordRegionError(
  project: ProjectDocument,
  region: ChordRegion,
  excludedIds = new Set<string>(),
) {
  if (
    !Number.isInteger(region.startTick) ||
    !Number.isInteger(region.durationTicks) ||
    region.durationTicks <= 0
  )
    return "和弦时间参数无效";
  if (
    region.startTick < 0 ||
    region.startTick + region.durationTicks > project.lengthTicks
  )
    return "和弦超出工程时间范围";
  if (
    region.semantics &&
    !hasValidChordDraft(
      chordDraftFromIdentity(region.identity, region.semantics),
    )
  )
    return "和弦语义参数无效";
  if (
    region.semantics &&
    !harmonySemanticsCompatibleWithIdentity(
      region.identity,
      region.semantics,
      keyAtTick(project.keyEvents, region.startTick),
    )
  )
    return "和弦的多重解释与实际构成不一致";
  if (
    project.keyEvents.some(
      (event) =>
        event.tick > region.startTick &&
        event.tick < region.startTick + region.durationTicks,
    )
  ) {
    return "和弦区域不能跨越调性变化";
  }
  if (
    project.chordTrack.regions.some(
      (candidate) =>
        !excludedIds.has(candidate.id) &&
        chordRegionsOverlap(candidate, region),
    )
  ) {
    return "和弦区域不能重叠";
  }
  return undefined;
}

export function addChordRegion(
  project: ProjectDocument,
  region: ChordRegion,
): EditResult {
  if (project.chordTrack.locked) return { project, error: "和弦轨已锁定" };
  const normalizedRegion = region.semantics
    ? {
        ...region,
        identity: resolveChordIdentity(
          chordDraftFromIdentity(region.identity, region.semantics),
          keyAtTick(project.keyEvents, region.startTick),
        ),
      }
    : region;
  const error = chordRegionError(project, normalizedRegion);
  if (error) return { project, error };
  const next = cloneProject(project);
  next.chordTrack.regions.push(normalizedRegion);
  next.chordTrack.regions.sort((a, b) => a.startTick - b.startTick);
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

function cadenceAnnotationError(
  project: ProjectDocument,
  annotation: CadenceAnnotation,
  excludedId?: string,
) {
  if (
    !annotation.id ||
    !annotation.phraseId ||
    !Number.isInteger(annotation.fromTick) ||
    !Number.isInteger(annotation.toTick) ||
    annotation.fromTick < 0 ||
    annotation.toTick > project.lengthTicks ||
    annotation.toTick <= annotation.fromTick
  )
    return "终止式范围参数无效";
  if (annotation.observedLandingTick !== undefined) {
    if (!matchingObservedCadence(annotation, detectProjectCadences(project)))
      return "谱面已不支持该终止式的实际落点";
  } else {
    if (project.keyEvents.some(event => annotation.fromTick < event.tick && event.tick < annotation.toTick))
      return "终止式范围不能跨越调性变化";
    if (!cadenceChordCoverage(annotation, project.chordTrack.regions, project.structure.phraseBoundaries).continuous)
      return "终止式范围必须覆盖连续的和弦区域";
  }
  if (
    project.chordTrack.cadenceAnnotations.some(
      (candidate) =>
        candidate.id !== excludedId &&
        candidate.fromTick < annotation.toTick &&
        annotation.fromTick < candidate.toTick,
    )
  )
    return "终止式范围不能与其他标注重叠";
  if (annotation.kind !== "full" && annotation.completion !== undefined)
    return "只有全终止可以设置完满性";
  if (annotation.kind === "deceptive" && annotation.form === "plagal")
    return "阻碍终止不能使用变格限定";
  if (annotation.kind === "supplementary" && annotation.form !== "plagal")
    return "补充终止必须使用变格限定";
  return undefined;
}

export function addCadenceAnnotation(
  project: ProjectDocument,
  annotation: CadenceAnnotation,
): EditResult {
  if (project.chordTrack.locked) return { project, error: "和弦轨已锁定" };
  const error = cadenceAnnotationError(project, annotation);
  if (error) return { project, error };
  const next = cloneProject(project);
  next.chordTrack.cadenceAnnotations.push(annotation.observedLandingTick === undefined ? annotation : { ...annotation, stale: false });
  next.chordTrack.cadenceAnnotations.sort(
    (left, right) => left.fromTick - right.fromTick,
  );
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export type CadenceAnnotationPatch = Partial<
  Pick<
    CadenceAnnotation,
    "phraseId" | "fromTick" | "toTick" | "kind" | "form" | "completion" | "confidence" | "locked"
  >
>;

export function updateCadenceAnnotation(
  project: ProjectDocument,
  annotationId: string,
  patch: CadenceAnnotationPatch,
): EditResult {
  const current = project.chordTrack.cadenceAnnotations.find(
    (annotation) => annotation.id === annotationId,
  );
  if (!current) return { project, error: "找不到要编辑的终止式" };
  if (project.chordTrack.locked) return { project, error: "和弦轨已锁定" };
  if (current.locked && patch.locked !== false)
    return { project, error: "该终止式已锁定" };
  const updated = { ...current, ...patch };
  const unlockingOnly = current.locked && patch.locked === false && Object.keys(patch).length === 1;
  if (!unlockingOnly) {
    const changedReading = updated.fromTick !== current.fromTick || updated.toTick !== current.toTick ||
      updated.phraseId !== current.phraseId || updated.kind !== current.kind ||
      updated.form !== current.form || updated.completion !== current.completion;
    if (updated.observedLandingTick !== undefined && changedReading &&
        cadenceChordCoverage(updated, project.chordTrack.regions, project.structure.phraseBoundaries).continuous) {
      delete updated.observedLandingTick;
      updated.source = "manual";
      updated.stale = false;
    }
    const error = cadenceAnnotationError(project, updated, annotationId);
    if (error) return { project, error };
    if (updated.observedLandingTick !== undefined) updated.stale = false;
  }
  const next = cloneProject(project);
  const index = next.chordTrack.cadenceAnnotations.findIndex(
    (annotation) => annotation.id === annotationId,
  );
  next.chordTrack.cadenceAnnotations[index] = updated;
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function deleteCadenceAnnotation(
  project: ProjectDocument,
  annotationId: string,
): EditResult {
  const current = project.chordTrack.cadenceAnnotations.find(
    (annotation) => annotation.id === annotationId,
  );
  if (!current) return { project, error: "找不到要删除的终止式" };
  if (project.chordTrack.locked || current.locked)
    return { project, error: "该终止式或和弦轨已锁定" };
  const next = cloneProject(project);
  next.chordTrack.cadenceAnnotations = next.chordTrack.cadenceAnnotations.filter(
    (annotation) => annotation.id !== annotationId,
  );
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export type ChordRegionPatch = Partial<
  Pick<ChordRegion, "startTick" | "durationTicks" | "locked">
> & {
  draft?: Partial<ChordDraft>;
  writtenBass?: ChordRegion["identity"]["bass"];
};

export function updateChordRegion(
  project: ProjectDocument,
  chordId: string,
  patch: ChordRegionPatch,
): EditResult {
  const current = project.chordTrack.regions.find(
    (region) => region.id === chordId,
  );
  if (!current) return { project, error: "找不到要编辑的和弦" };
  if (project.chordTrack.locked) return { project, error: "和弦轨已锁定" };
  if (current.locked && patch.locked !== false)
    return { project, error: "该和弦已锁定" };
  const { draft: draftPatch, writtenBass, ...directPatch } = patch;
  if (writtenBass && (current.semantics || draftPatch ||
      !inversionBassOptions(current.identity)
        .some(tone => pitchClassEquals(tone, writtenBass)))) {
    return { project, error: "实写低音必须是当前绝对和弦可用的转位音" };
  }
  let updated: ChordRegion = {
    ...current,
    ...directPatch,
    ...(writtenBass ? { identity: { ...current.identity, bass: writtenBass } } : {}),
  };
  if (current.semantics || draftPatch) {
    if (!current.semantics) return { project, error: "和弦缺少可编辑的语义" };
    const draft = {
      ...chordDraftFromIdentity(current.identity, current.semantics),
      ...draftPatch,
      // A semantic edit is a new user confirmation, even when the region was inferred.
      source: "manual" as const,
    } as ChordDraft;
    if (!hasValidChordDraft(draft))
      return { project, error: "和弦语义参数无效" };
    updated = {
      ...updated,
      semantics: semanticsFromChordDraft(draft),
      // 和弦移动跨过调性边界时，实体拼写必须跟随新位置重新解析。
      identity: resolveChordIdentity(
        draft,
        keyAtTick(project.keyEvents, updated.startTick),
      ),
    };
  }
  const error = chordRegionError(project, updated, new Set([chordId]));
  if (error) return { project, error };
  const next = cloneProject(project);
  next.chordTrack.regions = next.chordTrack.regions
    .map((region) => (region.id === chordId ? updated : region))
    .sort((a, b) => a.startTick - b.startTick);
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function transformChordRegions(
  project: ProjectDocument,
  chordIds: Set<string>,
  transform: (region: ChordRegion) => ChordRegion,
): EditResult {
  if (project.chordTrack.locked) return { project, error: "和弦轨已锁定" };
  const selected = project.chordTrack.regions.filter((region) =>
    chordIds.has(region.id),
  );
  if (selected.length === 0) return { project, error: "没有可编辑的和弦" };
  if (selected.some((region) => region.locked))
    return { project, error: "选区包含锁定和弦" };

  const transformed = selected.map((region) => {
    const updated = transform(region);
    return updated.semantics
      ? {
          ...updated,
          // 批量移动也必须按新位置调性重算实体拼写，避免语义与实体分叉。
          identity: resolveChordIdentity(
            chordDraftFromIdentity(updated.identity, updated.semantics),
            keyAtTick(project.keyEvents, updated.startTick),
          ),
        }
      : updated;
  });
  for (const region of transformed) {
    const error = chordRegionError(project, region, chordIds);
    if (error) return { project, error };
  }
  const ordered = [...transformed].sort((a, b) => a.startTick - b.startTick);
  if (
    ordered.some(
      (region, index) =>
        index > 0 && chordRegionsOverlap(ordered[index - 1], region),
    )
  ) {
    return { project, error: "批量操作会造成和弦重叠" };
  }

  const replacements = new Map(
    transformed.map((region) => [region.id, region]),
  );
  const next = cloneProject(project);
  next.chordTrack.regions = next.chordTrack.regions
    .map((region) => replacements.get(region.id) ?? region)
    .sort((a, b) => a.startTick - b.startTick);
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function deleteChordRegions(
  project: ProjectDocument,
  chordIds: Set<string>,
): EditResult {
  if (project.chordTrack.locked) return { project, error: "和弦轨已锁定" };
  const deletable = project.chordTrack.regions.filter(
    (region) => chordIds.has(region.id) && !region.locked,
  );
  if (deletable.length === 0) return { project, error: "没有可删除的和弦" };
  const deletableIds = new Set(deletable.map((region) => region.id));
  const next = cloneProject(project);
  next.chordTrack.regions = next.chordTrack.regions.filter(
    (region) => !deletableIds.has(region.id),
  );
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function splitChordRegion(
  project: ProjectDocument,
  chordId: string,
  splitTick: number,
): EditResult {
  const current = project.chordTrack.regions.find(
    (region) => region.id === chordId,
  );
  if (!current) return { project, error: "找不到要切分的和弦" };
  if (project.chordTrack.locked || current.locked)
    return { project, error: "该和弦或和弦轨已锁定" };
  const endTick = current.startTick + current.durationTicks;
  if (
    !Number.isInteger(splitTick) ||
    splitTick <= current.startTick ||
    splitTick >= endTick
  ) {
    return { project, error: "切分点必须位于和弦区域内部" };
  }
  const next = cloneProject(project);
  next.chordTrack.regions = next.chordTrack.regions
    .flatMap((region) =>
      region.id === chordId
        ? [
            { ...region, durationTicks: splitTick - region.startTick },
            {
              ...region,
              id: createId("chord"),
              startTick: splitTick,
              durationTicks: endTick - splitTick,
            },
          ]
        : region,
    )
    .sort((a, b) => a.startTick - b.startTick);
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function setChordTrackState(
  project: ProjectDocument,
  patch: Partial<Pick<ChordTrack, "visible" | "locked" | "displayMode">>,
): EditResult {
  if (project.chordTrack.locked && patch.locked !== false)
    return { project, error: "和弦轨已锁定" };
  const next = cloneProject(project);
  Object.assign(next.chordTrack, patch);
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function replaceProject(
  project: ProjectDocument,
  mutate: (draft: ProjectDocument) => void,
): ProjectDocument {
  const next = cloneProject(project);
  mutate(next);
  next.updatedAt = new Date().toISOString();
  return next;
}
