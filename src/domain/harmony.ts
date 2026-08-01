import { chordIdentityToneSpellings } from "./chordModel";
import { formatChordIdentity } from "./chords";
import {
  analysisChordAtTick,
  analysisKeyAtTick,
  type AnalysisChord,
  type AnalysisNote,
  type HarmonyAnalysis,
  type MelodyTransition,
} from "./harmonyAnalysis";
import {
  RuleScheduler,
  runRulesSynchronously,
  type DiagnosticEvidence,
  type HarmonyCheckResult,
  type HarmonyDiagnostic,
  type RuleDefinition,
  type RuleDiagnostic,
  type RuleEvaluation,
  type RuleConfig,
} from "./harmonyRuntime";
import {
  HARMONY_RULE_DEFINITIONS,
  defaultHarmonyRuleSeverities,
  type DiagnosticSeverity,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
} from "./harmonyRules";
import {
  VOICE_CONFIG,
  VOICE_ORDER,
  type ProjectDocument,
  type VoiceId,
} from "./model";
import {
  formatPitchClass,
  formatSpelledPitch,
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  type SpelledPitchClass,
  type WrittenInterval,
} from "./pitch";

export type {
  DiagnosticEvidence,
  HarmonyCheckResult,
  HarmonyDiagnostic,
  RuleDefinition,
} from "./harmonyRuntime";
export type { DiagnosticSeverity } from "./harmonyRules";

function evaluation(diagnostics: RuleDiagnostic[]): RuleEvaluation {
  return { diagnostics };
}

function diagnostic(
  ruleId: HarmonyRuleId,
  tick: number,
  endTick: number,
  voiceIds: VoiceId[],
  notes: readonly AnalysisNote[],
  title: string,
  message: string,
  options: {
    chordIds?: string[];
    messageKey?: string;
    params?: Record<string, string | number | boolean>;
    evidence?: DiagnosticEvidence[];
    confidence?: number;
  } = {},
): RuleDiagnostic {
  return {
    ruleId,
    source: "builtin",
    tick,
    endTick,
    voiceIds,
    noteIds: notes.map((note) => note.id),
    chordIds: options.chordIds ?? [],
    title,
    message,
    messageKey: options.messageKey ?? ruleId,
    params: options.params ?? {},
    evidence: options.evidence ?? [],
    confidence: options.confidence ?? 1,
  };
}

function pitchClass(value: number) {
  return ((value % 12) + 12) % 12;
}

function direction(from: number, to: number) {
  return Math.sign(to - from);
}

function chordLabel(chord: AnalysisChord) {
  return formatChordIdentity(
    chord.identity as Parameters<typeof formatChordIdentity>[0],
    chord.function as Parameters<typeof formatChordIdentity>[1],
  ).roman;
}

function voiceName(analysis: HarmonyAnalysis, voiceId: VoiceId) {
  return (
    analysis.project.satbTracks.find((track) => track.id === voiceId)?.name ??
    VOICE_CONFIG[voiceId].name
  );
}

function noteEvidence(note: AnalysisNote, label = "音符"): DiagnosticEvidence {
  return {
    kind: "note",
    id: note.id,
    label,
    value: formatSpelledPitch(note.pitch),
  };
}

function chordEvidence(chord: AnalysisChord): DiagnosticEvidence {
  return {
    kind: "chord",
    id: chord.id,
    label: "和弦",
    value: chordLabel(chord),
  };
}

function intervalName(interval: WrittenInterval) {
  const diatonic = Math.abs(interval.diatonicSteps);
  const semitones = Math.abs(interval.semitones);
  const simpleIndex = diatonic % 7;
  const octaveCount = Math.floor(diatonic / 7);
  const number = diatonic + 1;
  const baseSemitones = [0, 2, 4, 5, 7, 9, 11][simpleIndex] + octaveCount * 12;
  const difference = semitones - baseSemitones;
  const perfectClass = [0, 3, 4].includes(simpleIndex);
  const quality = perfectClass
    ? difference === 0
      ? "纯"
      : difference > 0
        ? "增"
        : "减"
    : difference === 0
      ? "大"
      : difference === -1
        ? "小"
        : difference > 0
          ? "增"
          : "减";
  return {
    number,
    quality,
    label: `${quality}${number}度`,
    altered: quality === "增" || quality === "减",
  };
}

