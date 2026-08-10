import { chordIdentityToneSpellings } from "../../../chordModel";
import type {
  AnalysisNote,
  AnalysisSlice,
  HarmonyAnalysis,
} from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import type { NonChordToneRole, VoiceId } from "../../../project/types";
import { pitchClassEquals, toMidi, writtenInterval } from "../../../pitch";
import {
  chordEvidence,
  diagnostic,
  noteEvidence,
  voiceName,
} from "../helpers/core";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

type NonchordRuleId =
  | "nonchord.passing-tone"
  | "nonchord.neighbor-tone"
  | "nonchord.suspension-preparation"
  | "nonchord.suspension-resolution"
  | "nonchord.retardation"
  | "nonchord.appoggiatura"
  | "nonchord.anticipation"
  | "nonchord.pedal-point";

function sliceAtTick(analysis: HarmonyAnalysis, tick: number) {
  return analysis.slices.find(
    (slice) => slice.tick <= tick && tick < slice.endTick,
  );
}

function isChordTone(note: AnalysisNote, slice: AnalysisSlice | undefined) {
  return Boolean(
    slice?.chord &&
      chordIdentityToneSpellings(slice.chord.identity).some((tone) =>
        pitchClassEquals(note.pitch, tone),
      ),
  );
}

function isStep(from: AnalysisNote, to: AnalysisNote) {
  const interval = writtenInterval(from.pitch, to.pitch);
  return (
    Math.abs(interval.diatonicSteps) === 1 &&
    Math.abs(interval.semitones) >= 1 &&
    Math.abs(interval.semitones) <= 2
  );
}

function noteContext(
  analysis: HarmonyAnalysis,
  voiceId: VoiceId,
  note: AnalysisNote,
) {
  const line = analysis.notesByVoice[voiceId];
  const index = line.findIndex((candidate) => candidate.id === note.id);
  const previous = index > 0 ? line[index - 1] : undefined;
  const next = index >= 0 ? line[index + 1] : undefined;
  return {
    previous,
    next,
    previousSlice: previous ? sliceAtTick(analysis, previous.startTick) : undefined,
    currentSlice: sliceAtTick(analysis, note.startTick),
    nextSlice: next ? sliceAtTick(analysis, next.startTick) : undefined,
  };
}

function roleForRule(ruleId: NonchordRuleId): NonChordToneRole {
  if (ruleId === "nonchord.passing-tone") return "passing";
  if (ruleId === "nonchord.neighbor-tone") return "neighbor";
  if (
    ruleId === "nonchord.suspension-preparation" ||
    ruleId === "nonchord.suspension-resolution"
  )
    return "suspension";
  if (ruleId === "nonchord.retardation") return "retardation";
  if (ruleId === "nonchord.appoggiatura") return "appoggiatura";
  if (ruleId === "nonchord.anticipation") return "anticipation";
  return "pedal";
}

function suspensionEntry(
  analysis: HarmonyAnalysis,
  voiceId: VoiceId,
  note: AnalysisNote,
) {
  const outsideIndex = analysis.slices.findIndex(
    (slice) =>
      slice.notes[voiceId]?.id === note.id &&
      slice.chord &&
      !isChordTone(note, slice),
  );
  if (outsideIndex < 0) return undefined;
  const current = analysis.slices[outsideIndex];
  const previousSlice = analysis.slices[outsideIndex - 1];
  const line = analysis.notesByVoice[voiceId];
  const noteIndex = line.findIndex((candidate) => candidate.id === note.id);
  const previousAttack = noteIndex > 0 ? line[noteIndex - 1] : undefined;
  const preparedByHeldNote = Boolean(
    previousSlice?.chord &&
      previousSlice.endTick === current.tick &&
      previousSlice.notes[voiceId]?.id === note.id &&
      isChordTone(note, previousSlice),
  );
  const preparedByReattack = Boolean(
    previousSlice?.chord &&
      previousAttack &&
      previousAttack.startTick + previousAttack.durationTicks === note.startTick &&
      toMidi(previousAttack.pitch) === toMidi(note.pitch) &&
      isChordTone(previousAttack, previousSlice),
  );
  return {
    current,
    previousSlice,
    previousAttack,
    prepared: preparedByHeldNote || preparedByReattack,
  };
}

