import {
  chordIdentityToneSpellings,
  primaryHarmonyInterpretation,
  type FunctionalFamily,
} from "../../../chordModel";
import type { RuleDiagnostic } from "../../runtime";
import type {
  JsonValue,
  RuleStateEnvelope,
  RuleStepContext,
  RuleStepResult,
} from "../../runtime";
import type { VoiceId } from "../../../project/types";
import {
  formatPitchClass,
  toMidi,
} from "../../../pitch";
import {
  chordEvidence,
  chordLabel,
  diagnostic,
  noteEvidence,
} from "../helpers/core";
import { defineRuleGroup, defineStatefulRule } from "../defineRule";
import { functionalTargetMatches, isCadential64Span } from "../connector";
import {
  all,
  any,
  decisionTable,
  defineObligationRule,
  mergeDiagnosticEvidence,
  not,
  obligationDiagnosticContext,
  otherwiseWhen,
  when,
  type ObligationDecision,
  type ObligationEnvironment,
} from "../declarative";
import {
  sameOpenedHarmonySpan,
  sameWrittenPitchAsSource,
  subjectHasActiveNote,
  subjectVoiceAttacked,
  subjectVoiceEnteredRest,
  targetChordAvailable,
} from "../facts/obligation";
import {
  alteredToneResolves,
  alteredToneSource,
  chordSeventhResolves,
  chordSeventhSource,
  dominantNinthResolves,
  dominantNinthSource,
  leadingTargetUnchanged,
  leadingToneResolves,
  leadingToneSource,
  tendencyContextUnsupported,
  type AlteredTonePayload,
  type DominantNinthPayload,
  type LeadingTonePayload,
  type SeventhPayload,
} from "../facts/tendency";

type SecondaryDominantState = {
  sourceSpanId: string;
  sourceChordId: string;
  sourceToTick: number;
  targetDegree: number;
  targetPrimaryFunction: FunctionalFamily;
  targetSecondaryFunction?: FunctionalFamily;
};

function makeRuleState<T extends JsonValue>(
  ruleId: string,
  context: RuleStepContext,
  id: string,
  payload: T,
  refs: RuleStateEnvelope["subjectRefs"],
): RuleStateEnvelope<T> {
  return {
    id,
    ownerRuleId: ruleId,
    createdAt: { tick: context.slice.tick, sliceIndex: context.sliceIndex },
    subjectRefs: refs,
    payload,
  };
}

function stateStep(
  diagnostics: RuleDiagnostic[],
  outgoing: readonly RuleStateEnvelope[],
): RuleStepResult {
  return { diagnostics, outgoing };
}

function resolutionCauseRef(
  context: RuleStepContext,
  kind: "leading-tone" | "chord-seventh" | "dominant-ninth" | "altered-tone",
  sourceSpanId: string | undefined,
  currentSpanId: string | undefined,
  voiceId: VoiceId,
) {
  const connection = context.analysis.connections.find(
    (candidate) =>
      candidate.previousSpanId === sourceSpanId &&
      candidate.currentSpanId === currentSpanId,
  );
  const connectionKey =
    connection?.connectionKey ??
    `connection:${sourceSpanId ?? "none"}->${currentSpanId ?? "none"}`;
  return `resolution.${kind}|${connectionKey}|voice:${voiceId}`;
}

function openedSourceNote<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  const noteId = environment.obligation.openedBy.noteIds?.[0];
  return noteId ? environment.context.analysis.noteById.get(noteId) : undefined;
}

function openedSourceChord<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  const chordId = environment.obligation.openedBy.chordIds?.[0];
  return chordId ? environment.context.analysis.chordById.get(chordId) : undefined;
}

function openedSpanId<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  return environment.obligation.openedBy.spanIds?.[0];
}

function currentSpanId<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  return environment.context.analysis.sliceSpanIds.get(
    environment.context.sliceIndex,
  );
}

