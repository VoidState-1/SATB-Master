import type {
  AnalysisNote,
  AnalysisSlice,
  HarmonyAnalysis,
} from "../analysis";
import type { HarmonyDiagnostic, RuleDiagnostic, JsonValue, DiagnosticDebugSnapshot, DiagnosticDebugEvent, DiagnosticDebugEventKind, DiagnosticDebugEventRef, DiagnosticDebugObligation, DiagnosticDebugObligationStep, DiagnosticSubjectRefs } from "../runtime";
import type { RuleConfig, RuleExceptionPolicy } from "../rules/types";
import type { VoiceId } from "../../project/types";

type DiagnosticLike = RuleDiagnostic | HarmonyDiagnostic;

interface SnapshotOptions {
  readonly analysis: HarmonyAnalysis;
  readonly diagnostic: DiagnosticLike;
  readonly revision?: number;
  readonly config?: RuleConfig;
  readonly exceptionPolicy?: RuleExceptionPolicy;
  readonly kind?: DiagnosticDebugSnapshot["kind"];
  readonly package?: Record<string, string>;
}

interface ObligationSnapshotOptions extends SnapshotOptions {
  readonly context: {
    readonly sliceIndex: number;
    readonly span?: { readonly id: string };
  };
  readonly ruleId: string;
  readonly obligation: {
    readonly id: string;
    readonly partitionKey: string;
    readonly openedAt: { readonly tick: number; readonly sliceIndex: number };
    readonly openedBy: DiagnosticSubjectRefs;
    readonly payload: JsonValue;
  };
  readonly steps: readonly DiagnosticDebugObligationStep[];
}

function cloneJson(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value)) return value.map((item) => cloneJson(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        cloneJson(item),
      ]),
    );
  }
  return String(value);
}

function cloneRefs(refs: DiagnosticSubjectRefs | undefined): DiagnosticSubjectRefs {
  if (!refs) return {};
  return {
    ...(refs.voiceIds ? { voiceIds: [...refs.voiceIds] } : {}),
    ...(refs.noteIds ? { noteIds: [...refs.noteIds] } : {}),
    ...(refs.chordIds ? { chordIds: [...refs.chordIds] } : {}),
    ...(refs.spanIds ? { spanIds: [...refs.spanIds] } : {}),
  };
}

function mergeRefs(
  primary: DiagnosticSubjectRefs | undefined,
  fallback: DiagnosticSubjectRefs,
): DiagnosticSubjectRefs {
  return {
    voiceIds: [...new Set([...(primary?.voiceIds ?? []), ...(fallback.voiceIds ?? [])])],
    noteIds: [...new Set([...(primary?.noteIds ?? []), ...(fallback.noteIds ?? [])])],
    chordIds: [...new Set([...(primary?.chordIds ?? []), ...(fallback.chordIds ?? [])])],
    spanIds: [...new Set([...(primary?.spanIds ?? []), ...(fallback.spanIds ?? [])])],
  };
}

function addRef(
  target: DiagnosticDebugEventRef[],
  kind: DiagnosticDebugEventRef["kind"],
  id: string,
  role: string,
) {
  if (target.some((item) => item.kind === kind && item.id === id)) return;
  target.push({ kind, id, role });
}

function subjectRefsToEvents(
  refs: DiagnosticSubjectRefs | undefined,
  role: string,
) {
  const result: DiagnosticDebugEventRef[] = [];
  (refs?.noteIds ?? []).forEach((id) => addRef(result, "note", id, role));
  (refs?.chordIds ?? []).forEach((id) => addRef(result, "chord", id, role));
  (refs?.spanIds ?? []).forEach((id) => addRef(result, "span", id, role));
  return result;
}

