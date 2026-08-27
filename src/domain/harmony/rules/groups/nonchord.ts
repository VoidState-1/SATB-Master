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
  return context.harmony.isWrittenChordTone(note, slice?.chord);
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
      "检查经过音是否在两个和弦音之间以同方向级进平滑连结。",
    rationale:
      "经过音（Passing Tone）是填补两个不同和弦音（通常相距三度或四度）之间音程空隙的非和弦音。其基本特征为：从前一和弦音级进进入，并沿相同方向继续级进进入后一和弦音。",
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
      "检查辅助音是否由和弦音级进离开并立即反向级进折回原和弦音。",
    rationale:
      "辅助音（Neighbor Tone）用于装饰单一和弦音。其基本规范为：从和弦音上行或下行级进离开，随后立即沿相反方向级进折回最初的同一音高，形成波浪式的装饰线条。",
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
      "检查挂留音在前一和弦中是否作为协和的和弦音得到了充分准备。",
    rationale:
      "古典挂留音包含“准备—挂留—解决”三步法。挂留音必须在前一和弦的弱拍或强拍上作为协和音先发声（准备），然后在和弦变换时延留到强拍形成不协和（挂留），方能产生规范的悬念感与和声张力。",
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
      "检查挂留音是否在后继弱拍位置顺利下行级进解决到当前和弦音。",
    rationale:
      "挂留音在强拍形成不协和阻碍后，由于重力与调式倾向，必须在同一声部内向下一级（下行二度级进）解决到当前和弦的协和音（如 4-3、7-6、9-8 解决），释放和声紧张度。",
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
    description:
      "检查延宕音（上行挂留音）是否在上行级进中得到了规范的准备与解决。",
    rationale:
      "延宕音（Retardation）是上行解决的挂留音形态，常见于导音向主音解决的延留（如 7-8 延宕）。同样需要前和弦的协和准备，并在强拍挂留后向上级进解决到主音。",
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
      "检查强拍倚音是否以跳进进入并随后以级进解决到和弦音。",
    rationale:
      "倚音（Appoggiatura）是位于强拍或强位置、未经前和弦音准备直接跳进（或级进）进入的不协和音。具有极强的情感表现力，要求出现后立即反向级进解决到协和的和弦音。",
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
      "检查先现音是否在弱拍提前进入并在后继强拍作为和弦音保持。",
    rationale:
      "先现音（Anticipation）是指后一个和弦的构成音在当前和弦的弱拍末尾提前起奏。它在当前和弦中属于外音，但在紧接着的和弦中转化为正式和弦音，常见于乐句终止处的旋律主音先现。",
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
      "检查持续音（低音或内音）是否由协和音开始、贯穿和声变化并在协和音上结束。",
    rationale:
      "持续音（Pedal Point）是在一个声部（通常在男低音）长时间保持同一音高，而上方其他声部不断进行和声变换的写作技法。持续音必须始于包含该音的协和和弦，结束于以该音为构成音的协和和弦，上方声部必须独立构成清晰合理的和声逻辑。",
    group: "nonchord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: pedalPointRule,
  }),
);