function leadingToneDiagnostic(
  environment: ObligationEnvironment<LeadingTonePayload>,
  decision: ObligationDecision<LeadingTonePayload>,
) {
  const payload = environment.obligation.payload;
  const declarative = obligationDiagnosticContext(environment, decision);
  const source = openedSourceNote(environment);
  const current = environment.context.slice.notes[payload.voiceId];
  if (!source || !current) return undefined;
  const leadingTone = {
    step: payload.leadingStep,
    alter: payload.leadingAlter,
  };
  const targetTonic = {
    step: payload.targetStep,
    alter: payload.targetAlter,
  };
  return diagnostic(
    "resolution.leading-tone",
    current.startTick,
    current.startTick + current.durationTicks,
    [payload.voiceId],
    [source, current],
    "导音未上行解决",
    `书写导音 ${formatPitchClass(leadingTone)} 通常应上行半音解决到主音。`,
    {
      params: {
        key: `${formatPitchClass(environment.context.slice.key.tonic)} ${environment.context.slice.key.mode}`,
        leadingTone: formatPitchClass(leadingTone),
        targetTonic: formatPitchClass(targetTonic),
      },
      evidence: mergeDiagnosticEvidence(
        [
          noteEvidence(source, "导音"),
          noteEvidence(current, "后继音"),
          {
            kind: "key",
            id: environment.context.slice.key.id,
            label: "局部调性",
            value: `${formatPitchClass(environment.context.slice.key.tonic)} ${environment.context.slice.key.mode}`,
          },
        ],
        declarative.evidence,
      ),
      causeRefs: [
        resolutionCauseRef(
          environment.context,
          "leading-tone",
          openedSpanId(environment),
          currentSpanId(environment),
          payload.voiceId,
        ),
      ],
      subjects: declarative.subjects,
      trace: declarative.trace,
    },
  );
}

function seventhDiagnostic(
  environment: ObligationEnvironment<SeventhPayload>,
  decision: ObligationDecision<SeventhPayload>,
) {
  const payload = environment.obligation.payload;
  const declarative = obligationDiagnosticContext(environment, decision);
  const source = openedSourceNote(environment);
  const chord = openedSourceChord(environment);
  const current = environment.context.slice.notes[payload.voiceId];
  const targetChord = environment.context.slice.chord;
  if (!source || !chord || !current || !targetChord) return undefined;
  const tones = chordIdentityToneSpellings(chord.identity);
  const resolution = toMidi(current.pitch) - payload.seventhMidi;
  return diagnostic(
    "resolution.chord-seventh",
    current.startTick,
    current.startTick + current.durationTicks,
    [payload.voiceId],
    [source, current],
    "七音未级进下行解决",
    `书写七音 ${formatPitchClass(tones[3])} 通常应以半音或全音级进下行解决。`,
    {
      chordIds: [chord.id, targetChord.id],
      params: {
        resolutionSemitones: resolution,
        targetChord: chordLabel(targetChord),
      },
      evidence: mergeDiagnosticEvidence(
        [
          chordEvidence(chord),
          noteEvidence(source, "和弦七音"),
          chordEvidence(targetChord),
          noteEvidence(current, "后继音"),
        ],
        declarative.evidence,
      ),
      causeRefs: [
        resolutionCauseRef(
          environment.context,
          "chord-seventh",
          openedSpanId(environment),
          currentSpanId(environment),
          payload.voiceId,
        ),
      ],
      subjects: declarative.subjects,
      trace: declarative.trace,
    },
  );
}

function dominantNinthDiagnostic(
  environment: ObligationEnvironment<DominantNinthPayload>,
  decision: ObligationDecision<DominantNinthPayload>,
) {
  const payload = environment.obligation.payload;
  const declarative = obligationDiagnosticContext(environment, decision);
  const source = openedSourceNote(environment);
  const sourceChord = openedSourceChord(environment);
  const current = environment.context.slice.notes[payload.voiceId];
  const targetChord = environment.context.slice.chord;
  if (!source || !sourceChord || !current || !targetChord) return undefined;
  const sourceTones = chordIdentityToneSpellings(sourceChord.identity);
  const resolution = toMidi(current.pitch) - payload.ninthMidi;
  return diagnostic(
    "resolution.dominant-ninth",
    current.startTick,
    current.startTick + current.durationTicks,
    [payload.voiceId],
    [source, current],
    "属九音未级进下行解决",
    `${chordLabel(sourceChord)} 的九音 ${formatPitchClass(sourceTones[4])} 应在离开属九和弦时级进下行到目标和弦音。`,
    {
      chordIds: [sourceChord.id, targetChord.id],
      params: {
        resolutionSemitones: resolution,
        targetChord: chordLabel(targetChord),
      },
      evidence: mergeDiagnosticEvidence(
        [
          chordEvidence(sourceChord),
          noteEvidence(source, "属九音"),
          chordEvidence(targetChord),
          noteEvidence(current, "后继音"),
        ],
        declarative.evidence,
      ),
      causeRefs: [
        resolutionCauseRef(
          environment.context,
          "dominant-ninth",
          openedSpanId(environment),
          currentSpanId(environment),
          payload.voiceId,
        ),
      ],
      subjects: declarative.subjects,
      trace: declarative.trace,
    },
  );
}

