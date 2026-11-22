import { canonicalJson } from "../../../canonicalJson";
import { chordIdentityToneSpellings, identityContainsWrittenPitchClass } from "../../../chordModel";
import {
  pitchClassEquals,
  type SpelledPitchClass,
  keyEquals,
  type KeyLike,
  scaleDegreePitchClass,
} from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import { sameChordIdentityWithoutBass, type AnalysisChord, type AnalysisSlice } from "../../analysis";
import { sameFunctionalReading } from "../../facts/functionalContext";
import type { JsonValue, RuleStepContext } from "../../runtime";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { leadingTargetDegree, type HarmonyAnalysisService } from "../services/harmony";
import type { ObligationEnvironment } from "./obligation";
import type { LeadingTonePayload, SeventhPayload, VoiceObligationPayload } from "./tendency";

export function supportsTendencyResolutionRules(
  context: RuleStepContext,
  chord: RuleStepContext["slice"]["chord"],
) {
  if (!chord) return true;
  const resolution = context.rules.harmony.primaryInterpretation(chord);
  return (
    chord.identity.structure.kind === "tertian" &&
    !chord.semantics?.pedalContext &&
    (!chord.semantics || resolution.status === "resolved")
  );
}

export function openedSourceNote<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  const noteId = environment.obligation.openedBy.noteIds?.[0];
  return noteId
    ? environment.context.rules
        .notes()
        .first(({ note }) => note.id === noteId)?.note
    : undefined;
}

export function openedSourceChord<Payload extends JsonValue>(
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

export function openedSpanId<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  return environment.obligation.openedBy.spanIds?.[0];
}

export function currentSpanId<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
) {
  return environment.context.rules.spanAt(environment.moment.tick)?.span.id;
}

export function leadingTargetUnchanged(
  environment: ObligationEnvironment<LeadingTonePayload>,
) {
  const { sourceKeyStep, sourceKeyAlter, sourceKeyMode } = environment.obligation.payload;
  const { tonic, mode } = environment.context.slice.key;
  return tonic.step === sourceKeyStep && tonic.alter === sourceKeyAlter && mode === sourceKeyMode;
}

function sameResolutionInterpretation(
  rules: RuleStepContext["rules"],
  source: AnalysisChord,
  current: AnalysisChord,
) {
  if (!source.semantics || !current.semantics) return source.semantics === current.semantics;
  const before = rules.harmony.primaryInterpretation(source);
  const after = rules.harmony.primaryInterpretation(current);
  return before.status === "resolved" && after.status === "resolved" &&
    sameFunctionalReading(before.value, after.value) &&
    source.semantics.mixture === current.semantics.mixture &&
    source.semantics.cadenceRole === current.semantics.cadenceRole &&
    canonicalJson(source.semantics.pedalContext) === canonicalJson(current.semantics.pedalContext);
}

/**
 * 判断导音义务是否仍处于同一功能性和声上下文。
 *
 * HarmonySpan 会因为完整语义对象（尤其是转位推导出的 interpretation id）
 * 变化而切分，但导音在同一调性、同一和弦实体和同一功能目标内仍可跨声部交接。
 * 这个判断只供导音义务使用，不能替代全局 HarmonySpan 的严格边界。
 */
export function sameLeadingToneContext(
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

  return sameResolutionInterpretation(environment.context.rules, sourceChord, currentChord);
}

export function sameSeventhContext(
  environment: ObligationEnvironment<SeventhPayload>,
  currentChord = environment.context.slice.chord,
) {
  if (!environment.context.transitionFromPrevious?.contiguous) return false;

  const sourceChord = openedSourceChord(environment);
  if (!sourceChord || !currentChord) return false;

  if (!pitchClassEquals(sourceChord.identity.root, currentChord.identity.root))
    return false;

  const sourceTones = chordIdentityToneSpellings(sourceChord.identity);
  const currentTones = chordIdentityToneSpellings(currentChord.identity);
  if (sourceTones.length < 4 || currentTones.length < 4) return false;
  if (!pitchClassEquals(sourceTones[3], currentTones[3])) return false;

  return sameResolutionInterpretation(environment.context.rules, sourceChord, currentChord);
}

/** A handoff requires the source voice to leave and a different voice to attack that spelling. */
export function receivingVoiceIds<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
  tone: SpelledPitchClass,
) {
  const { context, moment, obligation } = environment;
  const fromVoice = obligation.payload.voiceId;
  const source = context.slice.notes[fromVoice];
  if (source && pitchClassEquals(source.pitch, tone)) return [];

  return moment.attackedVoiceIds.filter(voice => {
    const note = context.slice.notes[voice];
    return voice !== fromVoice && !!note && pitchClassEquals(note.pitch, tone);
  });
}

