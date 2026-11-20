import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import {
  chordIdentityToneSpellings,
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
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval, type SpelledPitchClass } from "../../../pitch";
import {
  currentSpanId, leadingTargetUnchanged, openedSourceNote, openedSpanId, receivingVoiceIds,
  sameLeadingToneContext, sameSeventhContext, seventhTransferVoiceIds,
} from "../state/tendencyContext";
import {
  alteredToneDiagnostic, dominantNinthDiagnostic, leadingToneDiagnostic, seventhDiagnostic,
} from "../state/resolutionDiagnostics";
import { writtenSeventhHandoff } from "../state/writtenSeventhHandoff";
import {
  leadingRootContinuesInHalfDiminishedChain,
  reattackedLeadingToneResolvesAsChainSeventh,
} from "./halfDiminishedChain";
import { homeLeadingToneWasDominantFifth } from "../state/dominantSeventhFifth";
import { transfersLeadingToneInWrittenDominant } from "../state/writtenLeadingToneTransfer";
import { leavesDiatonicSequenceLeadingTone, resolvesCopiedSeventhFifth } from "../state/diatonicSequenceLeadingTone";
import {
  chordEvidence,
  diagnostic,
  noteEvidence,
} from "../helpers/core";
import { defineRuleGroup, defineStatefulRule } from "../defineRule";
import { functionalTargetMatches, isCadential64Span } from "../connector";
import { leadingNeighborFrame, ornamentsSameLeadingHarmony } from "../state/leadingToneNeighbor";
import { ornamentsPreparedSeventh } from "../state/preparedSeventh";
import { readDoubleDominantSeventhLanding } from "../state/doubleDominantSeventh";
import { isProvenLocalDeceptiveTarget } from "./localDeceptiveAppliedTarget";
import { isProvenHeldDoubleDominantContinuation } from "./heldDoubleDominantContinuation";
import { exchangesSupertonicSeventhWithRoot, seventhLeapsToUnlabelledSixFour } from "./supertonicSeventhExchange";
import {
  defineObligationRule,
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
  leadingToneBecomesNextDominantSeventh,
  leadingToneDescendsInMajorDeceptiveMotion,
  leadingToneDescendsFromMediant,
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

function sameOpenedSpan<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  const sourceSpanId = openedSpanId(environment);
  return Boolean(sourceSpanId && sourceSpanId === currentSpanId(environment));
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
  const sameLeadingContext = sameLeadingToneContext(environment);
  const { context, obligation: { payload } } = environment;
  const currentNote = context.slice.notes[payload.voiceId];
  const transferVoiceIds = receivingVoiceIds(environment, { step: payload.leadingStep, alter: payload.leadingAlter });
  const spanId = currentSpanId(environment);
  const debugFacts = {
    sameOpenedSpan: sameOpenedSpan(environment),
    sameLeadingToneContext: sameLeadingContext,
    targetUnchanged,
    attacked,
    sourceStillLeading:
      currentNote?.pitch.step === payload.leadingStep &&
      currentNote?.pitch.alter === payload.leadingAlter,
    transferredVoiceIds: transferVoiceIds,
    ...(currentNote ? { currentNoteId: currentNote.id } : {}),
    ...(spanId ? { currentSpanId: spanId } : {}),
  } satisfies Record<string, JsonValue>;

  if (attacked && targetUnchanged && currentNote) {
    const frame = leadingNeighborFrame(context.rules, payload.voiceId, currentNote);
    if (frame && frame.preparation.pitch.step === payload.leadingStep &&
        frame.preparation.pitch.alter === payload.leadingAlter &&
        toMidi(frame.preparation.pitch) === payload.leadingMidi &&
        ornamentsSameLeadingHarmony(context.rules, frame)) {
      return decision(environment, "continue", "leading-tone-neighbor-return", {
        ...debugFacts, returnNoteId: frame.arrival.id,
      });
    }
  }

  if (attacked && targetUnchanged && leadingToneResolves(environment))
    return decision(
      environment,
      "resolve",
      "leading-tone-resolved",
      debugFacts,
    );

  if (attacked && targetUnchanged && currentNote) {
    const proof = readDoubleDominantSeventhLanding(environment.context.rules, currentNote.startTick);
    if (proof && proof.leading.voiceId === payload.voiceId && proof.leadingArrival.id === currentNote.id &&
        toMidi(proof.leading.note.pitch) === payload.leadingMidi &&
        proof.leading.note.pitch.step === payload.leadingStep && proof.leading.note.pitch.alter === payload.leadingAlter &&
        proof.dominantRoot.step === payload.targetStep && proof.dominantRoot.alter === payload.targetAlter) {
      return decision(environment, "resolve", "double-dominant-leading-tone-to-dominant-seventh", debugFacts);
    }
  }

  if (attacked && targetUnchanged && leadingToneBecomesNextDominantSeventh(environment))
    return decision(environment, "resolve", "leading-tone-becomes-next-dominant-seventh", debugFacts);

  if (attacked && targetUnchanged && innerLeadingToneDescendsToFifth(environment))
    return decision(environment, "resolve", "inner-leading-tone-descends-to-fifth", debugFacts);

  if (attacked && targetUnchanged && leadingToneDescendsInMajorDeceptiveMotion(environment))
    return decision(environment, "resolve", "major-deceptive-leading-tone-descends", debugFacts);

  if (attacked && targetUnchanged && leadingToneDescendsFromMediant(environment))
    return decision(environment, "resolve", "major-mediant-melody-descends", debugFacts);

  if (
    targetUnchanged &&
    transferVoiceIds.length > 0 &&
    (sameLeadingContext || transfersLeadingToneInWrittenDominant(environment, transferVoiceIds))
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

  if (attacked && leadingRootContinuesInHalfDiminishedChain(
    environment.context.rules, environment.obligation.openedAt.tick, environment.context.slice, payload.voiceId,
    { tonic: { step: payload.targetStep, alter: payload.targetAlter }, mode: payload.targetMode },
  )) return decision(environment, "cancel", "leading-tone-half-diminished-sequence", debugFacts);

  if (attacked && reattackedLeadingToneResolvesAsChainSeventh(
    context.rules, environment.obligation.openedAt.tick, context.slice, payload.voiceId,
  )) return decision(environment, "cancel", "leading-tone-reattack-resolves-as-chain-seventh", debugFacts);

  if (attacked && homeLeadingToneWasDominantFifth(environment))
    return decision(environment, "cancel", "home-leading-tone-was-dominant-fifth", debugFacts);

  if (attacked && resolvesCopiedSeventhFifth(environment))
    return decision(environment, "cancel", "diatonic-sequence-seventh-fifth", debugFacts);

  if (attacked && leavesDiatonicSequenceLeadingTone(environment))
    return decision(environment, "cancel", "leading-tone-diatonic-sequence", debugFacts);

  if (attacked)
    return decision(
      environment,
      "violate",
      "leading-tone-moved-elsewhere",
      debugFacts,
    );

  return undefined;
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
    !crossesManualPhraseBoundary(context, departure.startTick, slice.tick);
}

// Spasobin §15.5 and companion ch. 15, exercise IV: ②⑤ and ⑥ have different receiving motions.
function upperSeventhTransferViolation(environment: ObligationEnvironment<SeventhPayload>, receiver: VoiceId): ObligationDecision | undefined {
  const { context, obligation } = environment;
  const voice = obligation.payload.voiceId;
  if (voice === "bass" || !subjectAttacked(environment)) return;
  const { previous, slice, rules } = context;
  const identity = previous?.chord?.identity;
  const to = slice.chord;
  if (!identity || !to || identity.structure.kind !== "tertian" || identity.structure.quality !== "dominant7" ||
      identity.structure.extensions.length || identity.structure.alterations.length ||
      !sameChordIdentityWithoutBass(identity, to.identity)) return;
  const reading = rules.harmony.primaryInterpretation(to);
  if (reading.status === "resolved" && reading.value.appliedTarget) return;
  const key = reading.status === "resolved" ? reading.value.localKey ?? slice.key : slice.key;
  const tones = chordIdentityToneSpellings(identity);
  if (!pitchClassEquals(identity.root, scaleDegreePitchClass(key, 5)) ||
      !previous.notes.bass || !slice.notes.bass ||
      !pitchClassEquals(previous.notes.bass.pitch, identity.bass) || !pitchClassEquals(slice.notes.bass.pitch, to.identity.bass) ||
      !soundsDominantSeventh(previous, tones) || !soundsDominantSeventh(slice, tones)) return;

  const handoff = writtenSeventhHandoff(context, voice, receiver, tones[3]);
  if (!handoff) return;
  const { departure: oldSeventh, landing: newRoot, partner, received: newSeventh, outgoing, incoming } = handoff;
  if (toMidi(oldSeventh.pitch) !== obligation.payload.seventhMidi || !pitchClassEquals(newRoot.pitch, identity.root)) return;
  const rises = outgoing.diatonicSteps === 1 && outgoing.semitones === 2;
  const dropsSeventh = outgoing.diatonicSteps === -6 && outgoing.semitones === -10;
  if (!rises && !dropsSeventh) return;
  let reason: string;
  const swapsWithBass = receiver === "bass" && pitchClassEquals(partner.pitch, identity.root) &&
    incoming.diatonicSteps === -1 && incoming.semitones === -2;
  const swapsUpperVoices = receiver !== "bass" && spelledPitchEquals(newRoot.pitch, partner.pitch) &&
    spelledPitchEquals(newSeventh.pitch, oldSeventh.pitch);
  if (rises && (swapsWithBass || swapsUpperVoices))
    reason = "chord-seventh-upper-root-exchange";
  else if (receiver !== "bass" && pitchClassEquals(partner.pitch, tones[1]) && incoming.diatonicSteps === -3 && incoming.semitones === -6)
    reason = "chord-seventh-upper-tritone-transfer";
  else return;

  const violation = decision(environment, "violate", reason, { receivingVoice: receiver });
  return { ...violation, evidence: [
    ...(violation.evidence ?? []), noteEvidence(partner, "接手声部前音"), noteEvidence(newSeventh, "接手的七音"),
  ] };
}

function seventhTransition(
  environment: ObligationEnvironment<SeventhPayload>,
): ObligationDecision | undefined {
  if (!environment.context.slice.chord && seventhLeapsToUnlabelledSixFour(
    environment.context, environment.obligation.payload.voiceId,
    environment.obligation.openedBy.noteIds?.[0], environment.obligation.openedAt.tick,
  )) return decision(environment, "violate", "supertonic-seventh-leaps-to-six-four");
  if (
    subjectEnteredRest(environment) ||
    !supportsTendencyResolutionRules(
      environment.context,
      environment.context.slice.chord,
    ) ||
    !targetChordAvailable(environment)
  )
    return decision(environment, "cancel", "chord-seventh-context-ended");

  const receivers = sameSeventhContext(environment) ? seventhTransferVoiceIds(environment) : [];
  if (receivers.length) {
    if (bassSeventhRisesToDominantRoot(environment))
      return decision(environment, "violate", "chord-seventh-bass-rises-to-root");
    const { context, obligation: { payload, openedAt } } = environment;
    if (exchangesSupertonicSeventhWithRoot(context, payload.voiceId, payload.seventhMidi, openedAt.tick, receivers))
      return decision(environment, "violate", "supertonic-seventh-exchanges-with-root");
    if (receivers.length === 1) {
      const violation = upperSeventhTransferViolation(environment, receivers[0]);
      if (violation) return violation;
    }
    return decision(environment, "cancel", "chord-seventh-transferred");
  }

  if (sameOpenedSpan(environment))
    return decision(environment, "continue", "chord-seventh-same-harmony");

  if (ornamentsPreparedSeventh(environment))
    return decision(environment, "continue", "chord-seventh-prepared-neighbor");

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
            (isProvenLocalDeceptiveTarget(context.rules, incomingConnection) ||
              (payload.targetDegree === 5 &&
                isProvenHeldDoubleDominantContinuation(context.rules, incomingConnection))))
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
      "检查调式导音（Ⅶ级）在和声转换时是否在同一声部按其倾向解决。",
    rationale:
      "导音通常上行半音到主音（7→1）。内声部可在特定的原位属到完整主三和弦中下行至五音。大调原位属到原位Ⅵ级的内声导音，或大调属六到原位Ⅵ级的低音导音，在满足实际声部进行与重复音配置时可下行大二度（7→6）。根音上行纯四度的连续属七中，前三音和前七音均按实奏半音下行时，前三音可转为后七音。",
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
      "检查九音是否在原声部下行解决至主和弦五音，或在同根属七中按教材方式解决。",
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