function alteredToneDiagnostic(
  environment: ObligationEnvironment<AlteredTonePayload>,
  decision: ObligationDecision<AlteredTonePayload>,
) {
  const payload = environment.obligation.payload;
  const declarative = obligationDiagnosticContext(environment, decision);
  const source = openedSourceNote(environment);
  const sourceChord = openedSourceChord(environment);
  const current = environment.context.slice.notes[payload.voiceId];
  const targetChord = environment.context.slice.chord;
  if (!source || !sourceChord || !current || !targetChord) return undefined;
  const actualSemitones = toMidi(current.pitch) - payload.alteredMidi;
  return diagnostic(
    "resolution.altered-tone",
    current.startTick,
    current.startTick + current.durationTicks,
    [payload.voiceId],
    [source, current],
    "变化倾向音未按标注方向解决",
    `${chordLabel(sourceChord)} 的变化构成音已标注为${payload.tendency === "up" ? "上行" : "下行"}倾向，应以半音解决到目标和弦音。`,
    {
      chordIds: [sourceChord.id, targetChord.id],
      params: {
        degree: payload.degree,
        tendency: payload.tendency,
        actualSemitones,
      },
      evidence: mergeDiagnosticEvidence(
        [
          chordEvidence(sourceChord),
          noteEvidence(source, "变化倾向音"),
          chordEvidence(targetChord),
          noteEvidence(current, "后继音"),
        ],
        declarative.evidence,
      ),
      causeRefs: [
        resolutionCauseRef(
          environment.context,
          "altered-tone",
          openedSpanId(environment),
          currentSpanId(environment),
          payload.voiceId,
        ),
      ],
      subjects: declarative.subjects,
      trace: declarative.trace,
    },
  );
}

const leadingToneTransition = decisionTable<
  ObligationEnvironment<LeadingTonePayload>
>({
  conflicts: { precedence: ["resolve", "cancel", "continue"] },
  rows: [
    when(
      "resolve",
      "leading-tone-resolved",
      all(subjectVoiceAttacked(), leadingTargetUnchanged(), leadingToneResolves()),
    ),
    when(
      "continue",
      "leading-tone-repeated",
      all(
        any(
          sameOpenedHarmonySpan<LeadingTonePayload>(),
          sameWrittenPitchAsSource(),
        ),
        leadingTargetUnchanged(),
      ),
    ),
    when(
      "cancel",
      "leading-tone-context-ended",
      any(
        subjectVoiceEnteredRest(),
        tendencyContextUnsupported(),
        not(leadingTargetUnchanged()),
      ),
    ),
    otherwiseWhen(
      "violate",
      "leading-tone-moved-elsewhere",
      subjectVoiceAttacked(),
    ),
  ],
});

const seventhSameSpan = sameOpenedHarmonySpan<SeventhPayload>();
const seventhUnsupported = tendencyContextUnsupported<SeventhPayload>();
const seventhTargetChord = targetChordAvailable<SeventhPayload>();
const seventhRest = subjectVoiceEnteredRest<SeventhPayload>();
const seventhTransition = decisionTable<ObligationEnvironment<SeventhPayload>>({
  rows: [
    when(
      "cancel",
      "chord-seventh-context-ended",
      any(seventhRest, seventhUnsupported, not(seventhTargetChord)),
    ),
    when(
      "continue",
      "chord-seventh-same-harmony",
      all(
        seventhSameSpan,
        not(seventhRest),
        not(seventhUnsupported),
        seventhTargetChord,
      ),
    ),
    when(
      "resolve",
      "chord-seventh-resolved",
      all(
        not(seventhSameSpan),
        not(seventhUnsupported),
        seventhTargetChord,
        subjectHasActiveNote(),
        chordSeventhResolves(),
      ),
    ),
    otherwiseWhen(
      "violate",
      "chord-seventh-moved-elsewhere",
      all(
        not(seventhSameSpan),
        not(seventhUnsupported),
        seventhTargetChord,
        subjectHasActiveNote(),
      ),
    ),
  ],
});

