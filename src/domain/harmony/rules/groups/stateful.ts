import {
  chordIdentityToneSpellings,
  identityContainsWrittenPitchClass,
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
import { sameChordIdentityWithoutBass } from "../../analysis";
import { formatPitchClass, pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval, type SpelledPitchClass } from "../../../pitch";
import {
  chordEvidence,
  chordLabel,
  diagnostic,
  noteEvidence,
} from "../helpers/core";
import { defineRuleGroup, defineStatefulRule } from "../defineRule";
import { functionalTargetMatches, isCadential64Span } from "../connector";
import { isProvenLocalDeceptiveTarget } from "./localDeceptiveAppliedTarget";
import {
  defineObligationRule,
  mergeDiagnosticEvidence,
  obligationDiagnosticContext,
  type ObligationDecision,
  type ObligationEnvironment,
} from "../state/obligation";
import {
  alteredToneResolves,
  alteredToneSource,
  chordSeventhResolves,
  chordSeventhSource,
  dominantNinthResolves,
  dominantNinthSource,
  innerLeadingToneDescendsToFifth,
  leadingTargetUnchanged,
  leadingToneResolves,
  leadingToneSource,
  supportsTendencyResolutionRules,
  transitionEvidence,
  type AlteredTonePayload,
  type DominantNinthPayload,
  type LeadingTonePayload,
  type SeventhPayload,
  type VoiceObligationPayload,
} from "../state/tendency";

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
  const connection =
    sourceSpanId && currentSpanId
      ? context.rules
          .connections({
            sourceSpanId,
            targetSpanId: currentSpanId,
          })
          .first()?.connection
      : undefined;
  const connectionKey =
    connection?.connectionKey ??
    `connection:${sourceSpanId ?? "none"}->${currentSpanId ?? "none"}`;
  return `resolution.${kind}|${connectionKey}|voice:${voiceId}`;
}

function openedSourceNote<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  const noteId = environment.obligation.openedBy.noteIds?.[0];
  return noteId
    ? environment.context.rules
        .notes()
        .first(({ note }) => note.id === noteId)?.note
    : undefined;
}

function openedSourceChord<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  const chordId = environment.obligation.openedBy.chordIds?.[0];
  if (chordId) {
    const chord = environment.context.rules
      .spans()
      .selectMany(({ chords }) => chords)
      .first((candidate) => candidate.id === chordId);
    if (chord) return chord;
  }
  const spanId = openedSpanId(environment);
  return spanId
    ? environment.context.rules
        .spans({ id: spanId })
        .selectMany(({ chords }) => chords)
        .first()
    : undefined;
}

function openedSpanId<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  return environment.obligation.openedBy.spanIds?.[0];
}

function currentSpanId<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  return environment.context.rules.spanAt(environment.moment.tick)?.span.id;
}

function leadingToneDiagnostic(
  environment: ObligationEnvironment<LeadingTonePayload>,
  decision: ObligationDecision,
) {
  const payload = environment.obligation.payload;
  const obligationContext = obligationDiagnosticContext(environment, decision);
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
  const targetKeyName = `${formatPitchClass(targetTonic)} ${payload.targetMode}`;
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
        key: targetKeyName,
        leadingTone: formatPitchClass(leadingTone),
        targetTonic: formatPitchClass(targetTonic),
      },
      evidence: mergeDiagnosticEvidence(
        [
          noteEvidence(source, "导音"),
          noteEvidence(current, "后继音"),
          {
            kind: "key",
            id: openedSourceChord(environment)?.id ?? environment.context.slice.key.id,
            label: "局部调性",
            value: targetKeyName,
          },
        ],
        obligationContext.evidence,
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
      subjects: obligationContext.subjects,
      trace: obligationContext.trace,
    },
  );
}

function seventhDiagnostic(
  environment: ObligationEnvironment<SeventhPayload>,
  decision: ObligationDecision,
) {
  const payload = environment.obligation.payload;
  const obligationContext = obligationDiagnosticContext(environment, decision);
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
    decision.reason === "chord-seventh-bass-rises-to-root" ? "属七和弦换位时低音七音上行" : "七音未级进下行解决",
    decision.reason === "chord-seventh-bass-rises-to-root"
      ? "属二和弦换为同一属七和弦原位时，低音七音不可级进上行到根音。"
      : `书写七音 ${formatPitchClass(tones[3])} 通常应以半音或全音级进下行解决。`,
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
        obligationContext.evidence,
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
      subjects: obligationContext.subjects,
      trace: obligationContext.trace,
    },
  );
}