export function seventhTransferVoiceIds(environment: ObligationEnvironment<SeventhPayload>) {
  const chord = openedSourceChord(environment);
  const seventh = chord && chordIdentityToneSpellings(chord.identity)[3];
  return seventh ? receivingVoiceIds(environment, seventh) : [];
}

export function currentSpanRefs(context: RuleStepContext) {
  const spanId = context.rules.spanAt(context.slice.tick)?.span.id;
  return spanId ? { spanIds: [spanId] } : {};
}

export interface HarmonyChange {
  readonly previousSpanId?: string;
  readonly currentSpanId?: string;
  readonly previousChordId?: string;
  readonly currentChordId?: string;
}

export interface KeyChange {
  readonly previousKeyId: string;
  readonly currentKeyId: string;
}

export interface AnalysisMoment {
  readonly tick: number;
  readonly attackedVoiceIds: readonly VoiceId[];
  readonly releasedVoiceIds: readonly VoiceId[];
  readonly enteredRestVoiceIds: readonly VoiceId[];
  readonly harmonyChange?: HarmonyChange;
  readonly keyChange?: KeyChange;
}

export function analysisMoment(context: RuleStepContext): AnalysisMoment {
  const previous = context.previous;
  const current = context.slice;
  const previousSpanId = previous
    ? context.rules.spanAt(previous.tick)?.span.id
    : undefined;
  const currentSpanId = context.rules.spanAt(current.tick)?.span.id;
  const releasedVoiceIds = previous
    ? VOICE_ORDER.filter(
        (voiceId) =>
          previous.notes[voiceId] &&
          previous.notes[voiceId]?.id !== current.notes[voiceId]?.id,
      )
    : [];
  const enteredRestVoiceIds = previous
    ? VOICE_ORDER.filter(
        (voiceId) => previous.notes[voiceId] && !current.notes[voiceId],
      )
    : [];
  const harmonyChanged = Boolean(previous) && previousSpanId !== currentSpanId;
  const keyChanged = Boolean(
    previous &&
    (!keyEquals(previous.key, current.key)),
  );
  return Object.freeze({
    tick: current.tick,
    attackedVoiceIds: Object.freeze([...current.attackVoiceIds]),
    releasedVoiceIds: Object.freeze(releasedVoiceIds),
    enteredRestVoiceIds: Object.freeze(enteredRestVoiceIds),
    ...(harmonyChanged
      ? {
          harmonyChange: Object.freeze({
            ...(previousSpanId ? { previousSpanId } : {}),
            ...(currentSpanId ? { currentSpanId } : {}),
            ...(previous?.chord?.id
              ? { previousChordId: previous.chord.id }
              : {}),
            ...(current.chord?.id ? { currentChordId: current.chord.id } : {}),
          }),
        }
      : {}),
    ...(keyChanged && previous
      ? {
          keyChange: Object.freeze({
            previousKeyId: previous.key.id,
            currentKeyId: current.key.id,
          }),
        }
      : {}),
  });
}

/** Compare declared function after the caller has independently checked the written pitches. */
export function allowsWrittenLocalRole(rules: HarmonyRuleContext, frame: AnalysisSlice, key: KeyLike, degree: 1 | 5) {
  const chord = frame.chord;
  if (!chord?.semantics) return true;
  const reading = rules.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || chord.semantics.pedalContext) return false;
  const meaning = reading.value;
  if (meaning.source === "inferred" && !chord.locked && !rules.analysis.project.chordTrack.locked) return true;
  if (leadingTargetDegree(meaning)) {
    return degree === 5 && keyEquals(leadingToneResolutionKey(frame, rules.harmony), key);
  }
  return meaning.degree === degree && !meaning.degreeAlteration && keyEquals(meaning.localKey ?? frame.key, key);
}

/** The local tonic to which a written leading tone owes its resolution.
 * An applied interpretation names its target by degree in the local key. */
export function leadingToneResolutionKey(slice: AnalysisSlice, harmony: HarmonyAnalysisService) {
  const reading = slice.chord && harmony.primaryInterpretation(slice.chord);
  const meaning = reading?.status === "resolved" ? reading.value : undefined;
  const key = meaning?.localKey ?? slice.key;
  const degree = leadingTargetDegree(meaning);
  return degree ? { tonic: scaleDegreePitchClass(key, degree), mode: "major" as const } : key;
}