function diagnosticSummary(diagnostic: DiagnosticLike) {
  const fullDiagnostic = "id" in diagnostic ? diagnostic : undefined;
  const severity = "severity" in diagnostic ? diagnostic.severity : undefined;
  return {
    ...(fullDiagnostic?.id ? { id: fullDiagnostic.id } : {}),
    ruleId: diagnostic.ruleId,
    source: diagnostic.source,
    ...(severity ? { severity } : {}),
    tick: diagnostic.tick,
    endTick: diagnostic.endTick,
    title: diagnostic.title,
    message: diagnostic.message,
    messageKey: diagnostic.messageKey,
    params: cloneJson(diagnostic.params) as Record<string, JsonValue>,
    evidence: diagnostic.evidence.map((entry) => ({ ...entry })),
    confidence: diagnostic.confidence,
    causeRefs: [...(diagnostic.causeRefs ?? [])],
    coverageRefs: [...(diagnostic.coverageRefs ?? [])],
    trace: (diagnostic.trace ?? []).map((entry) => ({ ...entry })),
  } satisfies DiagnosticDebugSnapshot["diagnostic"];
}

function event(
  kind: DiagnosticDebugEvent["kind"],
  id: string,
  data: Record<string, JsonValue>,
  role?: string,
): DiagnosticDebugEvent {
  return { kind, id, ...(role ? { role } : {}), data };
}

function noteData(note: AnalysisNote, voiceId: VoiceId) {
  return {
    voiceId,
    startTick: note.startTick,
    endTick: note.startTick + note.durationTicks,
    durationTicks: note.durationTicks,
    pitch: {
      step: note.pitch.step,
      alter: note.pitch.alter,
      octave: note.pitch.octave,
    },
    ...(note.nonChordToneRole
      ? { nonChordToneRole: note.nonChordToneRole }
      : {}),
  } satisfies Record<string, JsonValue>;
}

function sliceData(
  analysis: HarmonyAnalysis,
  slice: AnalysisSlice,
) {
  const spanId = analysis.sliceSpanIds.get(slice.index);
  const chord = slice.chord;
  return {
    tick: slice.tick,
    endTick: slice.endTick,
    sliceIndex: slice.index,
    attackVoiceIds: [...slice.attackVoiceIds],
    completeSatb: slice.completeSatb,
    key: {
      id: slice.key.id,
      tonic: {
        step: slice.key.tonic.step,
        alter: slice.key.tonic.alter,
      },
      mode: slice.key.mode,
    },
    ...(chord ? { chordId: chord.id } : {}),
    ...(spanId ? { spanId } : {}),
    activeNoteIds: Object.values(slice.notes)
      .filter((note): note is NonNullable<typeof note> => Boolean(note))
      .map((note) => note.id),
  } satisfies Record<string, JsonValue>;
}

function chordData(chord: HarmonyAnalysis["project"]["chordTrack"]["regions"][number]) {
  return {
    startTick: chord.startTick,
    endTick: chord.startTick + chord.durationTicks,
    identity: cloneJson(chord.identity),
    ...(chord.semantics ? { semantics: cloneJson(chord.semantics) } : {}),
  } satisfies Record<string, JsonValue>;
}

function roleFor(
  refs: readonly DiagnosticDebugEventRef[],
  kind: DiagnosticDebugEventKind,
  id: string,
) {
  return refs.find((ref) => ref.kind === kind && ref.id === id)?.role;
}

function selectedSlices(
  analysis: HarmonyAnalysis,
  diagnostic: DiagnosticLike,
  noteIds: ReadonlySet<string>,
) {
  const notes = [...noteIds].flatMap((id) => {
    const note = analysis.noteById.get(id);
    return note ? [note] : [];
  });
  const from = Math.max(
    0,
    Math.min(diagnostic.tick, ...notes.map((note) => note.startTick)) -
      analysis.project.ppq,
  );
  const to =
    Math.max(
      diagnostic.endTick,
      ...notes.map((note) => note.startTick + note.durationTicks),
    ) + analysis.project.ppq;
  return analysis.slices.filter(
    (slice) => slice.endTick > from && slice.tick < to,
  );
}