function dominantNinthDiagnostic(
  environment: ObligationEnvironment<DominantNinthPayload>,
  decision: ObligationDecision,
) {
  const payload = environment.obligation.payload;
  const obligationContext = obligationDiagnosticContext(environment, decision);
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
        obligationContext.evidence,
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
      subjects: obligationContext.subjects,
      trace: obligationContext.trace,
    },
  );
}

function alteredToneDiagnostic(
  environment: ObligationEnvironment<AlteredTonePayload>,
  decision: ObligationDecision,
) {
  const payload = environment.obligation.payload;
  const obligationContext = obligationDiagnosticContext(environment, decision);
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
        obligationContext.evidence,
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
      subjects: obligationContext.subjects,
      trace: obligationContext.trace,
    },
  );
}

function sameOpenedSpan<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  const sourceSpanId = openedSpanId(environment);
  return Boolean(sourceSpanId && sourceSpanId === currentSpanId(environment));
}

/**
 * 判断导音义务是否仍处于同一功能性和声上下文。
 *
 * HarmonySpan 会因为完整语义对象（尤其是转位推导出的 interpretation id）
 * 变化而切分，但导音在同一调性、同一和弦实体和同一功能目标内仍可跨声部交接。
 * 这个判断只供导音义务使用，不能替代全局 HarmonySpan 的严格边界。
 */
function sameLeadingToneContext(
  environment: ObligationEnvironment<LeadingTonePayload>,
) {
  if (
    !leadingTargetUnchanged(environment) ||
    !environment.context.transitionFromPrevious?.contiguous
  )
    return false;

  const sourceChord = openedSourceChord(environment);
  const currentChord = environment.context.slice.chord;
  if (!sourceChord || !currentChord) return false;

  const exactSame = sameChordIdentityWithoutBass(
    sourceChord.identity,
    currentChord.identity,
  );
  const payload = environment.obligation.payload;
  const sameFamily =
    pitchClassEquals(sourceChord.identity.root, currentChord.identity.root) &&
    identityContainsWrittenPitchClass(currentChord.identity, {
      step: payload.leadingStep,
      alter: payload.leadingAlter,
    });

  if (!exactSame && !sameFamily) return false;

  const interpretationContext = (chord: typeof sourceChord) => {
    if (!chord.semantics) return undefined;
    const resolution = environment.context.rules.harmony.primaryInterpretation(
      chord,
    );
    if (resolution.status !== "resolved") return undefined;
    const interpretation = resolution.value;
    return JSON.stringify({
      localKey: interpretation.localKey ?? null,
      degree: interpretation.degree,
      degreeAlteration: interpretation.degreeAlteration,
      appliedTarget: interpretation.appliedTarget ?? null,
      designation: interpretation.designation ?? null,
      mixture: chord.semantics.mixture ?? null,
      cadenceRole: chord.semantics.cadenceRole ?? null,
      pedalContext: chord.semantics.pedalContext ?? null,
    });
  };

  const sourceContext = interpretationContext(sourceChord);
  const currentContext = interpretationContext(currentChord);
  if (sourceChord.semantics || currentChord.semantics)
    return Boolean(
      sourceContext && currentContext && sourceContext === currentContext,
    );
  return true;
}

function subjectAttacked<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  return environment.moment.attackedVoiceIds.includes(
    environment.obligation.payload.voiceId,
  );
}

function subjectEnteredRest<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  return environment.moment.enteredRestVoiceIds.includes(
    environment.obligation.payload.voiceId,
  );
}

function subjectHasActiveNote<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  return Boolean(
    environment.context.slice.notes[environment.obligation.payload.voiceId],
  );
}

function targetChordAvailable<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  return Boolean(environment.context.slice.chord);
}

function sameWrittenPitchAsSource<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  const source = openedSourceNote(environment);
  const current =
    environment.context.slice.notes[environment.obligation.payload.voiceId];
  return Boolean(
    source &&
      current &&
      source.pitch.step === current.pitch.step &&
      source.pitch.alter === current.pitch.alter &&
      source.pitch.octave === current.pitch.octave,
  );
}

/**
 * 同一 HarmonySpan 内，导音可以从一个声部交接到另一个声部。
 * 只有原义务声部已经离开导音，且另一声部在当前边界重新起奏导音时，
 * 才取消旧义务；原声部仍保持导音时属于重复导音，不能误当作交接。
 */