function hasExactPitch(
  note: AnalysisNote,
  spellings: readonly SpelledPitchClass[],
) {
  return spellings.some((tone) => pitchClassEquals(note.pitch, tone));
}

function finalSameHarmonySlice(analysis: HarmonyAnalysis, sliceIndex: number) {
  const current = analysis.slices[sliceIndex];
  const next = analysis.slices[sliceIndex + 1];
  return Boolean(
    next &&
    current.chord &&
    next.chord &&
    analysis.sliceTransitions[sliceIndex]?.sameHarmony,
  );
}

function activeNotes(slice: HarmonyAnalysis["slices"][number]) {
  return VOICE_ORDER.map((voiceId) => ({
    voiceId,
    note: slice.notes[voiceId],
  })).filter((item): item is { voiceId: VoiceId; note: AnalysisNote } =>
    Boolean(item.note),
  );
}

function voiceRangeRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  VOICE_ORDER.forEach((voiceId) =>
    analysis.notesByVoice[voiceId].forEach((note) => {
      const range = VOICE_CONFIG[voiceId];
      const midi = toMidi(note.pitch);
      if (midi < range.min || midi > range.max) {
        diagnostics.push(
          diagnostic(
            "voice-range",
            note.startTick,
            note.startTick + note.durationTicks,
            [voiceId],
            [note],
            "超出建议音域",
            `${voiceName(analysis, voiceId)}建议使用 MIDI ${range.min}-${range.max}，当前音高为 ${formatSpelledPitch(note.pitch)}（MIDI ${midi}）。`,
            {
              params: { midi, minimum: range.min, maximum: range.max },
              evidence: [noteEvidence(note)],
            },
          ),
        );
      }
    }),
  );
  return diagnostics;
}

function noteOverlapRule(analysis: HarmonyAnalysis) {
  return analysis.melodyTransitions.flatMap((transition) =>
    transition.current.startTick <
    transition.previous.startTick + transition.previous.durationTicks
      ? [
          diagnostic(
            "voice-note-overlap",
            transition.current.startTick,
            transition.current.startTick + transition.current.durationTicks,
            [transition.voiceId],
            [transition.previous, transition.current],
            "同声部音符重叠",
            `${voiceName(analysis, transition.voiceId)}中存在时间上互相重叠的音符。`,
            {
              evidence: [
                noteEvidence(transition.previous, "前一音"),
                noteEvidence(transition.current, "当前音"),
              ],
            },
          ),
        ]
      : [],
  );
}

function validMelodyTransitions(analysis: HarmonyAnalysis) {
  return analysis.melodyTransitions.filter(
    (transition) =>
      transition.current.startTick >=
      transition.previous.startTick + transition.previous.durationTicks,
  );
}

