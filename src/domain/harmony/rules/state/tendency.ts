import {
  chordIdentityToneSpellings,
  chordIdentityToneSpellingForDegree,
} from "../../../chordModel";
import type { VoiceId } from "../../../project/types";
import {
  leadingTonePitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  type SpelledPitchClass,
} from "../../../pitch";
import type { JsonValue, RuleStepContext } from "../../runtime";
import type {
  ObligationEnvironment,
  ObligationSource,
  SubjectRefs,
} from "./obligation";
import { hasExactPitch, noteEvidence } from "../helpers/core";

export type VoiceObligationPayload = {
  readonly [key: string]: JsonValue;
  readonly voiceId: VoiceId;
};

export type LeadingTonePayload = VoiceObligationPayload & {
  readonly leadingMidi: number;
  readonly leadingStep: SpelledPitchClass["step"];
  readonly leadingAlter: SpelledPitchClass["alter"];
  readonly targetStep: SpelledPitchClass["step"];
  readonly targetAlter: SpelledPitchClass["alter"];
  readonly targetMode: "major" | "minor";
  readonly sourceKeyStep: SpelledPitchClass["step"];
  readonly sourceKeyAlter: SpelledPitchClass["alter"];
  readonly sourceKeyMode: "major" | "minor";
};

export type SeventhPayload = VoiceObligationPayload & {
  readonly seventhMidi: number;
};

export type DominantNinthPayload = VoiceObligationPayload & {
  readonly ninthMidi: number;
};

export type AlteredTonePayload = VoiceObligationPayload & {
  readonly degree: 5 | 9 | 11 | 13;
  readonly tendency: "up" | "down";
  readonly alteredMidi: number;
};

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

function leadingToneExpectation(context: RuleStepContext) {
  const resolution = context.slice.chord
    ? context.rules.harmony.primaryInterpretation(context.slice.chord)
    : undefined;
  const interpretation =
    resolution?.status === "resolved" ? resolution.value : undefined;
  const baseKey = interpretation?.localKey ?? context.slice.key;
  const targetTonic = interpretation?.appliedTarget
    ? scaleDegreePitchClass(baseKey, interpretation.appliedTarget.degree)
    : baseKey.tonic;
  const targetKey = interpretation?.appliedTarget
    ? { tonic: targetTonic, mode: "major" as const }
    : baseKey;
  return {
    leadingTone: leadingTonePitchClass(targetKey),
    targetTonic,
    targetMode: targetKey.mode,
  };
}

function currentSpanRefs(context: RuleStepContext) {
  const spanId = context.rules.spanAt(context.slice.tick)?.span.id;
  return spanId ? { spanIds: [spanId] } : {};
}

export const leadingToneSource: ObligationSource<LeadingTonePayload> = {
  id: "source.leading-tone-attacks",
  requires: ["written-pitches"],
  collect({ context, moment }) {
    if (!supportsTendencyResolutionRules(context, context.slice.chord))
      return [];
    const { leadingTone, targetTonic, targetMode } = leadingToneExpectation(context);
    return moment.attackedVoiceIds.flatMap((voiceId) => {
      const note = context.slice.notes[voiceId];
      if (!note || !pitchClassEquals(note.pitch, leadingTone)) return [];
      return [
        {
          partitionKey: `voice:${voiceId}|target:${targetTonic.step}:${targetTonic.alter}`,
          payload: {
            voiceId,
            leadingMidi: toMidi(note.pitch),
            leadingStep: leadingTone.step,
            leadingAlter: leadingTone.alter,
            targetStep: targetTonic.step,
            targetAlter: targetTonic.alter,
            targetMode,
            sourceKeyStep: context.slice.key.tonic.step,
            sourceKeyAlter: context.slice.key.tonic.alter,
            sourceKeyMode: context.slice.key.mode,
          },
          subjectRefs: {
            voiceIds: [voiceId],
            noteIds: [note.id],
            ...currentSpanRefs(context),
          },
        },
      ];
    });
  },
};

export const chordSeventhSource: ObligationSource<SeventhPayload> = {
  id: "source.chord-seventh-attacks",
  requires: ["written-pitches", "chords"],
  collect({ context, moment }) {
    const chord = context.slice.chord;
    if (!chord || !supportsTendencyResolutionRules(context, chord)) return [];
    const tones = chordIdentityToneSpellings(chord.identity);
    if (tones.length < 4) return [];
    return moment.attackedVoiceIds.flatMap((voiceId) => {
      const note = context.slice.notes[voiceId];
      if (!note || !pitchClassEquals(note.pitch, tones[3])) return [];
      return [
        {
          partitionKey: `voice:${voiceId}`,
          payload: { voiceId, seventhMidi: toMidi(note.pitch) },
          subjectRefs: {
            voiceIds: [voiceId],
            noteIds: [note.id],
            chordIds: [chord.id],
            ...currentSpanRefs(context),
          },
        },
      ];
    });
  },
};

