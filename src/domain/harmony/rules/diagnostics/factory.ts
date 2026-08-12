import type {
  DiagnosticEvidence,
  DiagnosticSubjects,
  DiagnosticTraceEntry,
  RuleDiagnostic,
} from "../../runtime";
import type { HarmonyAnalysis } from "../../analysis";
import { VOICE_ORDER } from "../../../project/voice";
import { chordEvidence, diagnostic, noteEvidence } from "../helpers/core";
import type { ConnectionView, NoteView, SpanView } from "../context/views";

interface DiagnosticDetails {
  readonly title: string;
  readonly message: string;
  readonly messageKey?: string;
  readonly params?: Record<string, string | number | boolean>;
  readonly evidence?: readonly DiagnosticEvidence[];
  readonly confidence?: number;
  readonly causeRefs?: readonly string[];
  readonly coverageRefs?: readonly string[];
  readonly subjects?: DiagnosticSubjects;
  readonly trace?: readonly DiagnosticTraceEntry[];
}

interface NotesDiagnosticInput extends DiagnosticDetails {
  readonly ruleId: string;
  readonly notes: readonly NoteView[];
  readonly tick?: number;
  readonly endTick?: number;
  readonly chordIds?: readonly string[];
}

interface SpanDiagnosticInput extends DiagnosticDetails {
  readonly ruleId: string;
  readonly span: SpanView;
  readonly failureTick?: number;
  readonly endTick?: number;
}

interface ConnectionDiagnosticInput extends DiagnosticDetails {
  readonly ruleId: string;
  readonly connection: ConnectionView;
  readonly failureTick?: number;
  readonly endTick?: number;
}

export interface DiagnosticFactory {
  forNotes(input: NotesDiagnosticInput): RuleDiagnostic;
  forSpan(input: SpanDiagnosticInput): RuleDiagnostic;
  forConnection(input: ConnectionDiagnosticInput): RuleDiagnostic;
}

function optionsOf(
  input: DiagnosticDetails,
  chordIds: readonly string[],
  evidence: readonly DiagnosticEvidence[],
  subjects: DiagnosticSubjects,
) {
  const mergeRefs = (
    automatic: DiagnosticSubjects[keyof DiagnosticSubjects],
    supplied: DiagnosticSubjects[keyof DiagnosticSubjects],
  ) => {
    if (!automatic && !supplied) return undefined;
    const distinct = <T>(items: readonly T[]) => [...new Set(items)];
    return {
      voiceIds: distinct([
        ...(automatic?.voiceIds ?? []),
        ...(supplied?.voiceIds ?? []),
      ]),
      noteIds: distinct([
        ...(automatic?.noteIds ?? []),
        ...(supplied?.noteIds ?? []),
      ]),
      chordIds: distinct([
        ...(automatic?.chordIds ?? []),
        ...(supplied?.chordIds ?? []),
      ]),
      spanIds: distinct([
        ...(automatic?.spanIds ?? []),
        ...(supplied?.spanIds ?? []),
      ]),
    };
  };
  const mergedSubjects = {
    origin: mergeRefs(subjects.origin, input.subjects?.origin),
    failure: mergeRefs(subjects.failure, input.subjects?.failure),
    context: mergeRefs(subjects.context, input.subjects?.context),
  };
  return {
    chordIds: [...chordIds],
    messageKey: input.messageKey,
    params: input.params ? { ...input.params } : undefined,
    evidence: [...evidence, ...(input.evidence ?? [])],
    confidence: input.confidence,
    causeRefs: input.causeRefs ? [...input.causeRefs] : undefined,
    coverageRefs: input.coverageRefs ? [...input.coverageRefs] : undefined,
    subjects: mergedSubjects,
    trace: input.trace ? [...input.trace] : undefined,
  };
}

function assertStructuredReferences(
  label: string,
  references: readonly string[] | undefined,
) {
  if (!references) return;
  const normalized = references.map((reference) => reference.trim());
  if (
    normalized.some(
      (reference) => reference.length === 0 || reference.length > 240,
    )
  )
    throw new Error(`${label}包含空白或过长引用`);
  if (new Set(normalized).size !== normalized.length)
    throw new Error(`${label}包含重复引用`);
}

function assertDetails(input: DiagnosticDetails & { readonly ruleId: string }) {
  if (
    !input.ruleId.trim() ||
    input.ruleId !== input.ruleId.trim() ||
    input.ruleId.length > 120 ||
    /\s/.test(input.ruleId)
  )
    throw new Error("诊断 ruleId 必须是非空、无空白的稳定标识");
  if (!input.title.trim() || !input.message.trim())
    throw new Error(`规则“${input.ruleId}”的诊断标题与消息不能为空`);
  assertStructuredReferences("causeRefs", input.causeRefs);
  assertStructuredReferences("coverageRefs", input.coverageRefs);
  const causes = new Set(input.causeRefs ?? []);
  if ((input.coverageRefs ?? []).some((reference) => causes.has(reference)))
    throw new Error(`规则“${input.ruleId}”不能用 coverageRefs 覆盖自身根因`);
}