function pushRoleDiagnostic(
  diagnostics: RuleDiagnostic[],
  analysis: HarmonyAnalysis,
  ruleId: NonchordRuleId,
  voiceId: VoiceId,
  note: AnalysisNote,
  title: string,
  message: string,
  related: readonly AnalysisNote[] = [],
  slice?: AnalysisSlice,
) {
  diagnostics.push(
    diagnostic(
      ruleId,
      note.startTick,
      note.startTick + note.durationTicks,
      [voiceId],
      [note, ...related],
      title,
      message,
      {
        chordIds: slice?.chord ? [slice.chord.id] : [],
        evidence: [
          ...(slice?.chord ? [chordEvidence(slice.chord)] : []),
          noteEvidence(note, `${voiceName(analysis, voiceId)}标注音`),
          ...related.map((item) => noteEvidence(item, "相邻结构音")),
        ],
      },
    ),
  );
}

export function nonchordRoleRule(
  analysis: HarmonyAnalysis,
  ruleId: NonchordRuleId,
) {
  const diagnostics: RuleDiagnostic[] = [];
  const role = roleForRule(ruleId);

  (["soprano", "alto", "tenor", "bass"] as const).forEach((voiceId) => {
      analysis.notesByVoice[voiceId]
        .filter((note) => note.nonChordToneRole === role)
        .forEach((note) => {
          const context = noteContext(analysis, voiceId, note);
          const { previous, next, previousSlice, currentSlice, nextSlice } =
            context;

          if (ruleId === "nonchord.passing-tone") {
            if (!previous || !next || !currentSlice?.chord) return;
            const entering = writtenInterval(previous.pitch, note.pitch);
            const leaving = writtenInterval(note.pitch, next.pitch);
            const valid =
              !isChordTone(note, currentSlice) &&
              isChordTone(previous, previousSlice) &&
              isChordTone(next, nextSlice) &&
              isStep(previous, note) &&
              isStep(note, next) &&
              Math.sign(entering.semitones) === Math.sign(leaving.semitones);
            if (!valid)
              pushRoleDiagnostic(
                diagnostics,
                analysis,
                ruleId,
                voiceId,
                note,
                "经过音角色不成立",
                "经过音应在两个结构音之间同向级进进入和离开。",
                [previous, next],
                currentSlice,
              );
            return;
          }

          if (ruleId === "nonchord.neighbor-tone") {
            if (!previous || !next || !currentSlice?.chord) return;
            const entering = writtenInterval(previous.pitch, note.pitch);
            const leaving = writtenInterval(note.pitch, next.pitch);
            const valid =
              !isChordTone(note, currentSlice) &&
              isChordTone(previous, previousSlice) &&
              isChordTone(next, nextSlice) &&
              isStep(previous, note) &&
              isStep(note, next) &&
              Math.sign(entering.semitones) === -Math.sign(leaving.semitones) &&
              toMidi(previous.pitch) === toMidi(next.pitch) &&
              pitchClassEquals(previous.pitch, next.pitch);
            if (!valid)
              pushRoleDiagnostic(
                diagnostics,
                analysis,
                ruleId,
                voiceId,
                note,
                "辅助音角色不成立",
                "辅助音应级进离开结构音，并反向级进回到同一书写音高。",
                [previous, next],
                currentSlice,
              );
            return;
          }

          if (ruleId === "nonchord.suspension-preparation") {
            const entry = suspensionEntry(analysis, voiceId, note);
            if (!entry || entry.prepared) return;
            pushRoleDiagnostic(
              diagnostics,
              analysis,
              ruleId,
              voiceId,
              note,
              "挂留音准备不正确",
              "挂留音应在前一和弦中作为构成音同高准备，并跨越和声边界保持或重奏。",
              entry.previousAttack ? [entry.previousAttack] : [],
              entry.current,
            );
            return;
          }

          if (
            ruleId === "nonchord.suspension-resolution" ||
            ruleId === "nonchord.retardation"
          ) {
            const entry = suspensionEntry(analysis, voiceId, note);
            if (!entry || !next || !nextSlice?.chord) return;
            const interval = writtenInterval(note.pitch, next.pitch);
            const expectedDirection =
              ruleId === "nonchord.retardation" ? 1 : -1;
            const valid =
              entry.prepared &&
              isStep(note, next) &&
              Math.sign(interval.semitones) === expectedDirection &&
              isChordTone(next, nextSlice);
            if (!valid)
              pushRoleDiagnostic(
                diagnostics,
                analysis,
                ruleId,
                voiceId,
                note,
                ruleId === "nonchord.retardation"
                  ? "延宕音角色不成立"
                  : "挂留音未正确解决",
                ruleId === "nonchord.retardation"
                  ? "延宕音应同高准备，并上行级进解决到当前和弦音。"
                  : "挂留音应同高准备，并通常下行级进解决到当前和弦音。",
                [next],
                entry.current,
              );
            return;
          }

          if (ruleId === "nonchord.appoggiatura") {
            if (!previous || !next || !currentSlice?.chord || !nextSlice?.chord)
              return;
            const entryInterval = writtenInterval(previous.pitch, note.pitch);
            const valid =
              !isChordTone(note, currentSlice) &&
              isStep(note, next) &&
              isChordTone(next, nextSlice) &&
              (Math.abs(entryInterval.diatonicSteps) > 1 ||
                Math.abs(entryInterval.semitones) > 2);
            if (!valid)
              pushRoleDiagnostic(
                diagnostics,
                analysis,
                ruleId,
                voiceId,
                note,
                "倚音角色不成立",
                "倚音通常以跳进或无准备方式进入，并级进解决到和弦音。",
                [previous, next],
                currentSlice,
              );
            return;
          }

          if (ruleId === "nonchord.anticipation") {
            if (!currentSlice?.chord) return;
            const currentSpanId = analysis.sliceSpanIds.get(currentSlice.index);
            const targetSlice = analysis.slices.find(
              (slice) =>
                slice.tick > note.startTick &&
                analysis.sliceSpanIds.get(slice.index) !== currentSpanId &&
                slice.chord,
            );
            if (!targetSlice?.chord) return;
            const repeatedByNext = Boolean(
              next &&
                note.startTick + note.durationTicks === next.startTick &&
                next.startTick === targetSlice.tick &&
                toMidi(next.pitch) === toMidi(note.pitch),
            );
            const heldIntoTarget =
              note.startTick + note.durationTicks > targetSlice.tick;
            const valid =
              !isChordTone(note, currentSlice) &&
              isChordTone(note, targetSlice) &&
              (heldIntoTarget || repeatedByNext);
            if (!valid)
              pushRoleDiagnostic(
                diagnostics,
                analysis,
                ruleId,
                voiceId,
                note,
                "先现音角色不成立",
                "先现音应先于紧邻后继和弦出现，并在该和弦中成为保持或重复的构成音。",
                next ? [next] : [],
                currentSlice,
              );
            return;
          }

          const overlapping = analysis.slices.filter(
            (slice) =>
              slice.chord &&
              slice.tick < note.startTick + note.durationTicks &&
              slice.endTick > note.startTick,
          );
          const distinctSpans = new Set(
            overlapping
              .map((slice) => analysis.sliceSpanIds.get(slice.index))
              .filter(Boolean),
          );
          if (overlapping.length === 0 || distinctSpans.size < 2) return;
          const first = overlapping[0];
          const last = overlapping.at(-1)!;
          const valid =
            isChordTone(note, first) &&
            isChordTone(note, last);
          if (!valid)
            pushRoleDiagnostic(
              diagnostics,
              analysis,
              ruleId,
              voiceId,
              note,
              "持续音语境不成立",
              "持续音应从明确和弦归属开始，跨越多个和声后重新获得和弦归属。",
              [],
              first,
            );
        });
  });
  return diagnostics;
}