const ninthSameSpan = sameOpenedHarmonySpan<DominantNinthPayload>();
const ninthTargetChord = targetChordAvailable<DominantNinthPayload>();
const ninthRest = subjectVoiceEnteredRest<DominantNinthPayload>();
const dominantNinthTransition = decisionTable<
  ObligationEnvironment<DominantNinthPayload>
>({
  rows: [
    when(
      "cancel",
      "dominant-ninth-context-ended",
      any(ninthRest, not(ninthTargetChord)),
    ),
    when(
      "continue",
      "dominant-ninth-same-harmony",
      all(ninthSameSpan, not(ninthRest), ninthTargetChord),
    ),
    when(
      "resolve",
      "dominant-ninth-resolved",
      all(
        not(ninthSameSpan),
        ninthTargetChord,
        subjectHasActiveNote(),
        dominantNinthResolves(),
      ),
    ),
    otherwiseWhen(
      "violate",
      "dominant-ninth-moved-elsewhere",
      all(not(ninthSameSpan), ninthTargetChord, subjectHasActiveNote()),
    ),
  ],
});

const alteredSameSpan = sameOpenedHarmonySpan<AlteredTonePayload>();
const alteredTargetChord = targetChordAvailable<AlteredTonePayload>();
const alteredRest = subjectVoiceEnteredRest<AlteredTonePayload>();
const alteredToneTransition = decisionTable<
  ObligationEnvironment<AlteredTonePayload>
>({
  rows: [
    when(
      "cancel",
      "altered-tone-context-ended",
      any(alteredRest, not(alteredTargetChord)),
    ),
    when(
      "continue",
      "altered-tone-same-harmony",
      all(alteredSameSpan, not(alteredRest), alteredTargetChord),
    ),
    when(
      "resolve",
      "altered-tone-resolved",
      all(
        not(alteredSameSpan),
        alteredTargetChord,
        subjectHasActiveNote(),
        alteredToneResolves(),
      ),
    ),
    otherwiseWhen(
      "violate",
      "altered-tone-moved-elsewhere",
      all(not(alteredSameSpan), alteredTargetChord, subjectHasActiveNote()),
    ),
  ],
});

export function secondaryDominantStateStep(
  context: RuleStepContext,
  incoming: readonly RuleStateEnvelope[],
): RuleStepResult {
  const diagnostics: RuleDiagnostic[] = [];
  const outgoing: RuleStateEnvelope[] = [];
  if (context.isSpanStart && context.span) {
    const currentSpan = context.span;
    incoming.forEach((state) => {
      const payload = state.payload as SecondaryDominantState;
      const connection = context.analysis.connections.find(
        (candidate) => candidate.currentSpanId === currentSpan.id,
      );
      const resolves = functionalTargetMatches(
        context.analysis,
        payload.sourceSpanId,
        currentSpan.id,
        {
          degree: payload.targetDegree as 1 | 2 | 3 | 4 | 5 | 6 | 7,
          primaryFunction: payload.targetPrimaryFunction,
          secondaryFunction: payload.targetSecondaryFunction,
        },
      );
      const allowedCadential64 =
        payload.targetPrimaryFunction === "dominant" &&
        isCadential64Span(currentSpan);
      if (allowedCadential64 && connection?.contiguous && connection.sameKey) {
        outgoing.push(state);
      } else if (!resolves) {
        const previous = context.analysis.chordById.get(payload.sourceChordId);
        const current = currentSpan.regionIds
          .map((id) => context.analysis.chordById.get(id))
          .find(Boolean);
        if (
          previous &&
          current &&
          connection?.contiguous &&
          connection.sameKey &&
          connection.confidence !== "ambiguous" &&
          connection.confidence !== "unknown"
        ) {
          diagnostics.push(
            diagnostic(
              "function.applied-dominant-target",
              current.startTick,
              current.startTick,
              [],
              [],
              "副属和弦未进入目标",
              "副属和弦通常应进入其指向的第 " +
                payload.targetDegree +
                " 级和弦。",
              {
                chordIds: [previous.id, current.id],
                evidence: [chordEvidence(previous), chordEvidence(current)],
                causeRefs: [
                  `function.applied-dominant-target|${connection.connectionKey}`,
                ],
              },
            ),
          );
        }
      }
    });
  } else {
    outgoing.push(...incoming);
  }
  const sourceInterpretation = context.span?.semantics
    ? primaryHarmonyInterpretation(context.span.semantics)
    : undefined;
  if (
    context.isSpanStart &&
    context.span &&
    sourceInterpretation?.appliedTarget
  ) {
    const chord = context.slice.chord;
    if (chord) {
      outgoing.push(
        makeRuleState(
          "function.applied-dominant-target",
          context,
          "secondary-dominant:" + context.span.id,
          {
            sourceSpanId: context.span.id,
            sourceChordId: chord.id,
            sourceToTick: context.span.toTick,
            targetDegree: sourceInterpretation.appliedTarget.degree,
            targetPrimaryFunction:
              sourceInterpretation.appliedTarget.primaryFunction,
            ...(sourceInterpretation.appliedTarget.secondaryFunction
              ? {
                  targetSecondaryFunction:
                    sourceInterpretation.appliedTarget.secondaryFunction,
                }
              : {}),
          } as unknown as JsonValue,
          { chordIds: [chord.id], spanIds: [context.span.id] },
        ),
      );
    }
  }
  return stateStep(diagnostics, outgoing);
}