function leadingToneTransferred(
  environment: ObligationEnvironment<LeadingTonePayload>,
) {
  return leadingToneTransferVoiceIds(environment).length > 0;
}

function leadingToneTransferVoiceIds(
  environment: ObligationEnvironment<LeadingTonePayload>,
) {
  const payload = environment.obligation.payload;
  const currentSource = environment.context.slice.notes[payload.voiceId];
  const sourceStillLeading = Boolean(
    currentSource &&
      currentSource.pitch.step === payload.leadingStep &&
      currentSource.pitch.alter === payload.leadingAlter,
    );
  if (sourceStillLeading) return [];

  return environment.moment.attackedVoiceIds.filter((voiceId) => {
    if (voiceId === payload.voiceId) return false;
    const note = environment.context.slice.notes[voiceId];
    return Boolean(
      note &&
        note.pitch.step === payload.leadingStep &&
        note.pitch.alter === payload.leadingAlter,
    );
  });
}

function decision<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
  outcome: ObligationDecision["outcome"],
  reason: string,
  debugFacts?: Record<string, JsonValue>,
): ObligationDecision {
  const details = transitionEvidence(environment);
  return {
    outcome,
    reason,
    evidence: details.evidence,
    subjectRefs: details.subjectRefs,
    ...(debugFacts ? { debugFacts } : {}),
  };
}

function leadingToneTransition(
  environment: ObligationEnvironment<LeadingTonePayload>,
): ObligationDecision | undefined {
  const targetUnchanged = leadingTargetUnchanged(environment);
  const attacked = subjectAttacked(environment);
  const transferVoiceIds = leadingToneTransferVoiceIds(environment);
  const sameLeadingContext = sameLeadingToneContext(environment);
  const currentNote = environment.context.slice.notes[
    environment.obligation.payload.voiceId
  ];
  const debugFacts = {
    sameOpenedSpan: sameOpenedSpan(environment),
    sameLeadingToneContext: sameLeadingContext,
    targetUnchanged,
    attacked,
    sourceStillLeading:
      currentNote?.pitch.step === environment.obligation.payload.leadingStep &&
      currentNote?.pitch.alter === environment.obligation.payload.leadingAlter,
    transferredVoiceIds: transferVoiceIds,
    ...(currentNote ? { currentNoteId: currentNote.id } : {}),
    ...(currentSpanId(environment)
      ? { currentSpanId: currentSpanId(environment) }
      : {}),
  } satisfies Record<string, JsonValue>;

  if (attacked && targetUnchanged && leadingToneResolves(environment))
    return decision(
      environment,
      "resolve",
      "leading-tone-resolved",
      debugFacts,
    );

  if (attacked && targetUnchanged && innerLeadingToneDescendsToFifth(environment))
    return decision(environment, "resolve", "inner-leading-tone-descends-to-fifth", debugFacts);

  if (
    targetUnchanged &&
    sameLeadingContext &&
    leadingToneTransferred(environment)
  )
    return decision(
      environment,
      "cancel",
      "leading-tone-transferred",
      debugFacts,
    );

  if (
    targetUnchanged &&
    (sameOpenedSpan(environment) || sameWrittenPitchAsSource(environment))
  )
    return decision(
      environment,
      "continue",
      "leading-tone-repeated",
      debugFacts,
    );

  if (
    subjectEnteredRest(environment) ||
    !supportsTendencyResolutionRules(
      environment.context,
      environment.context.slice.chord,
    ) ||
    !targetUnchanged
  )
    return decision(
      environment,
      "cancel",
      "leading-tone-context-ended",
      debugFacts,
    );

  if (attacked)
    return decision(
      environment,
      "violate",
      "leading-tone-moved-elsewhere",
      debugFacts,
    );

  return undefined;
}

