import { isSeventhChord } from "./chords";
import {
  cloneProject,
  createId,
  getTrack,
  type ChordAnalysis,
  type ChordRegion,
  type ChordTrack,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "./model";

export interface EditResult {
  project: ProjectDocument;
  error?: string;
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
    Number.isInteger(note.midiNote) &&
    note.midiNote >= 0 &&
    note.midiNote <= 127 &&
    Number.isInteger(note.velocity) &&
    note.velocity >= 1 &&
    note.velocity <= 127
  );
}

function isRangeLocked(
  project: ProjectDocument,
  voiceId: VoiceId,
  note: NoteEvent,
) {
  return project.exercise.editableRanges.some(
    (range) =>
      range.editable === false &&
      range.voiceIds.includes(voiceId) &&
      note.startTick < range.toTick &&
      note.startTick + note.durationTicks > range.fromTick,
  );
}

function canEditNote(
  project: ProjectDocument,
  voiceId: VoiceId,
  note?: NoteEvent,
) {
  const track = getTrack(project, voiceId);
  if (track.locked) return false;
  if (note?.locked) return false;
  return note ? !isRangeLocked(project, voiceId, note) : true;
}

export function addNote(
  project: ProjectDocument,
  voiceId: VoiceId,
  note: NoteEvent,
): EditResult {
  const track = getTrack(project, voiceId);
  if (!canEditNote(project, voiceId, note))
    return { project, error: "该声部或时间范围已锁定" };
  if (!hasValidNoteValues(note)) return { project, error: "音符参数无效" };
  if (
    note.startTick < 0 ||
    note.startTick + note.durationTicks > project.lengthTicks
  ) {
    return { project, error: "音符超出工程时间范围" };
  }
  if (track.notes.some((candidate) => overlaps(candidate, note))) {
    // 四部写作中的每条轨道是单旋律声部，重叠必须在命令层拒绝，不能依赖播放时“最后音符优先”。
    return { project, error: "同一声部不能出现重叠音符" };
  }

  const next = cloneProject(project);
  getTrack(next, voiceId).notes.push(note);
  getTrack(next, voiceId).notes.sort((a, b) => a.startTick - b.startTick);
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export function updateNote(
  project: ProjectDocument,
  voiceId: VoiceId,
  noteId: string,
  patch: Partial<
    Pick<
      NoteEvent,
      | "startTick"
      | "durationTicks"
      | "midiNote"
      | "velocity"
      | "locked"
      | "nonChordToneRole"
    >
  >,
): EditResult {
  const track = getTrack(project, voiceId);
  const current = track.notes.find((note) => note.id === noteId);
  if (!current) return { project, error: "找不到要编辑的音符" };
  if (track.locked) return { project, error: "该声部已锁定" };
  if (current.locked && patch.locked !== false)
    return { project, error: "该音符已锁定" };
  if (isRangeLocked(project, voiceId, current))
    return { project, error: "该音符位于锁定区间" };

  const updated = { ...current, ...patch };
  if (!hasValidNoteValues(updated)) return { project, error: "音符参数无效" };
  if (
    updated.startTick < 0 ||
    updated.durationTicks <= 0 ||
    updated.startTick + updated.durationTicks > project.lengthTicks
  ) {
    return { project, error: "音符超出工程时间范围" };
  }
  if (
    track.notes.some(
      (candidate) => candidate.id !== noteId && overlaps(candidate, updated),
    )
  ) {
    return { project, error: "移动后会与同声部音符重叠" };
  }
  if (isRangeLocked(project, voiceId, updated))
    return { project, error: "移动后会进入锁定区间" };

  const next = cloneProject(project);
  const nextTrack = getTrack(next, voiceId);
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
  transform: (note: NoteEvent, voiceId: VoiceId) => NoteEvent,
): EditResult {
  const next = cloneProject(project);
  let transformed = 0;
  let hasLockedNote = false;

  for (const track of next.tracks) {
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
      if (index > 0 && overlaps(ordered[index - 1], note))
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

  for (const track of next.tracks) {
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
  voiceId: VoiceId,
  noteId: string,
  splitTick: number,
): EditResult {
  const track = getTrack(project, voiceId);
  const current = track.notes.find((note) => note.id === noteId);
  if (!current) return { project, error: "找不到要切分的音符" };
  if (!canEditNote(project, voiceId, current))
    return { project, error: "该音符或所在范围已锁定" };
  const endTick = current.startTick + current.durationTicks;
  if (splitTick <= current.startTick || splitTick >= endTick)
    return { project, error: "切分点必须位于音符内部" };

  const next = cloneProject(project);
  const nextTrack = getTrack(next, voiceId);
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

function hasValidChordAnalysis(analysis: ChordAnalysis) {
  const maximumInversion = isSeventhChord(analysis.quality) ? 3 : 2;
  return (
    Number.isInteger(analysis.degree) &&
    analysis.degree >= 1 &&
    analysis.degree <= 7 &&
    Number.isInteger(analysis.accidental) &&
    analysis.accidental >= -2 &&
    analysis.accidental <= 2 &&
    Number.isInteger(analysis.inversion) &&
    analysis.inversion >= 0 &&
    analysis.inversion <= maximumInversion &&
    (analysis.appliedToDegree === undefined ||
      (Number.isInteger(analysis.appliedToDegree) &&
        analysis.appliedToDegree >= 1 &&
        analysis.appliedToDegree <= 7))
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
  if (!hasValidChordAnalysis(region.analysis)) return "和弦分析参数无效";
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
  const error = chordRegionError(project, region);
  if (error) return { project, error };
  const next = cloneProject(project);
  next.chordTrack.regions.push(region);
  next.chordTrack.regions.sort((a, b) => a.startTick - b.startTick);
  next.updatedAt = new Date().toISOString();
  return { project: next };
}

export type ChordRegionPatch = Partial<
  Pick<ChordRegion, "startTick" | "durationTicks" | "locked">
> & {
  analysis?: Partial<ChordAnalysis>;
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
  const updated: ChordRegion = {
    ...current,
    ...patch,
    analysis: { ...current.analysis, ...patch.analysis },
  };
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

  const transformed = selected.map(transform);
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