function collectRelatedEvents(
  analysis: HarmonyAnalysis,
  diagnostic: DiagnosticLike,
  subjects: DiagnosticDebugSnapshot["subjects"],
) {
  const allRefs = [...subjects.origin, ...subjects.failure, ...subjects.context];
  const noteIds = new Set(
    allRefs.filter((ref) => ref.kind === "note").map((ref) => ref.id),
  );
  const chordIds = new Set(
    allRefs.filter((ref) => ref.kind === "chord").map((ref) => ref.id),
  );
  const spanIds = new Set(
    allRefs.filter((ref) => ref.kind === "span").map((ref) => ref.id),
  );

  for (const voiceId of ["soprano", "alto", "tenor", "bass"] as const) {
    const notes = analysis.notesByVoice[voiceId];
    const indices = notes
      .map((note, index) => (noteIds.has(note.id) ? index : -1))
      .filter((index) => index >= 0);
    indices.forEach((index) => {
      [index - 1, index, index + 1].forEach((candidate) => {
        const note = notes[candidate];
        if (note) noteIds.add(note.id);
      });
    });
  }

  const slices = selectedSlices(analysis, diagnostic, noteIds);
  slices.forEach((slice) => {
    if (slice.chord) chordIds.add(slice.chord.id);
    const spanId = analysis.sliceSpanIds.get(slice.index);
    if (spanId) spanIds.add(spanId);
    Object.values(slice.notes).forEach((note) => {
      if (note) noteIds.add(note.id);
    });
  });

  const noteEvents: DiagnosticDebugEvent[] = [];
  for (const voiceId of ["soprano", "alto", "tenor", "bass"] as const) {
    analysis.notesByVoice[voiceId].forEach((note) => {
      if (!noteIds.has(note.id)) return;
      noteEvents.push(
        event(
          "note",
          note.id,
          noteData(note, voiceId),
          roleFor(allRefs, "note", note.id),
        ),
      );
    });
  }

  const chordEvents = [...chordIds].flatMap((id) => {
    const chord = analysis.chordById.get(id);
    return chord
      ? [event("chord", id, chordData(chord), roleFor(allRefs, "chord", id))]
      : [];
  });
  const spanEvents = [...spanIds].flatMap((id) => {
    const span = analysis.harmonySpans.find((candidate) => candidate.id === id);
    return span
      ? [
          event("span", id, {
            fromTick: span.fromTick,
            toTick: span.toTick,
            regionIds: [...span.regionIds],
            sliceIndices: [...span.sliceIndices],
            identityKey: span.identityKey,
            status: span.status,
            ...(span.semantics ? { semantics: cloneJson(span.semantics) } : {}),
          }, roleFor(allRefs, "span", id)),
        ]
      : [];
  });
  const sliceEvents = slices.map((slice) =>
    event("slice", `slice:${slice.index}`, sliceData(analysis, slice)),
  );
  const sliceIndexSet = new Set(slices.map((slice) => slice.index));
  const transitions = [
    ...analysis.melodyTransitions
      .filter(
        (transition) =>
          noteIds.has(transition.previous.id) || noteIds.has(transition.current.id),
      )
      .map((transition) =>
        event("melody-transition", transition.id, {
          voiceId: transition.voiceId,
          previousNoteId: transition.previous.id,
          currentNoteId: transition.current.id,
          contiguous: transition.contiguous,
          sameKey: transition.sameKey,
          sameHarmony: transition.sameHarmony,
          writtenInterval: cloneJson(transition.writtenInterval),
        }),
      ),
    ...analysis.sliceTransitions
      .filter(
        (transition) =>
          sliceIndexSet.has(transition.previousIndex) ||
          sliceIndexSet.has(transition.currentIndex),
      )
      .map((transition) =>
        event("slice-transition", transition.id, {
          previousIndex: transition.previousIndex,
          currentIndex: transition.currentIndex,
          contiguous: transition.contiguous,
          sameKey: transition.sameKey,
          sameHarmony: transition.sameHarmony,
          changedVoiceIds: [...transition.changedVoiceIds],
        }),
      ),
  ];
  const connections = analysis.connections
    .filter(
      (connection) =>
        spanIds.has(connection.previousSpanId) ||
        spanIds.has(connection.currentSpanId),
    )
    .map((connection) =>
      event("connection", connection.connectionKey, {
        connectionKey: connection.connectionKey,
        previousSpanId: connection.previousSpanId,
        currentSpanId: connection.currentSpanId,
        relation: connection.relation,
        contiguous: connection.contiguous,
      }),
    );

  return {
    notes: noteEvents.sort((left, right) => Number(left.data.startTick) - Number(right.data.startTick)),
    chords: chordEvents.sort((left, right) => Number(left.data.startTick) - Number(right.data.startTick)),
    spans: spanEvents.sort((left, right) => Number(left.data.fromTick) - Number(right.data.fromTick)),
    slices: sliceEvents,
    transitions,
    connections,
  } satisfies DiagnosticDebugSnapshot["relatedEvents"];
}

