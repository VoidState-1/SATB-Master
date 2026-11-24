import {
  hasValidNoteValues,
  isSatbRangeLocked,
  overlaps,
  type EditResult,
} from "./editing";
import { toMidi, type SpelledPitch } from "./pitch";
import {
  cloneProject,
  defaultVoiceRange,
  getSatbTrack,
  VOICE_ORDER,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "./project";

export interface AutoBrushNoteDraft {
  startTick: number;
  durationTicks: number;
  pitch: SpelledPitch;
  velocity?: number;
  id?: string;
}

export interface AutoBrushReassignment {
  noteId: string;
  fromVoice: VoiceId;
  toVoice: VoiceId;
}

export type AutoBrushPlanResult =
  | {
      ok: true;
      assignedVoice: VoiceId;
      reassignments: readonly AutoBrushReassignment[];
      fixedVoices: readonly VoiceId[];
    }
  | { ok: false; error: string };

export interface AutoBrushApplyResult extends EditResult {
  assignedVoice?: VoiceId;
  reassignments: readonly AutoBrushReassignment[];
}

interface VoicePitch {
  voiceIndex: number;
  midi: number;
}

interface Placement extends VoicePitch {
  cost: number;
}

interface MovableNote extends VoicePitch {
  note: NoteEvent;
  options: readonly Placement[];
}

function crosses(a: VoicePitch, b: VoicePitch) {
  // 声部索引从高声部向低声部递增。
  return (a.voiceIndex - b.voiceIndex) * (a.midi - b.midi) > 0;
}

function* legalAssignments(
  optionsByItem: readonly (readonly Placement[])[],
  fixedIndices: ReadonlySet<number>,
  assigned: readonly Placement[] = [],
): Generator<readonly Placement[]> {
  const options = optionsByItem[assigned.length];
  if (!options) {
    yield assigned;
    return;
  }
  for (const option of options) {
    if (fixedIndices.has(option.voiceIndex)) continue;
    if (
      assigned.some((other) => other.voiceIndex === option.voiceIndex || crosses(other, option))
    )
      continue;
    yield* legalAssignments(optionsByItem, fixedIndices, [...assigned, option]);
  }
}

export function planAutoBrushNote(
  project: ProjectDocument,
  draft: AutoBrushNoteDraft,
): AutoBrushPlanResult {
  const endTick = draft.startTick + draft.durationTicks;
  if (draft.startTick < 0) return { ok: false, error: "音符超出工程时间范围" };
  const { velocity = 1 } = draft;
  if (!hasValidNoteValues({ ...draft, velocity }))
    return { ok: false, error: "音符参数无效" };
  if (endTick > project.lengthTicks)
    return { ok: false, error: "音符超出工程时间范围" };

  const voices = VOICE_ORDER.map((voice, voiceIndex) => {
    const track = getSatbTrack(project, voice);
    const overlapping = track.notes.filter((note) => overlaps(note, draft));
    const [first] = overlapping;
    const fixed =
      track.locked ||
      !track.visible ||
      overlapping.length >= 2 ||
      (first !== undefined && (first.locked || isSatbRangeLocked(project, voice, first)));
    return { voice, voiceIndex, track, overlapping, fixed };
  });

  if (voices.every(({ overlapping }) => overlapping.length > 0))
    return { ok: false, error: "该时间位置四声部已满" };

  function placementsFor(item: AutoBrushNoteDraft, midi: number): Placement[] {
    const placements: Placement[] = [];
    for (const { voice, voiceIndex, track, overlapping, fixed } of voices) {
      if (fixed || isSatbRangeLocked(project, voice, item)) continue;
      const [movable] = overlapping;
      if (track.notes.some((note) => note !== movable && overlaps(note, item))) continue;

      const { minMidi, maxMidi } =
        project.ruleProfile.shared.voiceRanges?.[voice] ?? defaultVoiceRange(voice);
      const overflow = Math.max(minMidi - midi, midi - maxMidi, 0);
      const cost = overflow * 100 + Math.abs(midi - (minMidi + maxMidi) / 2);
      placements.push({ voiceIndex, midi, cost });
    }
    return placements;
  }

  const movables: MovableNote[] = [];
  const fixedIndices = new Set<number>();
  const anchors: VoicePitch[] = [];
  for (const { voiceIndex, overlapping, fixed } of voices) {
    if (fixed) {
      fixedIndices.add(voiceIndex);
      for (const note of overlapping) anchors.push({ voiceIndex, midi: toMidi(note.pitch) });
    } else if (overlapping.length === 1) {
      const [note] = overlapping;
      const midi = toMidi(note.pitch);
      movables.push({ note, voiceIndex, midi, options: placementsFor(note, midi) });
    }
  }

  const newNoteOptions = placementsFor(draft, toMidi(draft.pitch));
  const fallbackSubsets: MovableNote[][] = [[]];
  for (const movable of movables) {
    const { startTick, durationTicks } = movable.note;
    if (startTick < draft.startTick || startTick + durationTicks > endTick) {
      fallbackSubsets.push(...fallbackSubsets.map((subset) => [...subset, movable]));
    }
  }
  fallbackSubsets.sort((a, b) => a.length - b.length);

  let best: {
    pinnedCount: number;
    score: readonly number[];
    plan: Extract<AutoBrushPlanResult, { ok: true }>;
  } | undefined;
  for (const pinned of fallbackSubsets) {
    // 优先保留最多参与重排的音符，再比较同等固定数量的方案。
    if (best && pinned.length > best.pinnedCount) break;
    const blocked = new Set([...fixedIndices, ...pinned.map((item) => item.voiceIndex)]);
    const allAnchors = [...anchors, ...pinned];
    const participants = movables.filter((item) => !pinned.includes(item));
    const optionsByItem = [newNoteOptions, ...participants.map((item) => item.options)];

    for (const assigned of legalAssignments(optionsByItem, blocked)) {
      let crossings = 0;
      let cost = 0;
      for (const placement of assigned) {
        crossings += allAnchors.filter((anchor) => crosses(placement, anchor)).length;
        cost += placement.cost;
      }

      const reassignments: AutoBrushReassignment[] = [];
      const destinations = movables.map((item) => {
        const participantIndex = participants.indexOf(item);
        if (participantIndex === -1) return item.voiceIndex;
        const { voiceIndex } = assigned[participantIndex + 1];
        if (voiceIndex !== item.voiceIndex) {
          reassignments.push({
            noteId: item.note.id,
            fromVoice: VOICE_ORDER[item.voiceIndex],
            toVoice: VOICE_ORDER[voiceIndex],
          });
        }
        return voiceIndex;
      });
      // 先比较新音符，再按原声部顺序比较已有音符的目标声部。
      const [newPlacement] = assigned;
      const score = [crossings, cost, reassignments.length, newPlacement.voiceIndex, ...destinations];
      if (best) {
        const previousScore = best.score;
        const firstDifference = score.findIndex((value, index) => value !== previousScore[index]);
        if (firstDifference === -1 || score[firstDifference] > previousScore[firstDifference])
          continue;
      }
      best = {
        pinnedCount: pinned.length,
        score,
        plan: {
          ok: true,
          assignedVoice: VOICE_ORDER[newPlacement.voiceIndex],
          reassignments,
          fixedVoices: VOICE_ORDER.filter((_, index) => blocked.has(index)),
        },
      };
    }
  }
  if (best) return best.plan;

  const overlapCount = voices.reduce((total, { overlapping }) => total + overlapping.length, 0);
  return {
    ok: false,
    error: overlapCount >= VOICE_ORDER.length
      ? "该时间位置四声部已满"
      : "该时间位置没有可用的未锁定声部",
  };
}

export function applyAutoBrushNote(
  project: ProjectDocument,
  note: NoteEvent,
): AutoBrushApplyResult {
  const plan = planAutoBrushNote(project, note);
  if (!plan.ok) return { project, error: plan.error, reassignments: [] };

  // 额外声部作为整体保留，克隆时无需遍历其中的音符。
  const { auxiliaryTracks, ...rest } = project;
  const next = cloneProject({ ...rest, auxiliaryTracks: [] });
  next.auxiliaryTracks = auxiliaryTracks;

  const affectedVoices = new Set<VoiceId>([plan.assignedVoice]);
  const moves = [];
  for (const { noteId, fromVoice, toVoice } of plan.reassignments) {
    const source = getSatbTrack(next, fromVoice);
    const index = source.notes.findIndex((item) => item.id === noteId && overlaps(item, note));
    if (index === -1) return { project, error: "找不到要重排的音符", reassignments: [] };
    const [moved] = source.notes.splice(index, 1);
    moves.push({ moved, toVoice });
    affectedVoices.add(fromVoice);
    affectedVoices.add(toVoice);
  }
  for (const { moved, toVoice } of moves) getSatbTrack(next, toVoice).notes.push(moved);
  getSatbTrack(next, plan.assignedVoice).notes.push(note);

  for (const track of next.satbTracks) {
    const ordered = affectedVoices.has(track.id) ? track.notes : [...track.notes];
    ordered.sort((a, b) => a.startTick - b.startTick);
    if (ordered.some((item, index) => index > 0 && overlaps(ordered[index - 1], item))) {
      return { project, error: "自动笔刷会造成同声部音符重叠", reassignments: [] };
    }
  }

  next.updatedAt = new Date().toISOString();
  return { project: next, assignedVoice: plan.assignedVoice, reassignments: plan.reassignments };
}
