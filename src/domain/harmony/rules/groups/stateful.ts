import {
  chordIdentityToneSpellings,
  chordIdentityToneSpellingForDegree,
  primaryHarmonyInterpretation,
} from "../../../chordModel";
import type { RuleDiagnostic } from "../../../harmonyRuntime";
import type {
  JsonValue,
  RuleStateEnvelope,
  RuleStepContext,
  RuleStepResult,
} from "../../../harmonyRuntime";
import type { HarmonyRuleId } from "../../../harmonyRules";
import type { VoiceId } from "../../../model";
import {
  formatPitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
} from "../../../pitch";
import {
  chordEvidence,
  chordLabel,
  diagnostic,
  hasExactPitch,
  noteEvidence,
  supportsTertianResolutionRules,
} from "../helpers/core";

type LeadingToneState = {
  voiceId: VoiceId;
  sourceNoteId: string;
  sourceKeyId: string;
  sourceSpanId?: string;
  leadingMidi: number;
};

type SeventhState = {
  voiceId: VoiceId;
  sourceNoteId: string;
  sourceChordId: string;
  sourceSpanId?: string;
  seventhMidi: number;
};

type DominantNinthState = {
  voiceId: VoiceId;
  sourceNoteId: string;
  sourceChordId: string;
  sourceSpanId?: string;
  ninthMidi: number;
};

type AlteredToneState = {
  voiceId: VoiceId;
  sourceNoteId: string;
  sourceChordId: string;
  sourceSpanId?: string;
  degree: 5 | 9 | 11 | 13;
  tendency: "up" | "down";
  alteredMidi: number;
};

type SecondaryDominantState = {
  sourceSpanId: string;
  sourceChordId: string;
  sourceToTick: number;
  targetDegree: number;
};

