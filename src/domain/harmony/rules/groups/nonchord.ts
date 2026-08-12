import type { AnalysisNote, AnalysisSlice } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import type { NonChordToneRole, VoiceId } from "../../../project/types";
import { pitchClassEquals, toMidi, writtenInterval } from "../../../pitch";
import {
  chordEvidence,
  diagnostic,
  noteEvidence,
  voiceName,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { NoteView } from "../context/views";
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

function isChordTone(
  context: HarmonyRuleContext,
  note: AnalysisNote,
  slice: AnalysisSlice | undefined,
) {
  return context.harmony.isChordTone(note, slice?.chord);
}

function roleNotes(context: HarmonyRuleContext, role: NonChordToneRole) {
  return context
    .notes({ role })
    .select((current) => ({
      current,
      neighborhood: context.noteNeighborhood(current),
    }))
    .where(
      (item): item is {
        current: NoteView;
        neighborhood: NonNullable<typeof item.neighborhood>;
      } => Boolean(item.neighborhood),
    );
}

function suspensionEntry(
  context: HarmonyRuleContext,
  currentNote: NoteView,
) {
  const { voiceId, note } = currentNote;
  const outside = context.slices().first(
    (slice) =>
      slice.notes[voiceId]?.id === note.id &&
      Boolean(slice.chord) &&
      !isChordTone(context, note, slice),
  );
  if (!outside) return undefined;
  const previousSlice = context
    .sliceTransitions({ toSliceIndex: outside.index })
    .last()?.previous;
  const previousAttack = context.noteNeighborhood(currentNote)?.previous?.note;
  const preparedByHeldNote = Boolean(
    previousSlice?.chord &&
    previousSlice.endTick === outside.tick &&
    previousSlice.notes[voiceId]?.id === note.id &&
    isChordTone(context, note, previousSlice),
  );
  const preparedByReattack = Boolean(
    previousSlice?.chord &&
    previousAttack &&
    previousAttack.startTick + previousAttack.durationTicks ===
      note.startTick &&
    toMidi(previousAttack.pitch) === toMidi(note.pitch) &&
    isChordTone(context, previousAttack, previousSlice),
  );
  return {
    current: outside,
    previousSlice,
    previousAttack,
    prepared: preparedByHeldNote || preparedByReattack,
  };
}

function pushRoleDiagnostic(
  diagnostics: RuleDiagnostic[],
  context: HarmonyRuleContext,
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
          noteEvidence(
            note,
            `${voiceName(context.analysis, voiceId)}标注音`,
          ),
          ...related.map((item) => noteEvidence(item, "相邻结构音")),
        ],
      },
    ),
  );
}

export function passingToneRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const { current, neighborhood } of roleNotes(context, "passing")) {
    const { voiceId, note } = current;
    const previous = neighborhood.previous?.note;
    const next = neighborhood.next?.note;
    const previousSlice = previous ? context.sliceAt(previous.startTick) : undefined;
    const currentSlice = neighborhood.attackSlice;
    const nextSlice = next ? context.sliceAt(next.startTick) : undefined;
    if (!previous || !next || !currentSlice.chord) continue;
    const entering = writtenInterval(previous.pitch, note.pitch);
    const leaving = writtenInterval(note.pitch, next.pitch);
    const valid =
      !isChordTone(context, note, currentSlice) &&
      isChordTone(context, previous, previousSlice) &&
      isChordTone(context, next, nextSlice) &&
      context.pitch.isStep(previous, note) &&
      context.pitch.isStep(note, next) &&
      Math.sign(entering.semitones) === Math.sign(leaving.semitones);
    if (!valid)
      pushRoleDiagnostic(
        diagnostics,
        context,
        "nonchord.passing-tone",
        voiceId,
        note,
        "经过音角色不成立",
        "经过音应在两个结构音之间同向级进进入和离开。",
        [previous, next],
        currentSlice,
      );
  }
  return diagnostics;
}

export function neighborToneRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const { current, neighborhood } of roleNotes(context, "neighbor")) {
    const { voiceId, note } = current;
    const previous = neighborhood.previous?.note;
    const next = neighborhood.next?.note;
    const previousSlice = previous ? context.sliceAt(previous.startTick) : undefined;
    const currentSlice = neighborhood.attackSlice;
    const nextSlice = next ? context.sliceAt(next.startTick) : undefined;
    if (!previous || !next || !currentSlice.chord) continue;
    const entering = writtenInterval(previous.pitch, note.pitch);
    const leaving = writtenInterval(note.pitch, next.pitch);
    const valid =
      !isChordTone(context, note, currentSlice) &&
      isChordTone(context, previous, previousSlice) &&
      isChordTone(context, next, nextSlice) &&
      context.pitch.isStep(previous, note) &&
      context.pitch.isStep(note, next) &&
      Math.sign(entering.semitones) === -Math.sign(leaving.semitones) &&
      toMidi(previous.pitch) === toMidi(next.pitch) &&
      pitchClassEquals(previous.pitch, next.pitch);
    if (!valid)
      pushRoleDiagnostic(
        diagnostics,
        context,
        "nonchord.neighbor-tone",
        voiceId,
        note,
        "辅助音角色不成立",
        "辅助音应级进离开结构音，并反向级进回到同一书写音高。",
        [previous, next],
        currentSlice,
      );
  }
  return diagnostics;
}