export const NONCHORD_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "nonchord.passing-tone",
    catalogNumber: "F.1",
    label: "经过音角色不成立",
    description: "同一声部前后结构音存在，经过音以级进进入并以同方向级进离开，连接三度范围内的两个结构音；节拍类型按角色子类判断。",
    rationale: "半音经过音允许不同 accidental；缺少任一侧上下文时返回上下文不足。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "phrase",
    evaluate: (analysis) =>
    nonchordRoleRule(analysis, "nonchord.passing-tone"),
  }),
  defineStatelessRule({
    id: "nonchord.neighbor-tone",
    catalogNumber: "F.2",
    label: "辅助音角色不成立",
    description: "要求级进进入、反向级进离开，并回到相同书写音级或确认的等音目标。",
    rationale: "双辅助音和变音辅助音应作为后续子类型，不由首版规则猜测。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "phrase",
    evaluate: (analysis) =>
    nonchordRoleRule(analysis, "nonchord.neighbor-tone"),
  }),
  defineStatelessRule({
    id: "nonchord.suspension-preparation",
    catalogNumber: "F.3",
    label: "挂留音准备不正确",
    description: "同一声部前一结构音必须与当前挂留音同高并跨越和声边界保持或合法重奏，且在准备和弦中属于协和构成。",
    rationale: "无准备的不协和音应标为倚音而非挂留音；是否允许重奏需教学 profile 审定。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "phrase",
    evaluate: (analysis) =>
    nonchordRoleRule(analysis, "nonchord.suspension-preparation"),
  }),
  defineStatelessRule({
    id: "nonchord.suspension-resolution",
    catalogNumber: "F.4",
    label: "挂留音未解决",
    description: "挂留状态跨切片传递，要求在截止点前通常下行级进到当前和弦音；`4-3`、`7-6`、`9-8` 等由结构化角色参数给出目标。",
    rationale: "转位挂留、装饰性延迟解决和链式挂留由角色配置决定，不能使用固定“下一音”窗口。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "phrase",
    evaluate: (analysis) =>
    nonchordRoleRule(analysis, "nonchord.suspension-resolution"),
  }),
  defineStatelessRule({
    id: "nonchord.retardation",
    catalogNumber: "F.5",
    label: "延宕音角色不成立",
    description: "与挂留音相同地检查准备和保持，但解决方向为上行级进。",
    rationale: "术语和允许类型需与最终教材用语统一。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "phrase",
    evaluate: (analysis) =>
    nonchordRoleRule(analysis, "nonchord.retardation"),
  }),
  defineStatelessRule({
    id: "nonchord.appoggiatura",
    catalogNumber: "F.6",
    label: "倚音角色不成立",
    description: "倚音通常位于相对强位，以跳进或非准备方式进入，并以级进解决到和弦音；方向由角色参数或上下文确定。",
    rationale: "教材对自由倚音范围有差异，首版只验证人工标注，不自动判定所有强拍外音。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "phrase",
    evaluate: (analysis) =>
    nonchordRoleRule(analysis, "nonchord.appoggiatura"),
  }),
  defineStatelessRule({
    id: "nonchord.anticipation",
    catalogNumber: "F.7",
    label: "先现音角色不成立",
    description: "当前音在当前和弦中为外音，但在紧邻后继和弦中属于构成音，并由同一声部保持或重复。",
    rationale: "跨休止或跨越无关和弦不能认作先现。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "phrase",
    evaluate: (analysis) =>
    nonchordRoleRule(analysis, "nonchord.anticipation"),
  }),
  defineStatelessRule({
    id: "nonchord.pedal-point",
    catalogNumber: "F.8",
    label: "持续音语境不成立",
    description: "持续音应在 span 起点属于和弦构成，期间可成为和弦外音，并在结束处重新获得明确和声归属；上方声部独立形成可分析和声。",
    rationale: "主持续音、属持续音和内部持续音可使用不同 profile；持续音期间不以 D.1 重复报警。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "phrase",
    evaluate: (analysis) =>
    nonchordRoleRule(analysis, "nonchord.pedal-point"),
  }),
);