function makeRuleState<T extends JsonValue>(
  ruleId: HarmonyRuleId,
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

export function leadingToneStateStep(
  context: RuleStepContext,
  incoming: readonly RuleStateEnvelope[],
): RuleStepResult {
  const diagnostics: RuleDiagnostic[] = [];
  const outgoing: RuleStateEnvelope[] = [];
  const currentSpanId = context.analysis.sliceSpanIds.get(context.sliceIndex);
  incoming.forEach((state) => {
    if (!supportsTertianResolutionRules(context.slice.chord)) return;
    const payload = state.payload as LeadingToneState;
    if (payload.sourceKeyId !== context.slice.key.id) return;
    const active = context.slice.notes[payload.voiceId];
    // 声部进入休止后，后续起音已不再是可直接归属本次导音的解决音。
    // 证据链在此中断并静默消费，避免跨休止关联到无关音符。
    if (context.previous?.notes[payload.voiceId] && !active) return;
    const current =
      context.slice.attackVoiceIds.includes(payload.voiceId) ||
      (payload.sourceSpanId !== undefined &&
        payload.sourceSpanId !== currentSpanId)
        ? active
        : undefined;
    const sameSpan = Boolean(
      payload.sourceSpanId &&
        currentSpanId &&
        payload.sourceSpanId === currentSpanId,
    );
    if (!current || sameSpan) {
      outgoing.push(state);
      return;
    }
    const resolves =
      pitchClassEquals(current.pitch, context.slice.key.tonic) &&
      toMidi(current.pitch) - payload.leadingMidi === 1;
    if (!resolves) {
      const source = context.analysis.noteById.get(payload.sourceNoteId);
      if (source) {
        const leadingTone = scaleDegreePitchClass(
          context.slice.key,
          7,
          context.slice.key.mode === "minor" ? 1 : 0,
        );
        diagnostics.push(
          diagnostic(
            "resolution.leading-tone",
            current.startTick,
            current.startTick + current.durationTicks,
            [payload.voiceId],
            [source, current],
            "导音未上行解决",
            "书写导音 " +
              formatPitchClass(leadingTone) +
              " 通常应上行半音解决到主音。",
            {
              params: {
                key:
                  formatPitchClass(context.slice.key.tonic) +
                  " " +
                  context.slice.key.mode,
                leadingTone: formatPitchClass(leadingTone),
              },
              evidence: [
                noteEvidence(source, "导音"),
                noteEvidence(current, "后继音"),
                {
                  kind: "key",
                  id: context.slice.key.id,
                  label: "局部调性",
                  value:
                    formatPitchClass(context.slice.key.tonic) +
                    " " +
                    context.slice.key.mode,
                },
              ],
            },
          ),
        );
      }
    }
  });
  context.slice.attackVoiceIds.forEach((voiceId) => {
    const note = context.slice.notes[voiceId];
    if (!note) return;
    if (!supportsTertianResolutionRules(context.slice.chord)) return;
    const alreadyPending = outgoing.some(
      (state) => (state.payload as LeadingToneState).voiceId === voiceId,
    );
    const leadingTone = scaleDegreePitchClass(
      context.slice.key,
      7,
      context.slice.key.mode === "minor" ? 1 : 0,
    );
    if (!alreadyPending && pitchClassEquals(note.pitch, leadingTone)) {
      outgoing.push(
        makeRuleState(
          "resolution.leading-tone",
          context,
          "leading-tone:" + voiceId + ":" + note.id,
          {
            voiceId,
            sourceNoteId: note.id,
            sourceKeyId: context.slice.key.id,
            ...(currentSpanId ? { sourceSpanId: currentSpanId } : {}),
            leadingMidi: toMidi(note.pitch),
          } as unknown as JsonValue,
          {
            voiceIds: [voiceId],
            noteIds: [note.id],
            spanIds: currentSpanId ? [currentSpanId] : [],
          },
        ),
      );
    }
  });
  return stateStep(diagnostics, outgoing);
}

export function seventhStateStep(
  context: RuleStepContext,
  incoming: readonly RuleStateEnvelope[],
): RuleStepResult {
  const diagnostics: RuleDiagnostic[] = [];
  const outgoing: RuleStateEnvelope[] = [];
  const currentSpanId = context.analysis.sliceSpanIds.get(context.sliceIndex);
  incoming.forEach((state) => {
    if (!supportsTertianResolutionRules(context.slice.chord)) return;
    const payload = state.payload as SeventhState;
    const active = context.slice.notes[payload.voiceId];
    // 七音解决同样要求连续的声部线条；休止会终止本次待判定状态。
    if (context.previous?.notes[payload.voiceId] && !active) return;
    const current =
      context.slice.attackVoiceIds.includes(payload.voiceId) ||
      (payload.sourceSpanId !== undefined &&
        payload.sourceSpanId !== currentSpanId)
        ? active
        : undefined;
    const sameSpan = Boolean(
      payload.sourceSpanId &&
        currentSpanId &&
        payload.sourceSpanId === currentSpanId,
    );
    if (!current || sameSpan) {
      outgoing.push(state);
      return;
    }
    const resolution = toMidi(current.pitch) - payload.seventhMidi;
    if (resolution !== -1 && resolution !== -2) {
      const source = context.analysis.noteById.get(payload.sourceNoteId);
      const chord = context.analysis.chordById.get(payload.sourceChordId);
      if (source && chord) {
        const tones = chordIdentityToneSpellings(chord.identity);
        diagnostics.push(
          diagnostic(
            "resolution.chord-seventh",
            current.startTick,
            current.startTick + current.durationTicks,
            [payload.voiceId],
            [source, current],
            "七音未级进下行解决",
            "书写七音 " +
              formatPitchClass(tones[3]) +
              " 通常应以半音或全音级进下行解决。",
            {
              chordIds: [chord.id],
              evidence: [
                chordEvidence(chord),
                noteEvidence(source, "和弦七音"),
                noteEvidence(current, "后继音"),
              ],
            },
          ),
        );
      }
    }
  });
  context.slice.attackVoiceIds.forEach((voiceId) => {
    const note = context.slice.notes[voiceId];
    const chord = context.slice.chord;
    if (!note || !chord || !supportsTertianResolutionRules(chord)) return;
    const tones = chordIdentityToneSpellings(chord.identity);
    if (tones.length !== 4 || !pitchClassEquals(note.pitch, tones[3])) return;
    const alreadyPending = outgoing.some(
      (state) => (state.payload as SeventhState).voiceId === voiceId,
    );
    if (alreadyPending) return;
    outgoing.push(
      makeRuleState(
        "resolution.chord-seventh",
        context,
        "chord-seventh:" + voiceId + ":" + note.id,
        {
          voiceId,
          sourceNoteId: note.id,
          sourceChordId: chord.id,
          ...(currentSpanId ? { sourceSpanId: currentSpanId } : {}),
          seventhMidi: toMidi(note.pitch),
        } as unknown as JsonValue,
        {
          voiceIds: [voiceId],
          noteIds: [note.id],
          chordIds: [chord.id],
          spanIds: currentSpanId ? [currentSpanId] : [],
        },
      ),
    );
  });
  return stateStep(diagnostics, outgoing);
}

export function dominantNinthStateStep(
  context: RuleStepContext,
  incoming: readonly RuleStateEnvelope[],
): RuleStepResult {
  const diagnostics: RuleDiagnostic[] = [];
  const outgoing: RuleStateEnvelope[] = [];
  const currentSpanId = context.analysis.sliceSpanIds.get(context.sliceIndex);

  incoming.forEach((state) => {
    const payload = state.payload as DominantNinthState;
    const active = context.slice.notes[payload.voiceId];
    // 解决状态只沿同一条连续声部传递；休止会切断证据链，不能把更晚的音误认作本次解决。
    if (context.previous?.notes[payload.voiceId] && !active) return;
    const sameSpan = Boolean(
      payload.sourceSpanId &&
        currentSpanId &&
        payload.sourceSpanId === currentSpanId,
    );
    if (sameSpan || !active) {
      outgoing.push(state);
      return;
    }

    const source = context.analysis.noteById.get(payload.sourceNoteId);
    const sourceChord = context.analysis.chordById.get(payload.sourceChordId);
    const targetChord = context.slice.chord;
    // 没有目标和弦时无法确认“解决到目标和弦音”，因此静默结束本条状态，避免只凭音程误报。
    if (!source || !sourceChord || !targetChord) return;
    const targetTones = chordIdentityToneSpellings(targetChord.identity);
    const resolution = toMidi(active.pitch) - payload.ninthMidi;
    const resolves =
      (resolution === -1 || resolution === -2) &&
      hasExactPitch(active, targetTones);
    if (!resolves) {
      const sourceTones = chordIdentityToneSpellings(sourceChord.identity);
      diagnostics.push(
        diagnostic(
          "resolution.dominant-ninth",
          active.startTick,
          active.startTick + active.durationTicks,
          [payload.voiceId],
          [source, active],
          "属九音未级进下行解决",
          `${chordLabel(sourceChord)} 的九音 ${formatPitchClass(sourceTones[4])} 应在离开属九和弦时级进下行到目标和弦音。`,
          {
            chordIds: [sourceChord.id, targetChord.id],
            params: {
              resolutionSemitones: resolution,
              targetChord: chordLabel(targetChord),
            },
            evidence: [
              chordEvidence(sourceChord),
              noteEvidence(source, "属九音"),
              chordEvidence(targetChord),
              noteEvidence(active, "后继音"),
            ],
          },
        ),
      );
    }
  });

  const chord = context.slice.chord;
  if (
    chord?.identity.structure.kind === "tertian" &&
    chord.identity.structure.quality === "dominant7" &&
    chord.identity.structure.extensions.includes(9)
  ) {
    const tones = chordIdentityToneSpellings(chord.identity);
    context.slice.attackVoiceIds.forEach((voiceId) => {
      const note = context.slice.notes[voiceId];
      if (!note || !pitchClassEquals(note.pitch, tones[4])) return;
      const alreadyPending = outgoing.some(
        (state) => (state.payload as DominantNinthState).voiceId === voiceId,
      );
      if (alreadyPending) return;
      outgoing.push(
        makeRuleState(
          "resolution.dominant-ninth",
          context,
          "dominant-ninth:" + voiceId + ":" + note.id,
          {
            voiceId,
            sourceNoteId: note.id,
            sourceChordId: chord.id,
            ...(currentSpanId ? { sourceSpanId: currentSpanId } : {}),
            ninthMidi: toMidi(note.pitch),
          } as unknown as JsonValue,
          {
            voiceIds: [voiceId],
            noteIds: [note.id],
            chordIds: [chord.id],
            spanIds: currentSpanId ? [currentSpanId] : [],
          },
        ),
      );
    });
  }
  return stateStep(diagnostics, outgoing);
}

export function alteredToneStateStep(
  context: RuleStepContext,
  incoming: readonly RuleStateEnvelope[],
): RuleStepResult {
  const diagnostics: RuleDiagnostic[] = [];
  const outgoing: RuleStateEnvelope[] = [];
  const currentSpanId = context.analysis.sliceSpanIds.get(context.sliceIndex);

  incoming.forEach((state) => {
    const payload = state.payload as AlteredToneState;
    const active = context.slice.notes[payload.voiceId];
    // 变化音义务属于发出该音的声部；休止会终止这条横向证据链。
    if (context.previous?.notes[payload.voiceId] && !active) return;
    const sameSpan = Boolean(
      payload.sourceSpanId &&
        currentSpanId &&
        payload.sourceSpanId === currentSpanId,
    );
    if (sameSpan || !active) {
      outgoing.push(state);
      return;
    }

    const source = context.analysis.noteById.get(payload.sourceNoteId);
    const sourceChord = context.analysis.chordById.get(payload.sourceChordId);
    const targetChord = context.slice.chord;
    if (!source || !sourceChord || !targetChord) return;
    const expectedSemitones = payload.tendency === "up" ? 1 : -1;
    const actualSemitones = toMidi(active.pitch) - payload.alteredMidi;
    const resolves =
      actualSemitones === expectedSemitones &&
      hasExactPitch(active, chordIdentityToneSpellings(targetChord.identity));
    if (!resolves) {
      diagnostics.push(
        diagnostic(
          "resolution.altered-tone",
          active.startTick,
          active.startTick + active.durationTicks,
          [payload.voiceId],
          [source, active],
          "变化倾向音未按标注方向解决",
          `${chordLabel(sourceChord)} 的变化构成音已标注为${payload.tendency === "up" ? "上行" : "下行"}倾向，应以半音解决到目标和弦音。`,
          {
            chordIds: [sourceChord.id, targetChord.id],
            params: {
              degree: payload.degree,
              tendency: payload.tendency,
              actualSemitones,
            },
            evidence: [
              chordEvidence(sourceChord),
              noteEvidence(source, "变化倾向音"),
              chordEvidence(targetChord),
              noteEvidence(active, "后继音"),
            ],
          },
        ),
      );
    }
  });

  const chord = context.slice.chord;
  if (chord?.identity.structure.kind === "tertian") {
    chord.identity.structure.alterations.forEach((alteration) => {
      if (!alteration.tendency) return;
      const tone = chordIdentityToneSpellingForDegree(
        chord.identity,
        alteration.degree,
      );
      if (!tone) return;
      context.slice.attackVoiceIds.forEach((voiceId) => {
        const note = context.slice.notes[voiceId];
        if (!note || !pitchClassEquals(note.pitch, tone)) return;
        const alreadyPending = outgoing.some((state) => {
          const payload = state.payload as AlteredToneState;
          return payload.voiceId === voiceId && payload.degree === alteration.degree;
        });
        if (alreadyPending) return;
        outgoing.push(
          makeRuleState(
            "resolution.altered-tone",
            context,
            `altered-tone:${alteration.degree}:${voiceId}:${note.id}`,
            {
              voiceId,
              sourceNoteId: note.id,
              sourceChordId: chord.id,
              ...(currentSpanId ? { sourceSpanId: currentSpanId } : {}),
              degree: alteration.degree,
              tendency: alteration.tendency,
              alteredMidi: toMidi(note.pitch),
            } as unknown as JsonValue,
            {
              voiceIds: [voiceId],
              noteIds: [note.id],
              chordIds: [chord.id],
              spanIds: currentSpanId ? [currentSpanId] : [],
            },
          ),
        );
      });
    });
  }
  return stateStep(diagnostics, outgoing);
}

export function secondaryDominantStateStep(
  context: RuleStepContext,
  incoming: readonly RuleStateEnvelope[],
): RuleStepResult {
  const diagnostics: RuleDiagnostic[] = [];
  const outgoing: RuleStateEnvelope[] = [];
  if (context.isSpanStart && context.span) {
    incoming.forEach((state) => {
      const payload = state.payload as SecondaryDominantState;
      const connection = context.analysis.connections.find(
        (candidate) =>
          candidate.previousSpanId === payload.sourceSpanId &&
          candidate.currentSpanId === context.span!.id,
      );
      const resolves = Boolean(
        connection?.relation === "applied-target" &&
          connection.targetMatched &&
          connection.contiguous &&
          connection.sameKey,
      );
      if (!resolves) {
        const previous = context.analysis.chordById.get(payload.sourceChordId);
        const current = context.span?.regionIds
          .map((id) => context.analysis.chordById.get(id))
          .find(Boolean);
        if (
          previous &&
          current &&
          connection?.contiguous &&
          connection.sameKey
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
          } as unknown as JsonValue,
          { chordIds: [chord.id], spanIds: [context.span.id] },
        ),
      );
    }
  }
  return stateStep(diagnostics, outgoing);
}
