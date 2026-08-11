import {
  chordIdentityToneSpellings,
  chordIdentityToneSpellingForDegree,
  primaryHarmonyInterpretation,
} from "../../../chordModel";
import type { VoiceId } from "../../../project/types";
import {
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  type SpelledPitchClass,
} from "../../../pitch";
import type { JsonValue, RuleStepContext } from "../../runtime";
import {
  defineFact,
  fact,
  factNo,
  factUnknown,
  factYes,
  type PredicateNode,
} from "../declarative/facts";
import type {
  ObligationEnvironment,
  ObligationSource,
} from "../declarative/obligation";
import { hasExactPitch, noteEvidence } from "../helpers/core";
import type { VoiceObligationPayload } from "./obligation";

export type LeadingTonePayload = VoiceObligationPayload & {
  readonly leadingMidi: number;
  readonly leadingStep: SpelledPitchClass["step"];
  readonly leadingAlter: SpelledPitchClass["alter"];
  readonly targetStep: SpelledPitchClass["step"];
  readonly targetAlter: SpelledPitchClass["alter"];
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
  chord: RuleStepContext["slice"]["chord"],
) {
  if (!chord) return true;
  return (
    chord.identity.structure.kind === "tertian" &&
    (!chord.semantics ||
      (chord.semantics.interpretations.length === 1 &&
        !chord.semantics.pedalContext))
  );
}

function leadingToneExpectation(context: RuleStepContext) {
  const interpretation = context.slice.chord?.semantics
    ? primaryHarmonyInterpretation(context.slice.chord.semantics)
    : undefined;
  const baseKey = interpretation?.localKey ?? context.slice.key;
  const targetTonic = interpretation?.appliedTarget
    ? scaleDegreePitchClass(baseKey, interpretation.appliedTarget.degree)
    : context.slice.key.tonic;
  const targetKey = interpretation?.appliedTarget
    ? { tonic: targetTonic, mode: "major" as const }
    : context.slice.key;
  return {
    leadingTone: scaleDegreePitchClass(
      targetKey,
      7,
      targetKey.mode === "minor" ? 1 : 0,
    ),
    targetTonic,
  };
}

function currentSpanRefs(context: RuleStepContext) {
  const spanId = context.analysis.sliceSpanIds.get(context.sliceIndex);
  return spanId ? { spanIds: [spanId] } : {};
}

