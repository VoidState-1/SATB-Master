import {
  KEY_NAMES,
  VOICE_CONFIG,
  VOICE_ORDER,
  getTrack,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "./model";
import {
  QUALITY_INTERVALS,
  chordAtTick,
  chordFunction,
  chordPitchClasses,
  chordRootPitchClass,
  formatChordRegion,
} from "./chords";
import { keyAtTick } from "./time";
import {
  chordDependentRuleIds,
  defaultHarmonyRuleSeverities,
  type DiagnosticSeverity,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
} from "./harmonyRules";

export type { DiagnosticSeverity } from "./harmonyRules";

export interface HarmonyDiagnostic {
  id: string;
  ruleId: HarmonyRuleId;
  severity: DiagnosticSeverity;
  tick: number;
  endTick: number;
  voiceIds: VoiceId[];
  noteIds: string[];
  chordIds: string[];
  title: string;
  message: string;
}

export interface HarmonyCheckResult {
  diagnostics: HarmonyDiagnostic[];
  skippedRuleIds: string[];
}

interface Slice {
  tick: number;
  endTick: number;
  notes: Partial<Record<VoiceId, NoteEvent>>;
}

const CHORD_RULE_IDS = chordDependentRuleIds();

function pitchClass(note: number) {
  return ((note % 12) + 12) % 12;
}

function direction(from: number, to: number) {
  return Math.sign(to - from);
}

function diagnostic(
  ruleId: HarmonyRuleId,
  severity: DiagnosticSeverity,
  tick: number,
  endTick: number,
  voiceIds: VoiceId[],
  notes: NoteEvent[],
  title: string,
  message: string,
  chordIds: string[] = [],
): HarmonyDiagnostic {
  const noteIds = notes.map((note) => note.id);
  return {
    id: `${ruleId}:${tick}:${[...noteIds].sort().join(",")}:${[...chordIds].sort().join(",")}`,
    ruleId,
    severity,
    tick,
    endTick,
    voiceIds,
    noteIds,
    chordIds,
    title,
    message,
  };
}

function buildSlices(project: ProjectDocument): Slice[] {
  const boundaries = new Set<number>([0, project.lengthTicks]);
  project.tracks.forEach((track) =>
    track.notes.forEach((note) => {
      boundaries.add(note.startTick);
      boundaries.add(note.startTick + note.durationTicks);
    }),
  );
  project.chordTrack.regions.forEach((chord) => {
    boundaries.add(chord.startTick);
    boundaries.add(chord.startTick + chord.durationTicks);
  });
  project.keyEvents.forEach((event) => boundaries.add(event.tick));

  const ordered = [...boundaries]
    .filter((tick) => tick >= 0 && tick <= project.lengthTicks)
    .sort((a, b) => a - b);
  return ordered.slice(0, -1).map((tick, index) => {
    const notes: Slice["notes"] = {};
    project.tracks.forEach((track) => {
      notes[track.id] = track.notes.find(
        (note) =>
          note.startTick <= tick && note.startTick + note.durationTicks > tick,
      );
    });
    return { tick, endTick: ordered[index + 1], notes };
  });
}

function checkRanges(project: ProjectDocument) {
  const diagnostics: HarmonyDiagnostic[] = [];
  project.tracks.forEach((track) =>
    track.notes.forEach((note) => {
      const range = VOICE_CONFIG[track.id];
      if (note.midiNote < range.min || note.midiNote > range.max) {
        diagnostics.push(
          diagnostic(
            "voice-range",
            "warning",
            note.startTick,
            note.startTick + note.durationTicks,
            [track.id],
            [note],
            "超出建议音域",
            `${track.name}建议使用 MIDI ${range.min}-${range.max}，当前音高为 ${note.midiNote}。`,
          ),
        );
      }
    }),
  );
  return diagnostics;
}

function checkMelodicMotion(project: ProjectDocument) {
  const diagnostics: HarmonyDiagnostic[] = [];
  project.tracks.forEach((track) => {
    const notes = [...track.notes].sort((a, b) => a.startTick - b.startTick);
    for (let index = 1; index < notes.length; index += 1) {
      const previous = notes[index - 1];
      const current = notes[index];

      // 同一声部按单旋律处理；重叠后无法可靠判定前后进行，因此只报告结构错误。
      if (current.startTick < previous.startTick + previous.durationTicks) {
        diagnostics.push(
          diagnostic(
            "voice-note-overlap",
            "error",
            current.startTick,
            current.startTick + current.durationTicks,
            [track.id],
            [previous, current],
            "同声部音符重叠",
            `${track.name}中存在时间上互相重叠的音符。`,
          ),
        );
        continue;
      }

      const interval = Math.abs(current.midiNote - previous.midiNote);
      if (interval > 12) {
        diagnostics.push(
          diagnostic(
            "melodic-leap-over-octave",
            "error",
            current.startTick,
            current.startTick + current.durationTicks,
            [track.id],
            [previous, current],
            "旋律跳进过大",
            `${track.name}出现超过八度的跳进（${interval} 个半音）。`,
          ),
        );
      } else if (interval > 7) {
        diagnostics.push(
          diagnostic(
            "melodic-large-leap",
            "warning",
            current.startTick,
            current.startTick + current.durationTicks,
            [track.id],
            [previous, current],
            "较大旋律跳进",
            `${track.name}出现大于纯五度的跳进，需检查前后旋律方向。`,
          ),
        );
      } else if (interval === 6) {
        diagnostics.push(
          diagnostic(
            "melodic-tritone",
            "warning",
            current.startTick,
            current.startTick + current.durationTicks,
            [track.id],
            [previous, current],
            "旋律三全音",
            `${track.name}出现三全音跳进。`,
          ),
        );
      }

      const previousKey = keyAtTick(project.keyEvents, previous.startTick);
      const currentKey = keyAtTick(project.keyEvents, current.startTick);
      const sameKeyContext =
        previousKey.tonic === currentKey.tonic &&
        previousKey.mode === currentKey.mode;
      const previousDegree = pitchClass(previous.midiNote - previousKey.tonic);
      const contiguous =
        current.startTick === previous.startTick + previous.durationTicks;

      // 只在连续两音处检查，并避开换调边界；小调的导音指升高的第七级（主音下方半音）。
      if (sameKeyContext && previousDegree === 11 && contiguous) {
        if (
          pitchClass(current.midiNote) !== pitchClass(previousKey.tonic) ||
          current.midiNote <= previous.midiNote
        ) {
          diagnostics.push(
            diagnostic(
              "leading-tone-resolution",
              "warning",
              current.startTick,
              current.startTick + current.durationTicks,
              [track.id],
              [previous, current],
              "导音未上行解决",
              `${KEY_NAMES[previousKey.tonic]} ${previousKey.mode === "major" ? "大调" : "小调"}中的导音通常应上行解决到主音。`,
            ),
          );
        }
      }
    }
  });
  return diagnostics;
}

function checkChordToneResolution(project: ProjectDocument) {
  const diagnostics: HarmonyDiagnostic[] = [];

  project.tracks.forEach((track) => {
    const notes = [...track.notes].sort((a, b) => a.startTick - b.startTick);
    for (let index = 1; index < notes.length; index += 1) {
      const previous = notes[index - 1];
      const current = notes[index];
      if (current.startTick !== previous.startTick + previous.durationTicks)
        continue;

      const chord = chordAtTick(project, previous.startTick);
      if (!chord) continue;
      const intervals = QUALITY_INTERVALS[chord.analysis.quality];
      if (intervals.length !== 4) continue;

      const key = keyAtTick(project.keyEvents, chord.startTick);
      const seventh = pitchClass(
        chordRootPitchClass(chord.analysis, key) + intervals[3],
      );
      if (pitchClass(previous.midiNote) !== seventh) continue;

      // 标注七和弦的七音以半音或全音下行解决；跨休止与无和弦标注处不作推断。
      const resolution = current.midiNote - previous.midiNote;
      if (resolution !== -1 && resolution !== -2) {
        diagnostics.push(
          diagnostic(
            "chord-seventh-resolution",
            "warning",
            current.startTick,
            current.startTick + current.durationTicks,
            [track.id],
            [previous, current],
            "七音未级进下行解决",
            `${formatChordRegion(project, chord).roman} 的七音通常应以半音或全音级进下行解决。`,
            [chord.id],
          ),
        );
      }
    }
  });

  return diagnostics;
}

function checkVerticalSlices(slices: Slice[]) {
  const diagnostics: HarmonyDiagnostic[] = [];
  const seen = new Set<string>();

  slices.forEach((slice) => {
    const notes = slice.notes;
    const adjacent: Array<[VoiceId, VoiceId]> = [
      ["soprano", "alto"],
      ["alto", "tenor"],
      ["tenor", "bass"],
    ];
    adjacent.forEach(([upperId, lowerId], pairIndex) => {
      const upper = notes[upperId];
      const lower = notes[lowerId];
      if (!upper || !lower) return;

      if (upper.midiNote < lower.midiNote) {
        const item = diagnostic(
          "voice-crossing",
          "error",
          slice.tick,
          slice.endTick,
          [upperId, lowerId],
          [upper, lower],
          "声部交叉",
          "较高声部低于相邻的较低声部。",
        );
        if (!seen.has(item.id)) diagnostics.push(item);
        seen.add(item.id);
      }

      if (pairIndex < 2 && upper.midiNote - lower.midiNote > 12) {
        const item = diagnostic(
          "upper-spacing",
          "warning",
          slice.tick,
          slice.endTick,
          [upperId, lowerId],
          [upper, lower],
          "上三声部间距过宽",
          "S-A 与 A-T 的相邻声部间距通常不应超过八度。",
        );
        if (!seen.has(item.id)) diagnostics.push(item);
        seen.add(item.id);
      }
    });
  });
  return diagnostics;
}

function checkVoiceLeading(slices: Slice[]) {
  const diagnostics: HarmonyDiagnostic[] = [];
  const seen = new Set<string>();

  for (let index = 1; index < slices.length; index += 1) {
    const previous = slices[index - 1];
    const current = slices[index];

    for (
      let upperIndex = 0;
      upperIndex < VOICE_ORDER.length - 1;
      upperIndex += 1
    ) {
      for (
        let lowerIndex = upperIndex + 1;
        lowerIndex < VOICE_ORDER.length;
        lowerIndex += 1
      ) {
        const upperId = VOICE_ORDER[upperIndex];
        const lowerId = VOICE_ORDER[lowerIndex];
        const previousUpper = previous.notes[upperId];
        const previousLower = previous.notes[lowerId];
        const currentUpper = current.notes[upperId];
        const currentLower = current.notes[lowerId];
        if (!previousUpper || !previousLower || !currentUpper || !currentLower)
          continue;

        const upperDirection = direction(
          previousUpper.midiNote,
          currentUpper.midiNote,
        );
        const lowerDirection = direction(
          previousLower.midiNote,
          currentLower.midiNote,
        );
        const previousInterval = pitchClass(
          previousUpper.midiNote - previousLower.midiNote,
        );
        const currentInterval = pitchClass(
          currentUpper.midiNote - currentLower.midiNote,
        );
        const similarMotion =
          upperDirection !== 0 && upperDirection === lowerDirection;

        if (
          similarMotion &&
          previousInterval === currentInterval &&
          (currentInterval === 0 || currentInterval === 7)
        ) {
          const ruleId =
            currentInterval === 7 ? "parallel-fifths" : "parallel-octaves";
          const item = diagnostic(
            ruleId,
            "error",
            current.tick,
            current.endTick,
            [upperId, lowerId],
            [previousUpper, previousLower, currentUpper, currentLower],
            currentInterval === 7 ? "平行纯五度" : "平行八度或同度",
            "两个声部同向移动，并连续形成相同类型的完全协和音程。",
          );
          if (!seen.has(item.id)) diagnostics.push(item);
          seen.add(item.id);
        }

        if (
          upperId === "soprano" &&
          lowerId === "bass" &&
          similarMotion &&
          (currentInterval === 0 || currentInterval === 7)
        ) {
          if (
            Math.abs(currentUpper.midiNote - previousUpper.midiNote) > 2 &&
            previousInterval !== currentInterval
          ) {
            const item = diagnostic(
              "hidden-perfect-interval",
              "warning",
              current.tick,
              current.endTick,
              [upperId, lowerId],
              [previousUpper, previousLower, currentUpper, currentLower],
              "外声部隐伏完全协和音程",
              "外声部同向进入纯五度或八度，且高声部发生跳进。",
            );
            if (!seen.has(item.id)) diagnostics.push(item);
            seen.add(item.id);
          }
        }
      }
    }

    const adjacent: Array<[VoiceId, VoiceId]> = [
      ["soprano", "alto"],
      ["alto", "tenor"],
      ["tenor", "bass"],
    ];
    adjacent.forEach(([upperId, lowerId]) => {
      const previousUpper = previous.notes[upperId];
      const previousLower = previous.notes[lowerId];
      const currentUpper = current.notes[upperId];
      const currentLower = current.notes[lowerId];
      if (!previousUpper || !previousLower || !currentUpper || !currentLower)
        return;
      if (
        currentUpper.midiNote < previousLower.midiNote ||
        currentLower.midiNote > previousUpper.midiNote
      ) {
        const item = diagnostic(
          "voice-overlap",
          "warning",
          current.tick,
          current.endTick,
          [upperId, lowerId],
          [previousUpper, previousLower, currentUpper, currentLower],
          "声部重叠",
          "当前声部进入了相邻声部上一位置所占据的音域。",
        );
        if (!seen.has(item.id)) diagnostics.push(item);
        seen.add(item.id);
      }
    });
  }

  return diagnostics;
}

function checkChordRules(project: ProjectDocument, slices: Slice[]) {
  const diagnostics: HarmonyDiagnostic[] = [];

  const appendMerged = (item: HarmonyDiagnostic) => {
    const previous = [...diagnostics]
      .reverse()
      .find(
        (candidate) =>
          candidate.ruleId === item.ruleId &&
          candidate.endTick === item.tick &&
          candidate.noteIds.join(",") === item.noteIds.join(",") &&
          candidate.chordIds.join(",") === item.chordIds.join(","),
      );
    if (previous) {
      previous.endTick = item.endTick;
      return;
    }
    diagnostics.push(item);
  };

  slices.forEach((slice) => {
    const chord = chordAtTick(project, slice.tick);
    if (!chord) return;
    const active = VOICE_ORDER.map((voiceId) => ({
      voiceId,
      note: slice.notes[voiceId],
    })).filter((item): item is { voiceId: VoiceId; note: NoteEvent } =>
      Boolean(item.note),
    );
    const key = keyAtTick(project.keyEvents, slice.tick);
    const chordTones = chordPitchClasses(chord.analysis, key);
    const chordName = formatChordRegion(project, chord).roman;
    const outside = active.filter(
      ({ note }) =>
        !note.nonChordToneRole &&
        !chordTones.includes(pitchClass(note.midiNote)),
    );
    if (outside.length > 0) {
      appendMerged(
        diagnostic(
          "chord-membership",
          "warning",
          slice.tick,
          slice.endTick,
          outside.map((item) => item.voiceId),
          outside.map((item) => item.note),
          "和弦外音需要确认",
          `标注和弦 ${chordName} 中存在未识别为和弦构成音的音符；可在音符属性中人工标注其非和弦音角色。`,
          [chord.id],
        ),
      );
    }

    if (active.length < 4) return;

    const present = new Set(
      active.map(({ note }) => pitchClass(note.midiNote)),
    );
    const missing = chordTones.filter((tone) => !present.has(tone));
    if (missing.length > 0) {
      appendMerged(
        diagnostic(
          "chord-completeness",
          "warning",
          slice.tick,
          slice.endTick,
          // 构成音完整性描述的是整个和弦区域，不应把同一条提示重复挂到四个音符上。
          [],
          [],
          "和弦构成音不完整",
          `${chordName} 缺少 ${missing.length} 个标注和弦的构成音。`,
          [chord.id],
        ),
      );
    }

    const bass = active.find((item) => item.voiceId === "bass");
    const expectedBass =
      chordTones[Math.min(chord.analysis.inversion, chordTones.length - 1)];
    if (bass && pitchClass(bass.note.midiNote) !== expectedBass) {
      appendMerged(
        diagnostic(
          "chord-inversion",
          "error",
          slice.tick,
          slice.endTick,
          ["bass"],
          [bass.note],
          "低音与转位不一致",
          `${chordName} 的低音不符合当前转位标记。`,
          [chord.id],
        ),
      );
    }

    const leadingTone = pitchClass(key.tonic + 11);
    const leadingNotes = active.filter(
      ({ note }) => pitchClass(note.midiNote) === leadingTone,
    );
    if (leadingNotes.length > 1) {
      appendMerged(
        diagnostic(
          "leading-tone-doubling",
          "error",
          slice.tick,
          slice.endTick,
          leadingNotes.map((item) => item.voiceId),
          leadingNotes.map((item) => item.note),
          "重复导音",
          "四部和声中通常不应重复调内导音。",
          [chord.id],
        ),
      );
    }
  });

  return diagnostics;
}

function checkChordProgressions(project: ProjectDocument) {
  const diagnostics: HarmonyDiagnostic[] = [];
  const regions = project.chordTrack.regions;
  for (let index = 1; index < regions.length; index += 1) {
    const previous = regions[index - 1];
    const current = regions[index];
    if (previous.startTick + previous.durationTicks !== current.startTick)
      continue;
    const previousKey = keyAtTick(project.keyEvents, previous.startTick);
    const currentKey = keyAtTick(project.keyEvents, current.startTick);
    if (
      previousKey.tonic !== currentKey.tonic ||
      previousKey.mode !== currentKey.mode
    )
      continue;

    // 斯波索宾基础功能序进中，属功能回到下属功能属于典型逆功能进行；先作为教学警告。
    if (
      chordFunction(previous.analysis) === "dominant" &&
      chordFunction(current.analysis) === "subdominant"
    ) {
      diagnostics.push(
        diagnostic(
          "functional-retrogression",
          "warning",
          current.startTick,
          current.startTick,
          [],
          [],
          "逆功能进行",
          `${formatChordRegion(project, previous).roman} 到 ${formatChordRegion(project, current).roman} 形成属功能到下属功能的逆向进行。`,
          [previous.id, current.id],
        ),
      );
    }
    if (
      previous.analysis.appliedToDegree &&
      current.analysis.degree !== previous.analysis.appliedToDegree
    ) {
      diagnostics.push(
        diagnostic(
          "secondary-dominant-resolution",
          "warning",
          current.startTick,
          current.startTick,
          [],
          [],
          "副属和弦未进入目标",
          `${formatChordRegion(project, previous).roman} 通常应进入其指向的 ${previous.analysis.appliedToDegree} 级和弦。`,
          [previous.id, current.id],
        ),
      );
    }
  }
  return diagnostics;
}

export function checkHarmony(
  project: ProjectDocument,
  ruleSeverities: HarmonyRuleSeverities = defaultHarmonyRuleSeverities(),
): HarmonyCheckResult {
  const slices = buildSlices(project);
  const diagnostics = [
    ...checkRanges(project),
    ...checkMelodicMotion(project),
    ...checkVerticalSlices(slices),
    ...checkVoiceLeading(slices),
  ];
  const skippedRuleIds =
    project.chordTrack.regions.length === 0
      ? CHORD_RULE_IDS.filter((ruleId) => ruleSeverities[ruleId] !== "off")
      : [];
  if (project.chordTrack.regions.length > 0) {
    diagnostics.push(...checkChordRules(project, slices));
    diagnostics.push(...checkChordToneResolution(project));
    diagnostics.push(...checkChordProgressions(project));
  }

  // 规则先产生可定位的诊断，最后统一应用用户严重度；“无”不进入结果或跳过统计。
  const configuredDiagnostics = diagnostics.flatMap((item) => {
    const severity = ruleSeverities[item.ruleId];
    return severity === "off" ? [] : [{ ...item, severity }];
  });
  const unique = new Map(configuredDiagnostics.map((item) => [item.id, item]));
  const severityOrder: Record<DiagnosticSeverity, number> = {
    error: 0,
    warning: 1,
    suggestion: 2,
  };
  return {
    diagnostics: [...unique.values()].sort(
      (a, b) =>
        a.tick - b.tick ||
        severityOrder[a.severity] - severityOrder[b.severity],
    ),
    skippedRuleIds,
  };
}
