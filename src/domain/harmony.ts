import {
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
  chordIdentityPitchClasses,
  formatChordRegion,
} from "./chords";
import {
  formatPitchClass,
  pitchClassEquals,
  pitchClassValue,
  toMidi,
} from "./pitch";
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

function sameHarmonyAtTransition(
  project: ProjectDocument,
  previousTick: number,
  currentTick: number,
) {
  const previousChord = chordAtTick(project, previousTick);
  const currentChord = chordAtTick(project, currentTick);
  if (!previousChord || !currentChord) return false;

  const previousKey = keyAtTick(project.keyEvents, previousTick);
  const currentKey = keyAtTick(project.keyEvents, currentTick);
  if (
    !pitchClassEquals(previousKey.tonic, currentKey.tonic) ||
    previousKey.mode !== currentKey.mode
  )
    return false;

  const previous = previousChord.function;
  const current = currentChord.function;
  if (!previous || !current) return false;
  // 同和弦转换允许改变转位；根音拼写、性质、级数和副属目标仍须一致。
  return (
    pitchClassEquals(previousChord.identity.root, currentChord.identity.root) &&
    previousChord.identity.quality === currentChord.identity.quality &&
    previous.degree === current.degree &&
    previous.degreeAlteration === current.degreeAlteration &&
    previous.quality === current.quality &&
    previous.applied?.targetDegree === current.applied?.targetDegree
  );
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
  project.satbTracks.forEach((track) =>
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
    project.satbTracks.forEach((track) => {
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
  project.satbTracks.forEach((track) =>
    track.notes.forEach((note) => {
      const range = VOICE_CONFIG[track.id];
      const midiNote = toMidi(note.pitch);
      if (midiNote < range.min || midiNote > range.max) {
        diagnostics.push(
          diagnostic(
            "voice-range",
            "warning",
            note.startTick,
            note.startTick + note.durationTicks,
            [track.id],
            [note],
            "超出建议音域",
            `${track.name}建议使用 MIDI ${range.min}-${range.max}，当前音高为 ${midiNote}。`,
          ),
        );
      }
    }),
  );
  return diagnostics;
}

function checkMelodicMotion(project: ProjectDocument) {
  const diagnostics: HarmonyDiagnostic[] = [];
  project.satbTracks.forEach((track) => {
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

      const previousMidi = toMidi(previous.pitch);
      const currentMidi = toMidi(current.pitch);
      const interval = Math.abs(currentMidi - previousMidi);
      const sameHarmony = sameHarmonyAtTransition(
        project,
        previous.startTick,
        current.startTick,
      );
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
      } else if (interval > 7 && !sameHarmony) {
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
      } else if (interval === 6 && !sameHarmony) {
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
        pitchClassEquals(previousKey.tonic, currentKey.tonic) &&
        previousKey.mode === currentKey.mode;
      const previousDegree = pitchClass(
        previousMidi - pitchClassValue(previousKey.tonic),
      );
      const contiguous =
        current.startTick === previous.startTick + previous.durationTicks;

      // 只在连续两音处检查，并避开换调边界；小调的导音指升高的第七级（主音下方半音）。
      if (
        sameKeyContext &&
        previousDegree === 11 &&
        contiguous &&
        !sameHarmony
      ) {
        if (
          pitchClass(currentMidi) !== pitchClassValue(previousKey.tonic) ||
          currentMidi <= previousMidi
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
              `${formatPitchClass(previousKey.tonic)} ${previousKey.mode === "major" ? "大调" : "小调"}中的导音通常应上行解决到主音。`,
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

  project.satbTracks.forEach((track) => {
    const notes = [...track.notes].sort((a, b) => a.startTick - b.startTick);
    for (let index = 1; index < notes.length; index += 1) {
      const previous = notes[index - 1];
      const current = notes[index];
      if (current.startTick !== previous.startTick + previous.durationTicks)
        continue;
      if (
        sameHarmonyAtTransition(
          project,
          previous.startTick,
          current.startTick,
        )
      )
        continue;

      const chord = chordAtTick(project, previous.startTick);
      if (!chord) continue;
      const intervals = QUALITY_INTERVALS[chord.identity.quality];
      if (intervals.length !== 4) continue;

      const seventh = pitchClass(
        pitchClassValue(chord.identity.root) + intervals[3],
      );
      if (pitchClass(toMidi(previous.pitch)) !== seventh) continue;

      // 标注七和弦的七音以半音或全音下行解决；跨休止与无和弦标注处不作推断。
      const resolution = toMidi(current.pitch) - toMidi(previous.pitch);
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

      const upperMidi = toMidi(upper.pitch);
      const lowerMidi = toMidi(lower.pitch);
      if (upperMidi < lowerMidi) {
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

      if (pairIndex < 2 && upperMidi - lowerMidi > 12) {
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

function checkVoiceLeading(project: ProjectDocument, slices: Slice[]) {
  const diagnostics: HarmonyDiagnostic[] = [];
  const seen = new Set<string>();

  for (let index = 1; index < slices.length; index += 1) {
    const previous = slices[index - 1];
    const current = slices[index];
    const sameHarmony = sameHarmonyAtTransition(
      project,
      previous.tick,
      current.tick,
    );

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
          toMidi(previousUpper.pitch),
          toMidi(currentUpper.pitch),
        );
        const lowerDirection = direction(
          toMidi(previousLower.pitch),
          toMidi(currentLower.pitch),
        );
        const previousInterval = pitchClass(
          toMidi(previousUpper.pitch) - toMidi(previousLower.pitch),
        );
        const currentInterval = pitchClass(
          toMidi(currentUpper.pitch) - toMidi(currentLower.pitch),
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
          !sameHarmony &&
          similarMotion &&
          (currentInterval === 0 || currentInterval === 7)
        ) {
          if (
            Math.abs(toMidi(currentUpper.pitch) - toMidi(previousUpper.pitch)) >
              2 &&
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
      if (sameHarmony) return;
      const previousUpper = previous.notes[upperId];
      const previousLower = previous.notes[lowerId];
      const currentUpper = current.notes[upperId];
      const currentLower = current.notes[lowerId];
      if (!previousUpper || !previousLower || !currentUpper || !currentLower)
        return;
      if (
        toMidi(currentUpper.pitch) < toMidi(previousLower.pitch) ||
        toMidi(currentLower.pitch) > toMidi(previousUpper.pitch)
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

  slices.forEach((slice, sliceIndex) => {
    const chord = chordAtTick(project, slice.tick);
    if (!chord) return;
    const nextSlice = slices[sliceIndex + 1];
    const isIntermediateSameHarmony = Boolean(
      nextSlice &&
        sameHarmonyAtTransition(project, slice.tick, nextSlice.tick),
    );
    const active = VOICE_ORDER.map((voiceId) => ({
      voiceId,
      note: slice.notes[voiceId],
    })).filter((item): item is { voiceId: VoiceId; note: NoteEvent } =>
      Boolean(item.note),
    );
    const key = keyAtTick(project.keyEvents, slice.tick);
    const chordTones = chordIdentityPitchClasses(chord.identity);
    const chordName = formatChordRegion(project, chord).roman;
    const outside = active.filter(
      ({ note }) =>
        !note.nonChordToneRole &&
        !chordTones.includes(pitchClass(toMidi(note.pitch))),
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
      active.map(({ note }) => pitchClass(toMidi(note.pitch))),
    );
    const missing = chordTones.filter((tone) => !present.has(tone));
    if (missing.length > 0 && !isIntermediateSameHarmony) {
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
    const expectedBass = pitchClassValue(chord.identity.bass);
    if (bass && pitchClass(toMidi(bass.note.pitch)) !== expectedBass) {
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

    const leadingTone = pitchClass(pitchClassValue(key.tonic) + 11);
    const leadingNotes = active.filter(
      ({ note }) => pitchClass(toMidi(note.pitch)) === leadingTone,
    );
    if (leadingNotes.length > 1 && !isIntermediateSameHarmony) {
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
      !pitchClassEquals(previousKey.tonic, currentKey.tonic) ||
      previousKey.mode !== currentKey.mode
    )
      continue;
    // 同和弦的重复、换位或转位属于一次和声延续，功能目标留到离开该和弦时判断。
    if (
      sameHarmonyAtTransition(
        project,
        previous.startTick,
        current.startTick,
      )
    )
      continue;

    // 斯波索宾基础功能序进中，属功能回到下属功能属于典型逆功能进行；先作为教学警告。
    if (
      previous.function &&
      current.function &&
      chordFunction(previous.function) === "dominant" &&
      chordFunction(current.function) === "subdominant"
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
      previous.function?.applied &&
      current.function &&
      current.function.degree !== previous.function.applied.targetDegree
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
          `${formatChordRegion(project, previous).roman} 通常应进入其指向的 ${previous.function.applied.targetDegree} 级和弦。`,
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
    ...checkVoiceLeading(project, slices),
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