export const leadingToneSource: ObligationSource<LeadingTonePayload> = {
  id: "source.leading-tone-attacks",
  requires: ["written-pitches"],
  collect({ context, moment }) {
    if (!supportsTendencyResolutionRules(context.slice.chord)) return [];
    const { leadingTone, targetTonic } = leadingToneExpectation(context);
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
    if (!chord || !supportsTendencyResolutionRules(chord)) return [];
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
      chord?.identity.structure.kind !== "tertian" ||
      chord.identity.structure.quality !== "dominant7" ||
      !chord.identity.structure.extensions.includes(9)
    )
      return [];
    const tones = chordIdentityToneSpellings(chord.identity);
    return moment.attackedVoiceIds.flatMap((voiceId) => {
      const note = context.slice.notes[voiceId];
      if (!note || !tones[4] || !pitchClassEquals(note.pitch, tones[4])) return [];
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
    if (chord?.identity.structure.kind !== "tertian") return [];
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

export function tendencyContextUnsupported<
  Payload extends VoiceObligationPayload,
>(): PredicateNode<ObligationEnvironment<Payload>> {
  return fact(
    defineFact({
      id: "tendency.context-unsupported",
      evaluate(environment: ObligationEnvironment<Payload>) {
        return supportsTendencyResolutionRules(environment.context.slice.chord)
          ? factNo("tendency-context-supported")
          : factYes("tendency-context-unsupported");
      },
    }),
  );
}

export function leadingTargetUnchanged(): PredicateNode<
  ObligationEnvironment<LeadingTonePayload>
> {
  return fact(
    defineFact({
      id: "tendency.leading-target-unchanged",
      requires: ["written-pitches"],
      evaluate(environment: ObligationEnvironment<LeadingTonePayload>) {
        const payload = environment.obligation.payload;
        const unchanged =
          environment.context.slice.key.tonic.step === payload.sourceKeyStep &&
          environment.context.slice.key.tonic.alter === payload.sourceKeyAlter &&
          environment.context.slice.key.mode === payload.sourceKeyMode;
        return unchanged
          ? factYes("leading-target-unchanged")
          : factNo("leading-target-changed");
      },
    }),
  );
}

function resolutionOptions<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  const sourceId = environment.obligation.openedBy.noteIds?.[0];
  const source = sourceId
    ? environment.context.analysis.noteById.get(sourceId)
    : undefined;
  const current = environment.context.slice.notes[environment.obligation.payload.voiceId];
  if (!source || !current) return undefined;
  return {
    source,
    current,
    options: {
      evidence: [noteEvidence(source, "倾向音"), noteEvidence(current, "当前音")],
      subjectRefs: {
        voiceIds: [environment.obligation.payload.voiceId],
        noteIds: [source.id, current.id],
      },
    },
  };
}

export function leadingToneResolves(): PredicateNode<
  ObligationEnvironment<LeadingTonePayload>
> {
  return fact(
    defineFact({
      id: "tendency.leading-tone-resolves",
      requires: ["written-pitches"],
      evaluate(environment: ObligationEnvironment<LeadingTonePayload>) {
        const notes = resolutionOptions(environment);
        if (!notes) return factUnknown("leading-resolution-notes-unavailable");
        const payload = environment.obligation.payload;
        const resolves =
          notes.current.pitch.step === payload.targetStep &&
          notes.current.pitch.alter === payload.targetAlter &&
          toMidi(notes.current.pitch) - payload.leadingMidi === 1;
        return resolves
          ? factYes("leading-tone-resolved", notes.options)
          : factNo("leading-tone-not-resolved", notes.options);
      },
    }),
  );
}

function downwardResolution<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
  sourceMidi: number,
  successReason: string,
  failureReason: string,
) {
  const notes = resolutionOptions(environment);
  const targetChord = environment.context.slice.chord;
  if (!notes || !targetChord)
    return factUnknown("downward-resolution-context-unavailable");
  const semitones = toMidi(notes.current.pitch) - sourceMidi;
  const resolves =
    (semitones === -1 || semitones === -2) &&
    hasExactPitch(notes.current, chordIdentityToneSpellings(targetChord.identity));
  const options = {
    ...notes.options,
    subjectRefs: {
      ...notes.options.subjectRefs,
      chordIds: [targetChord.id],
    },
  };
  return resolves
    ? factYes(successReason, options)
    : factNo(failureReason, options);
}

export function chordSeventhResolves(): PredicateNode<
  ObligationEnvironment<SeventhPayload>
> {
  return fact(
    defineFact({
      id: "tendency.chord-seventh-resolves",
      requires: ["written-pitches", "chords"],
      evaluate(environment: ObligationEnvironment<SeventhPayload>) {
        return downwardResolution(
          environment,
          environment.obligation.payload.seventhMidi,
          "chord-seventh-resolved",
          "chord-seventh-not-resolved",
        );
      },
    }),
  );
}

export function dominantNinthResolves(): PredicateNode<
  ObligationEnvironment<DominantNinthPayload>
> {
  return fact(
    defineFact({
      id: "tendency.dominant-ninth-resolves",
      requires: ["written-pitches", "chords"],
      evaluate(environment: ObligationEnvironment<DominantNinthPayload>) {
        return downwardResolution(
          environment,
          environment.obligation.payload.ninthMidi,
          "dominant-ninth-resolved",
          "dominant-ninth-not-resolved",
        );
      },
    }),
  );
}

export function alteredToneResolves(): PredicateNode<
  ObligationEnvironment<AlteredTonePayload>
> {
  return fact(
    defineFact({
      id: "tendency.altered-tone-resolves",
      requires: ["written-pitches", "chords"],
      evaluate(environment: ObligationEnvironment<AlteredTonePayload>) {
        const notes = resolutionOptions(environment);
        const targetChord = environment.context.slice.chord;
        if (!notes || !targetChord)
          return factUnknown("altered-resolution-context-unavailable");
        const payload = environment.obligation.payload;
        const expectedSemitones = payload.tendency === "up" ? 1 : -1;
        const semitones = toMidi(notes.current.pitch) - payload.alteredMidi;
        const resolves =
          semitones === expectedSemitones &&
          hasExactPitch(
            notes.current,
            chordIdentityToneSpellings(targetChord.identity),
          );
        const options = {
          ...notes.options,
          subjectRefs: {
            ...notes.options.subjectRefs,
            chordIds: [targetChord.id],
          },
        };
        return resolves
          ? factYes("altered-tone-resolved", options)
          : factNo("altered-tone-not-resolved", options);
      },
    }),
  );
}