function sameSeventhContext(
  environment: ObligationEnvironment<SeventhPayload>,
) {
  if (!environment.context.transitionFromPrevious?.contiguous) return false;

  const sourceChord = openedSourceChord(environment);
  const currentChord = environment.context.slice.chord;
  if (!sourceChord || !currentChord) return false;

  if (!pitchClassEquals(sourceChord.identity.root, currentChord.identity.root))
    return false;

  const sourceTones = chordIdentityToneSpellings(sourceChord.identity);
  const currentTones = chordIdentityToneSpellings(currentChord.identity);
  if (sourceTones.length < 4 || currentTones.length < 4) return false;
  if (!pitchClassEquals(sourceTones[3], currentTones[3])) return false;

  const interpretationContext = (chord: typeof sourceChord) => {
    if (!chord.semantics) return undefined;
    const resolution = environment.context.rules.harmony.primaryInterpretation(
      chord,
    );
    if (resolution.status !== "resolved") return undefined;
    const interpretation = resolution.value;
    return JSON.stringify({
      localKey: interpretation.localKey ?? null,
      degree: interpretation.degree,
      degreeAlteration: interpretation.degreeAlteration,
      appliedTarget: interpretation.appliedTarget ?? null,
      designation: interpretation.designation ?? null,
      mixture: chord.semantics.mixture ?? null,
      cadenceRole: chord.semantics.cadenceRole ?? null,
      pedalContext: chord.semantics.pedalContext ?? null,
    });
  };

  const sourceContext = interpretationContext(sourceChord);
  const currentContext = interpretationContext(currentChord);
  if (sourceChord.semantics || currentChord.semantics)
    return Boolean(
      sourceContext && currentContext && sourceContext === currentContext,
    );
  return true;
}

function seventhTransferVoiceIds(
  environment: ObligationEnvironment<SeventhPayload>,
) {
  const payload = environment.obligation.payload;
  const sourceChord = openedSourceChord(environment);
  if (!sourceChord) return [];
  const sourceTones = chordIdentityToneSpellings(sourceChord.identity);
  if (sourceTones.length < 4) return [];
  const seventhTone = sourceTones[3];

  const currentSource = environment.context.slice.notes[payload.voiceId];
  const sourceStillSeventh = Boolean(
    currentSource && pitchClassEquals(currentSource.pitch, seventhTone),
  );
  if (sourceStillSeventh) return [];

  return environment.moment.attackedVoiceIds.filter((voiceId) => {
    if (voiceId === payload.voiceId) return false;
    const note = environment.context.slice.notes[voiceId];
    return Boolean(note && pitchClassEquals(note.pitch, seventhTone));
  });
}

function soundsDominantSeventh(slice: RuleStepContext["slice"], tones: readonly SpelledPitchClass[]) {
  const bass = slice.notes.bass;
  if (!bass) return false;
  const notes = Object.values(slice.notes);
  return notes.every(note => note && !note.nonChordToneRole && toMidi(note.pitch) >= toMidi(bass.pitch) &&
    tones.some(tone => pitchClassEquals(tone, note.pitch))) &&
    [tones[0], tones[1], tones[3]].every(tone => notes.some(note => note && pitchClassEquals(tone, note.pitch)));
}

// §15.5: the bass seventh may not step up to the root during D2 → D7 revoicing.
function bassSeventhRisesToDominantRoot(environment: ObligationEnvironment<SeventhPayload>) {
  const { context, obligation } = environment;
  const { previous, slice, rules } = context;
  const departure = previous?.notes.bass;
  const landing = slice.notes.bass;
  const from = previous?.chord?.identity;
  const chord = slice.chord;
  if (obligation.payload.voiceId !== "bass" || !subjectAttacked(environment) ||
      !departure || !landing || !from || !chord || departure.nonChordToneRole || landing.nonChordToneRole ||
      previous.key.id !== slice.key.id || departure.startTick + departure.durationTicks !== landing.startTick ||
      toMidi(departure.pitch) !== obligation.payload.seventhMidi ||
      from.structure.kind !== "tertian" || from.structure.quality !== "dominant7" ||
      from.structure.extensions.length || from.structure.alterations.length ||
      !sameChordIdentityWithoutBass(from, chord.identity)) return false;

  const reading = rules.harmony.primaryInterpretation(chord);
  if (reading.status === "resolved" && reading.value.appliedTarget) return false;
  const key = reading.status === "resolved" ? reading.value.localKey ?? slice.key : slice.key;
  const motion = writtenInterval(departure.pitch, landing.pitch);
  const tones = chordIdentityToneSpellings(from);
  return pitchClassEquals(from.root, scaleDegreePitchClass(key, 5)) &&
    pitchClassEquals(from.bass, departure.pitch) && pitchClassEquals(departure.pitch, tones[3]) &&
    pitchClassEquals(chord.identity.root, chord.identity.bass) && pitchClassEquals(landing.pitch, chord.identity.root) &&
    motion.diatonicSteps === 1 && motion.semitones === 2 &&
    soundsDominantSeventh(previous, tones) && soundsDominantSeventh(slice, tones) &&
    !context.analysis.phraseBoundaries.some(boundary => boundary.source === "manual" &&
      departure.startTick < boundary.tick && boundary.tick <= slice.tick);
}