export const dominantNinthSource: ObligationSource<DominantNinthPayload> = {
  id: "source.dominant-ninth-attacks",
  requires: ["written-pitches", "chords"],
  collect({ context, moment }) {
    const chord = context.slice.chord;
    if (
      !chord ||
      !supportsTendencyResolutionRules(context, chord) ||
      chord.identity.structure.kind !== "tertian" ||
      chord.identity.structure.quality !== "dominant7" ||
      !chord.identity.structure.extensions.includes(9)
    )
      return [];
    const tones = chordIdentityToneSpellings(chord.identity);
    return moment.attackedVoiceIds.flatMap((voiceId) => {
      const note = context.slice.notes[voiceId];
      if (!note || !tones[4] || !pitchClassEquals(note.pitch, tones[4]))
        return [];
      return [
        {
          partitionKey: `voice:${voiceId}`,
          payload: { voiceId, ninthMidi: toMidi(note.pitch) },
          subjectRefs: {
            voiceIds: [voiceId],
            noteIds: [note.id],
            chordIds: [chord.id],
            ...currentSpanRefs(context),
          },
        },
      ];
    });
  },
};

export const alteredToneSource: ObligationSource<AlteredTonePayload> = {
  id: "source.directional-altered-tone-attacks",
  requires: ["written-pitches", "chords"],
  collect({ context, moment }) {
    const chord = context.slice.chord;
    if (
      !chord ||
      !supportsTendencyResolutionRules(context, chord) ||
      chord.identity.structure.kind !== "tertian"
    )
      return [];
    return chord.identity.structure.alterations.flatMap((alteration) => {
      if (!alteration.tendency) return [];
      const tendency = alteration.tendency;
      const tone = chordIdentityToneSpellingForDegree(
        chord.identity,
        alteration.degree,
      );
      if (!tone) return [];
      return moment.attackedVoiceIds.flatMap((voiceId) => {
        const note = context.slice.notes[voiceId];
        if (!note || !pitchClassEquals(note.pitch, tone)) return [];
        return [
          {
            partitionKey: `voice:${voiceId}|degree:${alteration.degree}`,
            payload: {
              voiceId,
              degree: alteration.degree,
              tendency,
              alteredMidi: toMidi(note.pitch),
            },
            subjectRefs: {
              voiceIds: [voiceId],
              noteIds: [note.id],
              chordIds: [chord.id],
              ...currentSpanRefs(context),
            },
          },
        ];
      });
    });
  },
};

function currentNote<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  return environment.context.slice.notes[environment.obligation.payload.voiceId];
}

function sourceNote<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  const id = environment.obligation.openedBy.noteIds?.[0];
  return id
    ? environment.context.rules
        .notes()
        .first(({ note }) => note.id === id)?.note
    : undefined;
}

export function transitionEvidence<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  const source = sourceNote(environment);
  const current = currentNote(environment);
  return {
    source,
    current,
    evidence:
      source && current
        ? [noteEvidence(source, "倾向音"), noteEvidence(current, "当前音")]
        : [],
    subjectRefs: {
      voiceIds: [environment.obligation.payload.voiceId],
      ...(current ? { noteIds: [current.id] } : {}),
      ...(environment.context.slice.chord
        ? { chordIds: [environment.context.slice.chord.id] }
        : {}),
    } satisfies SubjectRefs,
  };
}

export function leadingTargetUnchanged(
  environment: ObligationEnvironment<LeadingTonePayload>,
) {
  const payload = environment.obligation.payload;
  return (
    environment.context.slice.key.tonic.step === payload.sourceKeyStep &&
    environment.context.slice.key.tonic.alter === payload.sourceKeyAlter &&
    environment.context.slice.key.mode === payload.sourceKeyMode
  );
}

export function leadingToneResolves(
  environment: ObligationEnvironment<LeadingTonePayload>,
) {
  const current = currentNote(environment);
  const payload = environment.obligation.payload;
  return Boolean(
    current &&
      current.pitch.step === payload.targetStep &&
      current.pitch.alter === payload.targetAlter &&
      toMidi(current.pitch) - payload.leadingMidi === 1,
  );
}

function resolvesDownward<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
  sourceMidi: number,
) {
  const current = currentNote(environment);
  const targetChord = environment.context.slice.chord;
  if (!current || !targetChord) return false;
  const semitones = toMidi(current.pitch) - sourceMidi;
  return (
    (semitones === -1 || semitones === -2) &&
    hasExactPitch(current, chordIdentityToneSpellings(targetChord.identity))
  );
}

export function chordSeventhResolves(
  environment: ObligationEnvironment<SeventhPayload>,
) {
  return resolvesDownward(environment, environment.obligation.payload.seventhMidi);
}

export function dominantNinthResolves(
  environment: ObligationEnvironment<DominantNinthPayload>,
) {
  return resolvesDownward(environment, environment.obligation.payload.ninthMidi);
}

export function alteredToneResolves(
  environment: ObligationEnvironment<AlteredTonePayload>,
) {
  const current = currentNote(environment);
  const targetChord = environment.context.slice.chord;
  if (!current || !targetChord) return false;
  const payload = environment.obligation.payload;
  const expected = payload.tendency === "up" ? 1 : -1;
  return (
    toMidi(current.pitch) - payload.alteredMidi === expected &&
    hasExactPitch(current, chordIdentityToneSpellings(targetChord.identity))
  );
}