function melodicLeapRule(
  analysis: HarmonyAnalysis,
  ruleId: "melodic-leap-over-octave" | "melodic-large-leap" | "melodic-tritone",
) {
  const diagnostics: RuleDiagnostic[] = [];
  validMelodyTransitions(analysis).forEach((transition) => {
    const interval = Math.abs(transition.writtenInterval.semitones);
    const matches =
      ruleId === "melodic-leap-over-octave"
        ? interval > 12
        : ruleId === "melodic-large-leap"
          ? interval > 7 && interval <= 12 && !transition.sameHarmony
          : interval === 6 && !transition.sameHarmony;
    if (!matches) return;
    const title =
      ruleId === "melodic-leap-over-octave"
        ? "旋律跳进过大"
        : ruleId === "melodic-large-leap"
          ? "较大旋律跳进"
          : "旋律三全音";
    const message =
      ruleId === "melodic-leap-over-octave"
        ? `${voiceName(analysis, transition.voiceId)}出现超过八度的跳进（${interval} 个半音）。`
        : ruleId === "melodic-large-leap"
          ? `${voiceName(analysis, transition.voiceId)}出现大于纯五度的跳进，需检查前后旋律方向。`
          : `${voiceName(analysis, transition.voiceId)}出现三全音跳进。`;
    diagnostics.push(
      diagnostic(
        ruleId,
        transition.current.startTick,
        transition.current.startTick + transition.current.durationTicks,
        [transition.voiceId],
        [transition.previous, transition.current],
        title,
        message,
        {
          params: { semitones: interval },
          evidence: [
            noteEvidence(transition.previous, "前一音"),
            noteEvidence(transition.current, "当前音"),
            {
              kind: "interval",
              label: "音程",
              value: `${interval} 个半音`,
            },
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function augmentedDiminishedIntervalRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  validMelodyTransitions(analysis).forEach((transition) => {
    if (transition.sameHarmony) return;
    const named = intervalName(transition.writtenInterval);
    if (!named.altered || Math.abs(transition.writtenInterval.semitones) === 0)
      return;
    diagnostics.push(
      diagnostic(
        "augmented-diminished-interval",
        transition.current.startTick,
        transition.current.startTick + transition.current.durationTicks,
        [transition.voiceId],
        [transition.previous, transition.current],
        "旋律出现增减音程",
        `${voiceName(analysis, transition.voiceId)}的 ${formatSpelledPitch(transition.previous.pitch)} 到 ${formatSpelledPitch(transition.current.pitch)} 构成${named.label}。`,
        {
          messageKey: `augmented-diminished-interval.${named.quality}`,
          params: {
            intervalNumber: named.number,
            quality: named.quality,
            semitones: Math.abs(transition.writtenInterval.semitones),
          },
          evidence: [
            noteEvidence(transition.previous, "前一音"),
            noteEvidence(transition.current, "当前音"),
            { kind: "interval", label: "书写音程", value: named.label },
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function leadingToneResolutionRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  validMelodyTransitions(analysis).forEach((transition) => {
    if (!transition.contiguous || !transition.sameKey || transition.sameHarmony)
      return;
    const key = analysisKeyAtTick(analysis, transition.previous.startTick);
    const leadingTone = scaleDegreePitchClass(
      key,
      7,
      key.mode === "minor" ? 1 : 0,
    );
    if (!pitchClassEquals(transition.previous.pitch, leadingTone)) return;
    const resolves =
      pitchClassEquals(transition.current.pitch, key.tonic) &&
      toMidi(transition.current.pitch) - toMidi(transition.previous.pitch) ===
        1;
    if (resolves) return;
    diagnostics.push(
      diagnostic(
        "leading-tone-resolution",
        transition.current.startTick,
        transition.current.startTick + transition.current.durationTicks,
        [transition.voiceId],
        [transition.previous, transition.current],
        "导音未上行解决",
        `${formatPitchClass(key.tonic)} ${key.mode === "major" ? "大调" : "小调"}中的书写导音 ${formatPitchClass(leadingTone)} 通常应上行半音解决到主音。`,
        {
          params: {
            key: `${formatPitchClass(key.tonic)} ${key.mode}`,
            leadingTone: formatPitchClass(leadingTone),
          },
          evidence: [
            noteEvidence(transition.previous, "导音"),
            noteEvidence(transition.current, "后继音"),
            {
              kind: "key",
              id: key.id,
              label: "局部调性",
              value: `${formatPitchClass(key.tonic)} ${key.mode}`,
            },
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function crossRelationRule(analysis: HarmonyAnalysis, config: RuleConfig) {
  const configuredWindow = Number(config.windowTicks ?? analysis.project.ppq);
  const windowTicks = Number.isFinite(configuredWindow)
    ? Math.max(0, Math.min(analysis.project.ppq * 4, configuredWindow))
    : analysis.project.ppq;
  const notes = VOICE_ORDER.flatMap((voiceId) =>
    analysis.notesByVoice[voiceId].map((note) => ({ voiceId, note })),
  ).sort(
    (left, right) =>
      left.note.startTick - right.note.startTick ||
      left.voiceId.localeCompare(right.voiceId),
  );
  const diagnostics: RuleDiagnostic[] = [];

  for (let leftIndex = 0; leftIndex < notes.length; leftIndex += 1) {
    const left = notes[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < notes.length;
      rightIndex += 1
    ) {
      const right = notes[rightIndex];
      if (
        right.note.startTick - (left.note.startTick + left.note.durationTicks) >
        windowTicks
      )
        break;
      if (left.voiceId === right.voiceId) continue;
      if (
        left.note.pitch.step !== right.note.pitch.step ||
        left.note.pitch.alter === right.note.pitch.alter
      )
        continue;
      const leftEnd = left.note.startTick + left.note.durationTicks;
      const rightEnd = right.note.startTick + right.note.durationTicks;
      const overlapStart = Math.max(left.note.startTick, right.note.startTick);
      const overlapEnd = Math.min(leftEnd, rightEnd);
      const simultaneous = overlapStart < overlapEnd;
      const gap = simultaneous ? 0 : right.note.startTick - leftEnd;
      if (!simultaneous && (gap < 0 || gap > windowTicks)) continue;
      const leftKey = analysisKeyAtTick(analysis, left.note.startTick);
      const rightKey = analysisKeyAtTick(analysis, right.note.startTick);
      if (
        leftKey.mode !== rightKey.mode ||
        !pitchClassEquals(leftKey.tonic, rightKey.tonic)
      )
        continue;

      const kind = simultaneous ? "simultaneous" : "successive";
      diagnostics.push(
        diagnostic(
          "cross-relation",
          simultaneous ? overlapStart : right.note.startTick,
          simultaneous ? overlapEnd : rightEnd,
          [left.voiceId, right.voiceId],
          [left.note, right.note],
          simultaneous ? "同时对斜" : "先后对斜",
          `${voiceName(analysis, left.voiceId)}的 ${formatSpelledPitch(left.note.pitch)} 与${voiceName(analysis, right.voiceId)}的 ${formatSpelledPitch(right.note.pitch)} 使用同一字母音名但不同升降号。`,
          {
            messageKey: `cross-relation.${kind}`,
            params: { kind, windowTicks },
            evidence: [
              noteEvidence(left.note, voiceName(analysis, left.voiceId)),
              noteEvidence(right.note, voiceName(analysis, right.voiceId)),
            ],
            confidence: simultaneous ? 1 : 0.9,
          },
        ),
      );
    }
  }
  return diagnostics;
}

function verticalRule(
  analysis: HarmonyAnalysis,
  ruleId: "voice-crossing" | "upper-spacing",
) {
  const diagnostics: RuleDiagnostic[] = [];
  const adjacent: Array<[VoiceId, VoiceId]> = [
    ["soprano", "alto"],
    ["alto", "tenor"],
    ["tenor", "bass"],
  ];
  analysis.slices.forEach((slice) => {
    adjacent.forEach(([upperId, lowerId], index) => {
      const upper = slice.notes[upperId];
      const lower = slice.notes[lowerId];
      if (!upper || !lower) return;
      const distance = toMidi(upper.pitch) - toMidi(lower.pitch);
      const matches =
        ruleId === "voice-crossing" ? distance < 0 : index < 2 && distance > 12;
      if (!matches) return;
      diagnostics.push(
        diagnostic(
          ruleId,
          slice.tick,
          slice.endTick,
          [upperId, lowerId],
          [upper, lower],
          ruleId === "voice-crossing" ? "声部交叉" : "上三声部间距过宽",
          ruleId === "voice-crossing"
            ? "较高声部低于相邻的较低声部。"
            : "S-A 与 A-T 的相邻声部间距通常不应超过八度。",
          {
            params: { semitones: Math.abs(distance) },
            evidence: [
              noteEvidence(upper, voiceName(analysis, upperId)),
              noteEvidence(lower, voiceName(analysis, lowerId)),
              {
                kind: "interval",
                label: "垂直间距",
                value: `${Math.abs(distance)} 个半音`,
              },
            ],
          },
        ),
      );
    });
  });
  return diagnostics;
}

function voiceLeadingRule(
  analysis: HarmonyAnalysis,
  ruleId:
    | "parallel-fifths"
    | "parallel-octaves"
    | "hidden-perfect-interval"
    | "voice-overlap",
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.sliceTransitions.forEach((transition) => {
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
        const previousUpper = transition.previous.notes[upperId];
        const previousLower = transition.previous.notes[lowerId];
        const currentUpper = transition.current.notes[upperId];
        const currentLower = transition.current.notes[lowerId];
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
        let matches = false;
        if (ruleId === "parallel-fifths" || ruleId === "parallel-octaves") {
          const target = ruleId === "parallel-fifths" ? 7 : 0;
          matches =
            similarMotion &&
            previousInterval === target &&
            currentInterval === target;
        } else if (ruleId === "hidden-perfect-interval") {
          matches =
            upperId === "soprano" &&
            lowerId === "bass" &&
            !transition.sameHarmony &&
            similarMotion &&
            (currentInterval === 0 || currentInterval === 7) &&
            previousInterval !== currentInterval &&
            Math.abs(toMidi(currentUpper.pitch) - toMidi(previousUpper.pitch)) >
              2;
        } else {
          const adjacent = lowerIndex === upperIndex + 1;
          matches =
            adjacent &&
            !transition.sameHarmony &&
            (toMidi(currentUpper.pitch) < toMidi(previousLower.pitch) ||
              toMidi(currentLower.pitch) > toMidi(previousUpper.pitch));
        }
        if (!matches) continue;
        const title =
          ruleId === "parallel-fifths"
            ? "平行纯五度"
            : ruleId === "parallel-octaves"
              ? "平行八度或同度"
              : ruleId === "hidden-perfect-interval"
                ? "外声部隐伏完全协和音程"
                : "声部重叠";
        const message =
          ruleId === "parallel-fifths" || ruleId === "parallel-octaves"
            ? "两个声部同向移动，并连续形成相同类型的完全协和音程。"
            : ruleId === "hidden-perfect-interval"
              ? "外声部同向进入纯五度或八度，且高声部发生跳进。"
              : "当前声部进入了相邻声部上一位置所占据的音域。";
        diagnostics.push(
          diagnostic(
            ruleId,
            transition.current.tick,
            transition.current.endTick,
            [upperId, lowerId],
            [previousUpper, previousLower, currentUpper, currentLower],
            title,
            message,
            {
              evidence: [
                noteEvidence(
                  previousUpper,
                  `${voiceName(analysis, upperId)}前一音`,
                ),
                noteEvidence(
                  previousLower,
                  `${voiceName(analysis, lowerId)}前一音`,
                ),
                noteEvidence(
                  currentUpper,
                  `${voiceName(analysis, upperId)}当前音`,
                ),
                noteEvidence(
                  currentLower,
                  `${voiceName(analysis, lowerId)}当前音`,
                ),
              ],
            },
          ),
        );
      }
    }
  });
  return diagnostics;
}

function chordSliceRule(
  analysis: HarmonyAnalysis,
  ruleId:
    | "chord-membership"
    | "chord-completeness"
    | "chord-inversion"
    | "leading-tone-doubling"
    | "chord-seventh-doubling",
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.slices.forEach((slice, sliceIndex) => {
    const chord = slice.chord;
    if (!chord) return;
    const active = activeNotes(slice);
    const tones = chordIdentityToneSpellings(chord.identity);
    const intermediate = finalSameHarmonySlice(analysis, sliceIndex);

    if (ruleId === "chord-membership") {
      const outside = active.filter(
        ({ note }) => !note.nonChordToneRole && !hasExactPitch(note, tones),
      );
      if (outside.length > 0) {
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            outside.map((item) => item.voiceId),
            outside.map((item) => item.note),
            "和弦外音需要确认",
            `标注和弦 ${chordLabel(chord)} 中存在拼写不属于和弦构成音、且未人工标注角色的音符。`,
            {
              chordIds: [chord.id],
              evidence: [
                chordEvidence(chord),
                ...outside.map((item) => noteEvidence(item.note)),
              ],
            },
          ),
        );
      }
      return;
    }

    if (ruleId === "chord-inversion") {
      const bass = active.find((item) => item.voiceId === "bass");
      if (bass && !pitchClassEquals(bass.note.pitch, chord.identity.bass)) {
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            ["bass"],
            [bass.note],
            "低音与转位不一致",
            `${chordLabel(chord)} 要求低音写作 ${formatPitchClass(chord.identity.bass)}，当前为 ${formatPitchClass(bass.note.pitch)}。`,
            {
              chordIds: [chord.id],
              evidence: [
                chordEvidence(chord),
                noteEvidence(bass.note, "男低音"),
              ],
            },
          ),
        );
      }
      return;
    }

    if (!slice.completeSatb || intermediate) return;
    if (ruleId === "chord-completeness") {
      const missing = tones.filter(
        (tone) =>
          !active.some(({ note }) => pitchClassEquals(note.pitch, tone)),
      );
      if (missing.length > 0) {
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            [],
            [],
            "和弦构成音不完整",
            `${chordLabel(chord)} 缺少 ${missing.map(formatPitchClass).join("、")}。`,
            {
              chordIds: [chord.id],
              params: { missing: missing.map(formatPitchClass).join(",") },
              evidence: [
                chordEvidence(chord),
                {
                  kind: "chord",
                  id: chord.id,
                  label: "缺少构成音",
                  value: missing.map(formatPitchClass).join("、"),
                },
              ],
            },
          ),
        );
      }
      return;
    }

    const target =
      ruleId === "leading-tone-doubling"
        ? scaleDegreePitchClass(
            slice.key,
            7,
            slice.key.mode === "minor" ? 1 : 0,
          )
        : tones.length === 4
          ? tones[3]
          : undefined;
    if (!target) return;
    const repeated = active.filter(({ note }) =>
      pitchClassEquals(note.pitch, target),
    );
    if (repeated.length <= 1) return;
    diagnostics.push(
      diagnostic(
        ruleId,
        slice.tick,
        slice.endTick,
        repeated.map((item) => item.voiceId),
        repeated.map((item) => item.note),
        ruleId === "leading-tone-doubling" ? "重复导音" : "重复和弦七音",
        ruleId === "leading-tone-doubling"
          ? `四部和声中通常不应重复局部调性内的书写导音 ${formatPitchClass(target)}。`
          : `${chordLabel(chord)} 的七音 ${formatPitchClass(target)} 不应重复。`,
        {
          chordIds: [chord.id],
          evidence: [
            chordEvidence(chord),
            ...repeated.map((item) => noteEvidence(item.note)),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function chordSeventhResolutionRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  validMelodyTransitions(analysis).forEach((transition) => {
    if (!transition.contiguous || transition.sameHarmony) return;
    const chord = analysisChordAtTick(analysis, transition.previous.startTick);
    if (!chord) return;
    const tones = chordIdentityToneSpellings(chord.identity);
    if (
      tones.length !== 4 ||
      !pitchClassEquals(transition.previous.pitch, tones[3])
    )
      return;
    const resolution =
      toMidi(transition.current.pitch) - toMidi(transition.previous.pitch);
    if (resolution === -1 || resolution === -2) return;
    diagnostics.push(
      diagnostic(
        "chord-seventh-resolution",
        transition.current.startTick,
        transition.current.startTick + transition.current.durationTicks,
        [transition.voiceId],
        [transition.previous, transition.current],
        "七音未级进下行解决",
        `${chordLabel(chord)} 的书写七音 ${formatPitchClass(tones[3])} 通常应以半音或全音级进下行解决。`,
        {
          chordIds: [chord.id],
          evidence: [
            chordEvidence(chord),
            noteEvidence(transition.previous, "和弦七音"),
            noteEvidence(transition.current, "后继音"),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function progressionRule(
  analysis: HarmonyAnalysis,
  ruleId: "functional-retrogression" | "secondary-dominant-resolution",
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.chordProgressions.forEach((progression) => {
    if (
      !progression.contiguous ||
      !progression.sameKey ||
      progression.sameHarmony
    )
      return;
    const previousFunction = progression.previous.function;
    const currentFunction = progression.current.function;
    if (!previousFunction || !currentFunction) return;
    let matches = false;
    if (ruleId === "functional-retrogression") {
      matches =
        progression.previousClass === "dominant" &&
        progression.currentClass === "predominant";
    } else if (ruleId === "secondary-dominant-resolution") {
      matches = Boolean(
        previousFunction.applied &&
        currentFunction.degree !== previousFunction.applied.targetDegree,
      );
    }
    if (!matches) return;
    const title =
      ruleId === "functional-retrogression"
        ? "逆功能进行"
        : "副属和弦未进入目标";
    const message =
      ruleId === "functional-retrogression"
        ? `${chordLabel(progression.previous)} 到 ${chordLabel(progression.current)} 形成属功能到下属功能的逆向进行。`
        : `${chordLabel(progression.previous)} 通常应进入其指向的 ${previousFunction.applied!.targetDegree} 级和弦。`;
    diagnostics.push(
      diagnostic(
        ruleId,
        progression.current.startTick,
        progression.current.startTick,
        [],
        [],
        title,
        message,
        {
          chordIds: [progression.previous.id, progression.current.id],
          evidence: [
            chordEvidence(progression.previous),
            chordEvidence(progression.current),
            {
              kind: "function",
              label: "功能连接",
              value: `${progression.previousClass} → ${progression.currentClass}`,
            },
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function cadential64ResolutionRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  const regions = [...analysis.project.chordTrack.regions].sort(
    (left, right) => left.startTick - right.startTick,
  );
  regions.forEach((previous, index) => {
    if (previous.function?.cadenceRole !== "cadential64") return;
    const current = regions[index + 1];
    const progression = analysis.chordProgressions[index];
    const resolves = Boolean(
      current &&
      progression?.contiguous &&
      progression.sameKey &&
      progression.currentClass === "dominant",
    );
    if (resolves) return;
    diagnostics.push(
      diagnostic(
        "cadential64-resolution",
        Math.min(
          analysis.project.lengthTicks,
          previous.startTick + previous.durationTicks,
        ),
        Math.min(
          analysis.project.lengthTicks,
          previous.startTick + previous.durationTicks,
        ),
        [],
        [],
        "终止四六未进入属和弦",
        `${chordLabel(previous)} 已标记为终止四六，通常应连续进入属功能和弦。`,
        {
          chordIds: current ? [previous.id, current.id] : [previous.id],
          evidence: [
            chordEvidence(previous),
            ...(current ? [chordEvidence(current)] : []),
            {
              kind: "function",
              label: "预期连接",
              value: "终止四六 → 属功能",
            },
          ],
        },
      ),
    );
  });
  return diagnostics;
}

const evaluators: Record<
  HarmonyRuleId,
  (analysis: HarmonyAnalysis, config: RuleConfig) => RuleDiagnostic[]
> = {
  "voice-range": (analysis) => voiceRangeRule(analysis),
  "voice-note-overlap": (analysis) => noteOverlapRule(analysis),
  "voice-crossing": (analysis) => verticalRule(analysis, "voice-crossing"),
  "upper-spacing": (analysis) => verticalRule(analysis, "upper-spacing"),
  "voice-overlap": (analysis) => voiceLeadingRule(analysis, "voice-overlap"),
  "melodic-leap-over-octave": (analysis) =>
    melodicLeapRule(analysis, "melodic-leap-over-octave"),
  "melodic-large-leap": (analysis) =>
    melodicLeapRule(analysis, "melodic-large-leap"),
  "melodic-tritone": (analysis) => melodicLeapRule(analysis, "melodic-tritone"),
  "leading-tone-resolution": (analysis) => leadingToneResolutionRule(analysis),
  "augmented-diminished-interval": (analysis) =>
    augmentedDiminishedIntervalRule(analysis),
  "cross-relation": (analysis, config) => crossRelationRule(analysis, config),
  "parallel-fifths": (analysis) =>
    voiceLeadingRule(analysis, "parallel-fifths"),
  "parallel-octaves": (analysis) =>
    voiceLeadingRule(analysis, "parallel-octaves"),
  "hidden-perfect-interval": (analysis) =>
    voiceLeadingRule(analysis, "hidden-perfect-interval"),
  "chord-membership": (analysis) =>
    chordSliceRule(analysis, "chord-membership"),
  "chord-completeness": (analysis) =>
    chordSliceRule(analysis, "chord-completeness"),
  "chord-inversion": (analysis) => chordSliceRule(analysis, "chord-inversion"),
  "leading-tone-doubling": (analysis) =>
    chordSliceRule(analysis, "leading-tone-doubling"),
  "chord-seventh-resolution": (analysis) =>
    chordSeventhResolutionRule(analysis),
  "chord-seventh-doubling": (analysis) =>
    chordSliceRule(analysis, "chord-seventh-doubling"),
  "functional-retrogression": (analysis) =>
    progressionRule(analysis, "functional-retrogression"),
  "secondary-dominant-resolution": (analysis) =>
    progressionRule(analysis, "secondary-dominant-resolution"),
  "cadential64-resolution": (analysis) => cadential64ResolutionRule(analysis),
};

export const BUILTIN_HARMONY_RULES: readonly RuleDefinition[] =
  HARMONY_RULE_DEFINITIONS.map((definition) => ({
    ...definition,
    evaluate: ({ analysis }, config) =>
      evaluation(evaluators[definition.id](analysis, config)),
  }));

export function createHarmonyRuleScheduler() {
  return new RuleScheduler(BUILTIN_HARMONY_RULES);
}

export function checkHarmony(
  project: ProjectDocument,
  ruleSeverities: HarmonyRuleSeverities = defaultHarmonyRuleSeverities(),
): HarmonyCheckResult {
  return runRulesSynchronously(BUILTIN_HARMONY_RULES, project, ruleSeverities);
}