function seventhTransition(
  environment: ObligationEnvironment<SeventhPayload>,
): ObligationDecision | undefined {
  if (
    subjectEnteredRest(environment) ||
    !supportsTendencyResolutionRules(
      environment.context,
      environment.context.slice.chord,
    ) ||
    !targetChordAvailable(environment)
  )
    return decision(environment, "cancel", "chord-seventh-context-ended");

  if (sameSeventhContext(environment) && seventhTransferVoiceIds(environment).length) {
    if (bassSeventhRisesToDominantRoot(environment))
      return decision(environment, "violate", "chord-seventh-bass-rises-to-root");
    return decision(environment, "cancel", "chord-seventh-transferred");
  }

  if (sameOpenedSpan(environment))
    return decision(environment, "continue", "chord-seventh-same-harmony");

  if (subjectHasActiveNote(environment)) {
    if (chordSeventhResolves(environment))
      return decision(environment, "resolve", "chord-seventh-resolved");

    if (sameWrittenPitchAsSource(environment)) {
      const current =
        environment.context.slice.notes[environment.obligation.payload.voiceId];
      const targetChord = environment.context.slice.chord;
      if (current && targetChord) {
        const targetTones = chordIdentityToneSpellings(targetChord.identity);
        const toneIndex = targetTones.findIndex((tone) =>
          pitchClassEquals(current.pitch, tone),
        );
        // 1. 若在目标和弦中转化为协和音（根音、三音或五音，如 SII7 -> I6 / I 中的主音），
        //    则该七音的不协和倾向已被新和弦的协和骨干音吸收消解，直接视为解决。
        if (toneIndex >= 0 && toneIndex <= 2) {
          return decision(environment, "resolve", "chord-seventh-resolved");
        }
        // 2. 若在目标和弦中仍作为七音，或作为延留/悬挂音保持，则允许继续延期解决。
        return decision(environment, "continue", "chord-seventh-repeated");
      }
    }

    return decision(environment, "violate", "chord-seventh-moved-elsewhere");
  }

  return undefined;
}

function dominantNinthTransition(
  environment: ObligationEnvironment<DominantNinthPayload>,
): ObligationDecision | undefined {
  if (
    subjectEnteredRest(environment) ||
    !supportsTendencyResolutionRules(
      environment.context,
      environment.context.slice.chord,
    ) ||
    !targetChordAvailable(environment)
  )
    return decision(environment, "cancel", "dominant-ninth-context-ended");

  if (sameOpenedSpan(environment))
    return decision(environment, "continue", "dominant-ninth-same-harmony");

  if (subjectHasActiveNote(environment)) {
    if (dominantNinthResolves(environment))
      return decision(environment, "resolve", "dominant-ninth-resolved");

    if (sameWrittenPitchAsSource(environment)) {
      const current =
        environment.context.slice.notes[environment.obligation.payload.voiceId];
      const targetChord = environment.context.slice.chord;
      if (current && targetChord) {
        const targetTones = chordIdentityToneSpellings(targetChord.identity);
        const toneIndex = targetTones.findIndex((tone) =>
          pitchClassEquals(current.pitch, tone),
        );
        if (toneIndex >= 0 && toneIndex <= 2) {
          return decision(environment, "resolve", "dominant-ninth-resolved");
        }
        return decision(environment, "continue", "dominant-ninth-repeated");
      }
    }

    return decision(environment, "violate", "dominant-ninth-moved-elsewhere");
  }

  return undefined;
}

