import { canonicalJson } from "../../../canonicalJson";
import { chordIdentityToneSpellings, identityContainsWrittenPitchClass } from "../../../chordModel";
import { pitchClassEquals, type SpelledPitchClass } from "../../../pitch";
import { sameChordIdentityWithoutBass, type AnalysisChord } from "../../analysis";
import { sameFunctionalReading } from "../../functionalReading";
import type { JsonValue, RuleStepContext } from "../../runtime";
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