export function suspensionPreparationRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const { current } of roleNotes(context, "suspension")) {
    const { voiceId, note } = current;
    const entry = suspensionEntry(context, current);
    if (!entry || entry.prepared) continue;
    pushRoleDiagnostic(
      diagnostics,
      context,
      "nonchord.suspension-preparation",
      voiceId,
      note,
      "挂留音准备不正确",
      "挂留音应在前一和弦中作为构成音同高准备，并跨越和声边界保持或重奏。",
      entry.previousAttack ? [entry.previousAttack] : [],
      entry.current,
    );
  }
  return diagnostics;
}

interface SuspensionResolutionPolicy {
  id: "nonchord.suspension-resolution" | "nonchord.retardation";
  role: "suspension" | "retardation";
  direction: 1 | -1;
  title: string;
  message: string;
}

function evaluateSuspensionResolution(
  context: HarmonyRuleContext,
  policy: SuspensionResolutionPolicy,
) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const { current, neighborhood } of roleNotes(context, policy.role)) {
    const { voiceId, note } = current;
    const next = neighborhood.next?.note;
    const nextSlice = next ? context.sliceAt(next.startTick) : undefined;
    const entry = suspensionEntry(context, current);
    if (!entry || !next || !nextSlice?.chord) continue;
    const interval = writtenInterval(note.pitch, next.pitch);
    const valid =
      entry.prepared &&
      context.pitch.isStep(note, next) &&
      Math.sign(interval.semitones) === policy.direction &&
      isChordTone(context, next, nextSlice);
    if (!valid)
      pushRoleDiagnostic(
        diagnostics,
        context,
        policy.id,
        voiceId,
        note,
        policy.title,
        policy.message,
        [next],
        entry.current,
      );
  }
  return diagnostics;
}

export function suspensionResolutionRule(context: HarmonyRuleContext) {
  return evaluateSuspensionResolution(context, {
    id: "nonchord.suspension-resolution",
    role: "suspension",
    direction: -1,
    title: "挂留音未正确解决",
    message: "挂留音应同高准备，并通常下行级进解决到当前和弦音。",
  });
}

export function retardationRule(context: HarmonyRuleContext) {
  return evaluateSuspensionResolution(context, {
    id: "nonchord.retardation",
    role: "retardation",
    direction: 1,
    title: "延宕音角色不成立",
    message: "延宕音应同高准备，并上行级进解决到当前和弦音。",
  });
}

export function appoggiaturaRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const { current, neighborhood } of roleNotes(context, "appoggiatura")) {
      const { voiceId, note } = current;
      const previous = neighborhood.previous?.note;
      const next = neighborhood.next?.note;
      const currentSlice = neighborhood.attackSlice;
      const nextSlice = next ? context.sliceAt(next.startTick) : undefined;
      if (!previous || !next || !currentSlice.chord || !nextSlice?.chord)
        continue;
      const entryInterval = writtenInterval(previous.pitch, note.pitch);
      const valid =
        !isChordTone(context, note, currentSlice) &&
        context.pitch.isStep(note, next) &&
        isChordTone(context, next, nextSlice) &&
        (Math.abs(entryInterval.diatonicSteps) > 1 ||
          Math.abs(entryInterval.semitones) > 2);
      if (!valid)
        pushRoleDiagnostic(
          diagnostics,
          context,
          "nonchord.appoggiatura",
          voiceId,
          note,
          "倚音角色不成立",
          "倚音通常以跳进或无准备方式进入，并级进解决到和弦音。",
          [previous, next],
          currentSlice,
        );
  }
  return diagnostics;
}

export function anticipationRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const { current, neighborhood } of roleNotes(context, "anticipation")) {
      const { voiceId, note } = current;
      const next = neighborhood.next?.note;
      const currentSlice = neighborhood.attackSlice;
      if (!currentSlice.chord) continue;
      const currentSpan = context.spanAt(currentSlice.tick);
      const targetSlice = currentSpan
        ? context.spanNeighborhood(currentSpan).next?.firstSlice
        : undefined;
      if (!targetSlice?.chord) continue;
      const repeatedByNext = Boolean(
        next &&
        note.startTick + note.durationTicks === next.startTick &&
        next.startTick === targetSlice.tick &&
        toMidi(next.pitch) === toMidi(note.pitch),
      );
      const heldIntoTarget =
        note.startTick + note.durationTicks > targetSlice.tick;
      const valid =
        !isChordTone(context, note, currentSlice) &&
        isChordTone(context, note, targetSlice) &&
        (heldIntoTarget || repeatedByNext);
      if (!valid)
        pushRoleDiagnostic(
          diagnostics,
          context,
          "nonchord.anticipation",
          voiceId,
          note,
          "先现音角色不成立",
          "先现音应先于紧邻后继和弦出现，并在该和弦中成为保持或重复的构成音。",
          next ? [next] : [],
          currentSlice,
        );
  }
  return diagnostics;
}