function alteredToneTransition(
  environment: ObligationEnvironment<AlteredTonePayload>,
): ObligationDecision | undefined {
  if (
    subjectEnteredRest(environment) ||
    !supportsTendencyResolutionRules(
      environment.context,
      environment.context.slice.chord,
    ) ||
    !targetChordAvailable(environment)
  )
    return decision(environment, "cancel", "altered-tone-context-ended");

  if (sameOpenedSpan(environment))
    return decision(environment, "continue", "altered-tone-same-harmony");

  if (subjectHasActiveNote(environment) && alteredToneResolves(environment))
    return decision(environment, "resolve", "altered-tone-resolved");

  if (subjectHasActiveNote(environment))
    return decision(environment, "violate", "altered-tone-moved-elsewhere");

  return undefined;
}

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
      const incomingConnection = context.rules.connections({
        targetSpanId: currentSpan.id,
      }).first();
      const connection = incomingConnection?.connection;
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
        const previous = context.rules
          .spans({ id: payload.sourceSpanId })
          .selectMany(({ chords }) => chords)
          .first((chord) => chord.id === payload.sourceChordId);
        const current = context.rules
          .spans({ id: currentSpan.id })
          .selectMany(({ chords }) => chords)
          .first();
        if (
          previous &&
          current &&
          connection?.contiguous &&
          connection.sameKey &&
          connection.confidence !== "ambiguous" &&
          connection.confidence !== "unknown" &&
          !(incomingConnection &&
            incomingConnection.source.span.id === payload.sourceSpanId &&
            payload.sourceToTick === currentSpan.fromTick &&
            isProvenLocalDeceptiveTarget(context.rules, incomingConnection))
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
  const sourceResolution = context.span
    ? context.rules.harmony.primaryInterpretation(context.span)
    : undefined;
  const sourceInterpretation =
    sourceResolution?.status === "resolved"
      ? sourceResolution.value
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
      "检查调式导音（Ⅶ级）在属功能进入主功能时是否在同一声部向上半音级进解决至主音。",
    rationale:
      "导音位于主音下方半音，对主音具有极其强烈的上行吸引力。在外声部（女高音与男低音）中的导音必须严格上行半音解决至主音（7→1）；唯有在内声部（中音或次中音）且主和弦为完全三和弦时，方可例外进行三度下行跳进至五音（7→5）。",
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
    onEnd: "cancel",
    reportViolation: leadingToneDiagnostic,
  }),
  defineObligationRule({
    id: "resolution.chord-seventh",
    catalogNumber: "E.2",
    label: "和弦七音未解决",
    description:
      "检查和弦七音在和弦转换时是否按其声部进行解决。",
    rationale:
      "和弦七音通常同声部下行级进。经过 T–D43–T6 时，属七音可同声部上行至主和弦五音，与结构低音同向级进并避免重复主和弦三音。",
    group: "resolution",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    supportedExceptionContexts: ["same-harmony", "insufficient-context"],
    source: chordSeventhSource,
    retrigger: "retain-existing",
    transition: seventhTransition,
    onEnd: "cancel",
    reportViolation: seventhDiagnostic,
  }),
  defineObligationRule({
    id: "resolution.dominant-ninth",
    catalogNumber: "E.3",
    label: "属九音未解决",
    description:
      "检查属九和弦中的九音是否在同一声部向下二度级进解决至主和弦的五音。",
    rationale:
      "九和弦的九音是不协和度极高的音，在传统和声中必须顺应声学重力向下二度级进解决到主和弦的五音，不可反向上行或跳进脱离。",
    group: "resolution",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    source: dominantNinthSource,
    retrigger: "retain-existing",
    transition: dominantNinthTransition,
    onEnd: "cancel",
    reportViolation: dominantNinthDiagnostic,
  }),
  defineObligationRule({
    id: "resolution.altered-tone",
    catalogNumber: "E.4",
    label: "变化音方向性解决",
    description:
      "检查和弦中的升号变化音是否向上解决、降号变化音是否向下解决。",
    rationale:
      "调式中的变化音具有鲜明的方向动能：用升号（或还原降号）升高的音具有向上半音级进的强烈倾向；用降号（或还原升号）降低的音具有向下半音级进的强烈倾向。违背倾向反向进行会造成尖锐的声部生硬感。",
    group: "resolution",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    source: alteredToneSource,
    retrigger: "retain-existing",
    transition: alteredToneTransition,
    onEnd: "cancel",
    reportViolation: alteredToneDiagnostic,
  }),
  defineStatefulRule({
    id: "function.applied-dominant-target",
    catalogNumber: "G.2",
    label: "离调属功能未进入目标",
    description:
      "检查副属和弦（离调属和弦）是否准确进入了其所指向的副级目标和弦。",
    rationale:
      "副属和弦的作用在于通过临时的“属—主”动力关系将某个副级和弦临时主调化（如 Ⅴ/Ⅱ → Ⅱ）。副属和弦通常进入该副级和弦或其转位。若实写的完整原位属七按声部解决到所指小调的原位 VI（重复三音），也可构成局部阻碍进行。",
    group: "function",
    defaultSeverity: "warning",
    requires: ["chords", "semantics"],
    dependencyScope: "phrase",
    process: secondaryDominantStateStep,
  }),
);
