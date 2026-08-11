import type { VoiceId } from "../../../project/types";
import type { JsonValue } from "../../runtime";
import {
  defineFact,
  fact,
  factNo,
  factUnknown,
  factYes,
  type PredicateNode,
} from "../declarative/facts";
import type { ObligationEnvironment } from "../declarative/obligation";
import { noteEvidence } from "../helpers/core";

export type VoiceObligationPayload = {
  readonly [key: string]: JsonValue;
  readonly voiceId: VoiceId;
};

function subjectNote<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  return environment.context.slice.notes[
    environment.obligation.payload.voiceId
  ];
}

function sourceNote<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  const noteId = environment.obligation.openedBy.noteIds?.[0];
  return noteId ? environment.context.analysis.noteById.get(noteId) : undefined;
}

export function subjectVoiceAttacked<
  Payload extends VoiceObligationPayload,
>(): PredicateNode<ObligationEnvironment<Payload>> {
  return fact(
    defineFact({
      id: "obligation.subject-voice-attacked",
      requires: ["written-pitches"],
      evaluate(environment: ObligationEnvironment<Payload>) {
        const voiceId = environment.obligation.payload.voiceId;
        const note = subjectNote(environment);
        const spanId = environment.context.analysis.sliceSpanIds.get(
          environment.context.sliceIndex,
        );
        return environment.moment.attackedVoiceIds.includes(voiceId)
          ? factYes("subject-voice-attacked", {
              ...(note ? { evidence: [noteEvidence(note, "当前起奏音")] } : {}),
              subjectRefs: {
                voiceIds: [voiceId],
                ...(note ? { noteIds: [note.id] } : {}),
                ...(spanId ? { spanIds: [spanId] } : {}),
              },
            })
          : factNo("subject-voice-not-attacked", {
              subjectRefs: { voiceIds: [voiceId] },
            });
      },
    }),
  );
}

export function subjectVoiceEnteredRest<
  Payload extends VoiceObligationPayload,
>(): PredicateNode<ObligationEnvironment<Payload>> {
  return fact(
    defineFact({
      id: "obligation.subject-voice-entered-rest",
      requires: ["written-pitches"],
      evaluate(environment: ObligationEnvironment<Payload>) {
        const voiceId = environment.obligation.payload.voiceId;
        return environment.moment.enteredRestVoiceIds.includes(voiceId)
          ? factYes("subject-voice-entered-rest", {
              subjectRefs: { voiceIds: [voiceId] },
            })
          : factNo("subject-voice-remains-continuous", {
              subjectRefs: { voiceIds: [voiceId] },
            });
      },
    }),
  );
}

export function harmonyChanged<Payload extends JsonValue>(): PredicateNode<
  ObligationEnvironment<Payload>
> {
  return fact(
    defineFact({
      id: "obligation.harmony-changed",
      evaluate(environment: ObligationEnvironment<Payload>) {
        return environment.moment.harmonyChange
          ? factYes("harmony-changed", {
              subjectRefs: {
                spanIds: [
                  environment.moment.harmonyChange.previousSpanId,
                  environment.moment.harmonyChange.currentSpanId,
                ].filter((id): id is string => Boolean(id)),
              },
            })
          : factNo("harmony-unchanged");
      },
    }),
  );
}

export function subjectHasActiveNote<
  Payload extends VoiceObligationPayload,
>(): PredicateNode<ObligationEnvironment<Payload>> {
  return fact(
    defineFact({
      id: "obligation.subject-has-active-note",
      requires: ["written-pitches"],
      evaluate(environment: ObligationEnvironment<Payload>) {
        const voiceId = environment.obligation.payload.voiceId;
        const note = subjectNote(environment);
        return note
          ? factYes("subject-has-active-note", {
              evidence: [noteEvidence(note, "当前音")],
              subjectRefs: { voiceIds: [voiceId], noteIds: [note.id] },
            })
          : factNo("subject-has-no-active-note", {
              subjectRefs: { voiceIds: [voiceId] },
            });
      },
    }),
  );
}

export function targetChordAvailable<
  Payload extends JsonValue,
>(): PredicateNode<ObligationEnvironment<Payload>> {
  return fact(
    defineFact({
      id: "obligation.target-chord-available",
      requires: ["chords"],
      evaluate(environment: ObligationEnvironment<Payload>) {
        const chord = environment.context.slice.chord;
        return chord
          ? factYes("target-chord-available", {
              subjectRefs: { chordIds: [chord.id] },
            })
          : factNo("target-chord-missing");
      },
    }),
  );
}

export function sameOpenedHarmonySpan<
  Payload extends JsonValue,
>(): PredicateNode<ObligationEnvironment<Payload>> {
  return fact(
    defineFact({
      id: "obligation.same-opened-harmony-span",
      evaluate(environment: ObligationEnvironment<Payload>) {
        const openedSpanId = environment.obligation.openedBy.spanIds?.[0];
        const currentSpanId = environment.context.analysis.sliceSpanIds.get(
          environment.context.sliceIndex,
        );
        if (!openedSpanId || !currentSpanId)
          return factNo("not-in-opened-harmony-span", {
            subjectRefs: {
              spanIds: [openedSpanId, currentSpanId].filter(
                (id): id is string => Boolean(id),
              ),
            },
          });
        return openedSpanId === currentSpanId
          ? factYes("same-opened-harmony-span", {
              subjectRefs: { spanIds: [openedSpanId] },
            })
          : factNo("left-opened-harmony-span", {
              subjectRefs: { spanIds: [openedSpanId, currentSpanId] },
            });
      },
    }),
  );
}

export function sameWrittenPitchAsSource<
  Payload extends VoiceObligationPayload,
>(): PredicateNode<ObligationEnvironment<Payload>> {
  return fact(
    defineFact({
      id: "obligation.same-written-pitch-as-source",
      requires: ["written-pitches"],
      evaluate(environment: ObligationEnvironment<Payload>) {
        const source = sourceNote(environment);
        const current = subjectNote(environment);
        if (!source || !current)
          return factUnknown("source-or-current-note-unavailable");
        const same =
          source.pitch.step === current.pitch.step &&
          source.pitch.alter === current.pitch.alter &&
          source.pitch.octave === current.pitch.octave;
        const options = {
          evidence: [
            noteEvidence(source, "义务来源音"),
            noteEvidence(current, "当前音"),
          ],
          subjectRefs: {
            voiceIds: [environment.obligation.payload.voiceId],
            noteIds: [source.id, current.id],
          },
        };
        return same
          ? factYes("same-written-pitch-as-source", options)
          : factNo("written-pitch-changed", options);
      },
    }),
  );
}