function runtimeInfo(options: SnapshotOptions) {
  const severity = "severity" in options.diagnostic
    ? options.diagnostic.severity
    : undefined;
  return {
    revision: options.revision ?? options.analysis.revision,
    ruleId: options.diagnostic.ruleId,
    source: options.diagnostic.source,
    ...(severity ? { severity } : {}),
    ...(options.config ? { config: cloneJson(options.config) as Record<string, JsonValue> } : {}),
    ...(options.exceptionPolicy
      ? { exceptionPolicy: cloneJson(options.exceptionPolicy) as Record<string, string> }
      : {}),
    ...(options.package ? { package: { ...options.package } } : {}),
  } satisfies DiagnosticDebugSnapshot["runtime"];
}

export function createDiagnosticDebugSnapshot(
  options: SnapshotOptions,
): DiagnosticDebugSnapshot {
  const originNoteIds = new Set(options.diagnostic.subjects?.origin?.noteIds ?? []);
  const fallbackFailureRefs: DiagnosticSubjectRefs = {
    voiceIds: [...options.diagnostic.voiceIds],
    // Stateful diagnostics already identify the source note in `origin`.
    // Do not duplicate it as a failure merely because the generic diagnostic
    // payload contains both source and current notes.
    noteIds: options.diagnostic.noteIds.filter(
      (noteId) => !originNoteIds.has(noteId),
    ),
    chordIds: [...options.diagnostic.chordIds],
  };
  const subjects = {
    origin: subjectRefsToEvents(options.diagnostic.subjects?.origin, "origin"),
    failure: subjectRefsToEvents(
      mergeRefs(options.diagnostic.subjects?.failure, fallbackFailureRefs),
      "failure",
    ),
    context: subjectRefsToEvents(options.diagnostic.subjects?.context, "context"),
  };
  const locationSlice = options.analysis.slices.find(
    (slice) => slice.tick <= options.diagnostic.tick && slice.endTick > options.diagnostic.tick,
  );
  const spanId = locationSlice
    ? options.analysis.sliceSpanIds.get(locationSlice.index)
    : undefined;
  return {
    schemaVersion: "satb-diagnostic-debug/v1",
    kind:
      options.kind ??
      (options.diagnostic.source === "external" ? "external-rule" : "stateless-rule"),
    runtime: runtimeInfo(options),
    diagnostic: diagnosticSummary(options.diagnostic),
    location: {
      tick: options.diagnostic.tick,
      endTick: options.diagnostic.endTick,
      ...(locationSlice ? { sliceIndex: locationSlice.index } : {}),
      ...(spanId ? { spanId } : {}),
    },
    subjects,
    relatedEvents: collectRelatedEvents(options.analysis, options.diagnostic, subjects),
  };
}

export function createObligationDebugSnapshot(
  options: ObligationSnapshotOptions,
): DiagnosticDebugSnapshot {
  const base = createDiagnosticDebugSnapshot({
    ...options,
    kind: "stateful-obligation",
  });
  const obligation: DiagnosticDebugObligation = {
    id: options.obligation.id,
    partitionKey: options.obligation.partitionKey,
    openedAt: { ...options.obligation.openedAt },
    openedBy: cloneRefs(options.obligation.openedBy),
    payload: cloneJson(options.obligation.payload),
    steps: options.steps.map((step) => ({
      ...step,
      ...(step.subjectRefs ? { subjectRefs: cloneRefs(step.subjectRefs) } : {}),
      currentNoteIds: [...step.currentNoteIds],
      attackedVoiceIds: [...step.attackedVoiceIds],
      ...(step.facts ? { facts: cloneJson(step.facts) as Record<string, JsonValue> } : {}),
    })),
  };
  return { ...base, kind: "stateful-obligation", obligation };
}