export function pedalPointRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const { current } of roleNotes(context, "pedal")) {
    const { voiceId, note } = current;
    const overlapping = context
      .slices({
        overlapping: {
          fromTick: note.startTick,
          toTick: note.startTick + note.durationTicks,
        },
      })
      .where((slice) => Boolean(slice.chord))
      .toArray();
    const distinctSpans = new Set(
      overlapping
        .map((slice) => context.spanAt(slice.tick)?.span.id)
        .filter(Boolean),
    );
    if (overlapping.length === 0 || distinctSpans.size < 2) continue;
    const first = overlapping[0];
    const last = overlapping.at(-1)!;
    if (
      isChordTone(context, note, first) &&
      isChordTone(context, note, last)
    )
      continue;
    pushRoleDiagnostic(
      diagnostics,
      context,
      "nonchord.pedal-point",
      voiceId,
      note,
      "持续音语境不成立",
      "持续音应从明确和弦归属开始，跨越多个和声后重新获得和弦归属。",
      [],
      first,
    );
  }
  return diagnostics;
}

export const NONCHORD_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "nonchord.passing-tone",
    catalogNumber: "F.1",
    label: "经过音角色不成立",
    description:
      "同一声部前后结构音存在，经过音以级进进入并以同方向级进离开，连接三度范围内的两个结构音；节拍类型按角色子类判断。",
    rationale:
      "半音经过音允许不同 accidental；缺少任一侧上下文时返回上下文不足。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: passingToneRule,
  }),
  defineStatelessRule({
    id: "nonchord.neighbor-tone",
    catalogNumber: "F.2",
    label: "辅助音角色不成立",
    description:
      "要求级进进入、反向级进离开，并回到相同书写音级或确认的等音目标。",
    rationale: "双辅助音和变音辅助音应作为后续子类型，不由首版规则猜测。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: neighborToneRule,
  }),
  defineStatelessRule({
    id: "nonchord.suspension-preparation",
    catalogNumber: "F.3",
    label: "挂留音准备不正确",
    description:
      "同一声部前一结构音必须与当前挂留音同高并跨越和声边界保持或合法重奏，且在准备和弦中属于协和构成。",
    rationale:
      "无准备的不协和音应标为倚音而非挂留音；是否允许重奏需教学 profile 审定。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: suspensionPreparationRule,
  }),
  defineStatelessRule({
    id: "nonchord.suspension-resolution",
    catalogNumber: "F.4",
    label: "挂留音未解决",
    description:
      "挂留状态跨切片传递，要求在截止点前通常下行级进到当前和弦音；`4-3`、`7-6`、`9-8` 等由结构化角色参数给出目标。",
    rationale:
      "转位挂留、装饰性延迟解决和链式挂留由角色配置决定，不能使用固定“下一音”窗口。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: suspensionResolutionRule,
  }),
  defineStatelessRule({
    id: "nonchord.retardation",
    catalogNumber: "F.5",
    label: "延宕音角色不成立",
    description: "与挂留音相同地检查准备和保持，但解决方向为上行级进。",
    rationale: "术语和允许类型需与最终教材用语统一。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: retardationRule,
  }),
  defineStatelessRule({
    id: "nonchord.appoggiatura",
    catalogNumber: "F.6",
    label: "倚音角色不成立",
    description:
      "倚音通常位于相对强位，以跳进或非准备方式进入，并以级进解决到和弦音；方向由角色参数或上下文确定。",
    rationale:
      "教材对自由倚音范围有差异，首版只验证人工标注，不自动判定所有强拍外音。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: appoggiaturaRule,
  }),
  defineStatelessRule({
    id: "nonchord.anticipation",
    catalogNumber: "F.7",
    label: "先现音角色不成立",
    description:
      "当前音在当前和弦中为外音，但在紧邻后继和弦中属于构成音，并由同一声部保持或重复。",
    rationale: "跨休止或跨越无关和弦不能认作先现。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: anticipationRule,
  }),
  defineStatelessRule({
    id: "nonchord.pedal-point",
    catalogNumber: "F.8",
    label: "持续音语境不成立",
    description:
      "持续音应在 span 起点属于和弦构成，期间可成为和弦外音，并在结束处重新获得明确和声归属；上方声部独立形成可分析和声。",
    rationale:
      "主持续音、属持续音和内部持续音可使用不同 profile；持续音期间不以 D.1 重复报警。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: pedalPointRule,
  }),
);