function assertRange(
  analysis: HarmonyAnalysis,
  ruleId: string,
  tick: number,
  endTick: number,
) {
  if (
    !Number.isInteger(tick) ||
    !Number.isInteger(endTick) ||
    tick < 0 ||
    endTick < tick ||
    endTick > analysis.project.lengthTicks
  )
    throw new Error(`规则“${ruleId}”的诊断范围超出当前工程`);
}

function assertSubjects(
  analysis: HarmonyAnalysis,
  ruleId: string,
  subjects: DiagnosticSubjects | undefined,
) {
  const spanIds = new Set(analysis.harmonySpans.map((span) => span.id));
  for (const refs of [
    subjects?.origin,
    subjects?.failure,
    subjects?.context,
  ]) {
    if (!refs) continue;
    if ((refs.voiceIds ?? []).some((id) => !VOICE_ORDER.includes(id)))
      throw new Error(`规则“${ruleId}”引用了不存在的声部`);
    if ((refs.noteIds ?? []).some((id) => !analysis.noteById.has(id)))
      throw new Error(`规则“${ruleId}”引用了当前 revision 中不存在的音符`);
    if ((refs.chordIds ?? []).some((id) => !analysis.chordById.has(id)))
      throw new Error(`规则“${ruleId}”引用了当前 revision 中不存在的和弦`);
    if ((refs.spanIds ?? []).some((id) => !spanIds.has(id)))
      throw new Error(`规则“${ruleId}”引用了当前 revision 中不存在的 span`);
  }
}

export function createDiagnosticFactory(
  analysis: HarmonyAnalysis,
  views: {
    readonly spanViewById: ReadonlyMap<string, SpanView>;
    readonly connectionViewByKey: ReadonlyMap<string, ConnectionView>;
  },
): DiagnosticFactory {
  const factory: DiagnosticFactory = {
    forNotes(input) {
      assertDetails(input);
      const notes = input.notes.map(({ note }) => note);
      if (notes.length === 0)
        throw new Error("音符诊断至少需要一个音符对象");
      if (
        input.notes.some(
          ({ note, voiceId }) =>
            analysis.noteById.get(note.id) !== note ||
            analysis.noteVoiceById.get(note.id) !== voiceId,
        )
      )
        throw new Error(`规则“${input.ruleId}”使用了非当前 revision 的音符视图`);
      if ((input.chordIds ?? []).some((id) => !analysis.chordById.has(id)))
        throw new Error(`规则“${input.ruleId}”引用了不存在的和弦`);
      const voiceIds = [
        ...new Set(input.notes.map(({ voiceId }) => voiceId)),
      ];
      const tick = input.tick ?? Math.min(...notes.map((note) => note.startTick));
      const endTick =
        input.endTick ??
        Math.max(
          ...notes.map((note) => note.startTick + note.durationTicks),
        );
      assertRange(analysis, input.ruleId, tick, endTick);
      assertSubjects(analysis, input.ruleId, input.subjects);
      return diagnostic(
        input.ruleId,
        tick,
        endTick,
        voiceIds,
        notes,
        input.title,
        input.message,
        optionsOf(
          input,
          input.chordIds ?? [],
          notes.map((note) => noteEvidence(note)),
          { origin: { voiceIds, noteIds: notes.map((note) => note.id) } },
        ),
      );
    },
    forSpan(input) {
      assertDetails(input);
      if (views.spanViewById.get(input.span.span.id) !== input.span)
        throw new Error(`规则“${input.ruleId}”使用了非当前 revision 的 span 视图`);
      const tick = input.failureTick ?? input.span.span.fromTick;
      const endTick = input.endTick ?? tick;
      assertRange(analysis, input.ruleId, tick, endTick);
      assertSubjects(analysis, input.ruleId, input.subjects);
      return diagnostic(
        input.ruleId,
        tick,
        endTick,
        [],
        [],
        input.title,
        input.message,
        optionsOf(
          input,
          input.span.chords.map((chord) => chord.id),
          input.span.chords.map(chordEvidence),
          { origin: { spanIds: [input.span.span.id] } },
        ),
      );
    },
    forConnection(input) {
      assertDetails(input);
      if (
        views.connectionViewByKey.get(
          input.connection.connection.connectionKey,
        ) !== input.connection
      )
        throw new Error(
          `规则“${input.ruleId}”使用了非当前 revision 的 connection 视图`,
        );
      const tick = input.failureTick ?? input.connection.target.span.fromTick;
      const endTick = input.endTick ?? tick;
      assertRange(analysis, input.ruleId, tick, endTick);
      assertSubjects(analysis, input.ruleId, input.subjects);
      const chords = [
        ...input.connection.source.chords,
        ...input.connection.target.chords,
      ];
      return diagnostic(
        input.ruleId,
        tick,
        endTick,
        [],
        [],
        input.title,
        input.message,
        optionsOf(
          input,
          chords.map((chord) => chord.id),
          chords.map(chordEvidence),
          {
            origin: { spanIds: [input.connection.source.span.id] },
            failure: { spanIds: [input.connection.target.span.id] },
          },
        ),
      );
    },
  };
  return Object.freeze(factory);
}