function fallbackSnapshot(diagnostic: HarmonyDiagnostic): DiagnosticDebugSnapshot {
  return {
    schemaVersion: "satb-diagnostic-debug/v1",
    kind: diagnostic.source === "external" ? "external-rule" : "stateless-rule",
    runtime: {
      revision: 0,
      ruleId: diagnostic.ruleId,
      source: diagnostic.source,
      ...(diagnostic.severity ? { severity: diagnostic.severity } : {}),
    },
    diagnostic: diagnosticSummary(diagnostic),
    location: { tick: diagnostic.tick, endTick: diagnostic.endTick },
    subjects: {
      origin: subjectRefsToEvents(diagnostic.subjects?.origin, "origin"),
      failure: subjectRefsToEvents(diagnostic.subjects?.failure, "failure"),
      context: subjectRefsToEvents(diagnostic.subjects?.context, "context"),
    },
    relatedEvents: {
      notes: [],
      chords: [],
      spans: [],
      slices: [],
      transitions: [],
      connections: [],
    },
    notes: ["当前诊断没有附带分析快照，以下内容仅来自诊断对象。"],
  };
}

export function serializeDiagnosticDebug(diagnostic: HarmonyDiagnostic) {
  return JSON.stringify(diagnostic.debug ?? fallbackSnapshot(diagnostic), null, 2);
}

function refsText(label: string, refs: readonly DiagnosticDebugEventRef[]) {
  if (refs.length === 0) return `${label}: none`;
  return `${label}:\n${refs.map((ref) => `- ${ref.kind} ${ref.id}${ref.role ? ` (${ref.role})` : ""}`).join("\n")}`;
}

export function formatDiagnosticDebugReport(diagnostic: HarmonyDiagnostic) {
  const snapshot = diagnostic.debug ?? fallbackSnapshot(diagnostic);
  const lines = [
    "SATB Master Diagnostic Debug Report",
    `schema: ${snapshot.schemaVersion}`,
    "",
    "[Diagnostic]",
    `rule: ${snapshot.diagnostic.ruleId}`,
    `source: ${snapshot.diagnostic.source}`,
    `severity: ${snapshot.diagnostic.severity ?? "unknown"}`,
    `location: tick=${snapshot.diagnostic.tick}, endTick=${snapshot.diagnostic.endTick}`,
    `title: ${snapshot.diagnostic.title}`,
    `message: ${snapshot.diagnostic.message}`,
    `messageKey: ${snapshot.diagnostic.messageKey}`,
    `causeRefs: ${snapshot.diagnostic.causeRefs.join(", ") || "none"}`,
    "",
    "[Subjects]",
    refsText("origin", snapshot.subjects.origin),
    refsText("failure", snapshot.subjects.failure),
    refsText("context", snapshot.subjects.context),
  ];
  if (snapshot.obligation) {
    lines.push(
      "",
      "[Obligation]",
      `id: ${snapshot.obligation.id}`,
      `partitionKey: ${snapshot.obligation.partitionKey}`,
      `openedAt: tick=${snapshot.obligation.openedAt.tick}, slice=${snapshot.obligation.openedAt.sliceIndex}`,
      `payload: ${JSON.stringify(snapshot.obligation.payload)}`,
      "steps:",
      ...snapshot.obligation.steps.map(
        (step) =>
          `- tick=${step.tick}, slice=${step.sliceIndex}, outcome=${step.outcome}, reason=${step.reason}${step.spanId ? `, span=${step.spanId}` : ""}${step.facts ? `, facts=${JSON.stringify(step.facts)}` : ""}`,
      ),
    );
  }
  lines.push(
    "",
    "[Related Events]",
    `notes: ${snapshot.relatedEvents.notes.length}`,
    `chords: ${snapshot.relatedEvents.chords.length}`,
    `spans: ${snapshot.relatedEvents.spans.length}`,
    `slices: ${snapshot.relatedEvents.slices.length}`,
    `transitions: ${snapshot.relatedEvents.transitions.length}`,
    `connections: ${snapshot.relatedEvents.connections.length}`,
  );
  if (snapshot.notes?.length) lines.push(...snapshot.notes.map((note) => `note: ${note}`));
  lines.push("", "[JSON]", serializeDiagnosticDebug(diagnostic));
  return lines.join("\n");
}