export const STATEFUL_RULES = defineRuleGroup(
  defineObligationRule({
    id: "resolution.leading-tone",
    catalogNumber: "E.1",
    label: "导音未解决",
    description:
      "导音义务按声部与解决目标分区；同一书写音高在目标不变时可跨和弦实体延续，声部转到其他音时检查是否上行半音到主音。",
    rationale:
      "内声部在特定不完全属和弦连接中的自由进行、阻碍进行及声部交换需专门金样本；休止中断状态。",
    group: "resolution",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "phrase",
    supportedExceptionContexts: [
      "same-harmony",
      "voice-exchange",
      "insufficient-context",
    ],
    source: leadingToneSource,
    retrigger: "retain-existing",
    transition: leadingToneTransition,
    onUnknown: "continue",
    onEnd: "cancel",
    reportViolation: leadingToneDiagnostic,
  }),
  defineObligationRule({
    id: "resolution.chord-seventh",
    catalogNumber: "E.2",
    label: "和弦七音未解决",
    description:
      "七音状态可在同和弦转换内延续；离开 span 后检查同一声部是否下行半音或全音到目标和弦允许音。",
    rationale:
      "同和弦内声部交换不能由另一声部替代解决；特殊延迟解决由专用和弦规则声明。",
    group: "resolution",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    supportedExceptionContexts: ["same-harmony", "insufficient-context"],
    source: chordSeventhSource,
    retrigger: "retain-existing",
    transition: seventhTransition,
    onUnknown: "continue",
    onEnd: "cancel",
    reportViolation: seventhDiagnostic,
  }),
  defineObligationRule({
    id: "resolution.dominant-ninth",
    catalogNumber: "E.3",
    label: "属九音未解决",
    description:
      "识别 `D9` 的九音并跟踪同一声部，在离开属九 span 时要求级进下行到目标和弦允许音。",
    rationale:
      "与通用七音、变化音规则共享证据时使用本条专用诊断；具体转位不在当前产品范围。",
    group: "resolution",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    source: dominantNinthSource,
    retrigger: "retain-existing",
    transition: dominantNinthTransition,
    onUnknown: "continue",
    onEnd: "cancel",
    reportViolation: dominantNinthDiagnostic,
  }),
  defineObligationRule({
    id: "resolution.altered-tone",
    catalogNumber: "E.4",
    label: "变化音方向性解决",
    description:
      "只对和弦模型明确标记为 directional alteration 的构成音建状态；通常升高音向上、降低音向下解决到目标和弦音。",
    rationale:
      "不能从 accidental 字符机械推出方向；增六、导音和特定重属音由更具体规则覆盖。",
    group: "resolution",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    source: alteredToneSource,
    retrigger: "retain-existing",
    transition: alteredToneTransition,
    onUnknown: "continue",
    onEnd: "cancel",
    reportViolation: alteredToneDiagnostic,
  }),
  defineStatefulRule({
    id: "function.applied-dominant-target",
    catalogNumber: "G.2",
    label: "离调属功能未进入目标",
    description:
      "从 interpretation 的 `FunctionalTarget` 建立目标义务，允许同一离调属 span 内转换；离开后首个结构和弦不是目标实体或合法替代时触发。",
    rationale:
      "阻碍式解决、插入 `K46` 或延迟解决必须由目标策略显式允许；没有确认 target 时跳过。",
    group: "function",
    defaultSeverity: "warning",
    requires: ["chords", "semantics"],
    dependencyScope: "phrase",
    process: secondaryDominantStateStep,
  }),
);
