import {
  chordIdentityToneSpellings,
  chordIdentityToneSpellingForDegree,
  chordVoicingPolicy,
  harmonySemanticsCompatibleWithIdentity,
  primaryHarmonyInterpretation,
} from "./chordModel";
import { formatChordIdentity } from "./chords";
import {
  analysisChordAtTick,
  analysisKeyAtTick,
  type AnalysisChord,
  type AnalysisNote,
  type HarmonyAnalysis,
  type MelodyTransition,
} from "./harmonyAnalysis";
import {
  RuleScheduler,
  runRulesSynchronously,
  type DiagnosticEvidence,
  type HarmonyCheckResult,
  type HarmonyDiagnostic,
  type RuleDefinition,
  type RuleDiagnostic,
  type RuleEvaluation,
  type RuleConfig,
  type JsonValue,
  type RuleStateEnvelope,
  type RuleStepContext,
  type RuleStepResult,
} from "./harmonyRuntime";
import {
  HARMONY_RULE_DEFINITIONS,
  defaultHarmonyRuleSeverities,
  type DiagnosticSeverity,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
  type RuleExceptionContext,
  type RuleExceptionPolicy,
} from "./harmonyRules";
import {
  VOICE_CONFIG,
  VOICE_ORDER,
  type ProjectDocument,
  type VoiceId,
} from "./model";
import {
  formatPitchClass,
  formatSpelledPitch,
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  writtenInterval,
  type SpelledPitchClass,
  type WrittenInterval,
} from "./pitch";
import { bassMotionFact } from "./rules/sharedFacts";

export type {
  DiagnosticEvidence,
  HarmonyCheckResult,
  HarmonyDiagnostic,
  RuleDefinition,
} from "./harmonyRuntime";
export type { DiagnosticSeverity } from "./harmonyRules";

function evaluation(diagnostics: RuleDiagnostic[]): RuleEvaluation {
  return { diagnostics };
}

function diagnostic(
  ruleId: HarmonyRuleId,
  tick: number,
  endTick: number,
  voiceIds: VoiceId[],
  notes: readonly AnalysisNote[],
  title: string,
  message: string,
  options: {
    chordIds?: string[];
    messageKey?: string;
    params?: Record<string, string | number | boolean>;
    evidence?: DiagnosticEvidence[];
    confidence?: number;
    exceptionContexts?: RuleExceptionContext[];
  } = {},
): RuleDiagnostic {
  return {
    ruleId,
    source: "builtin",
    tick,
    endTick,
    voiceIds,
    noteIds: notes.map((note) => note.id),
    chordIds: options.chordIds ?? [],
    title,
    message,
    messageKey: options.messageKey ?? ruleId,
    params: options.params ?? {},
    evidence: options.evidence ?? [],
    confidence: options.confidence ?? 1,
    exceptionContexts: options.exceptionContexts,
  };
}

function pitchClass(value: number) {
  return ((value % 12) + 12) % 12;
}

function direction(from: number, to: number) {
  return Math.sign(to - from);
}

function intervalMod12(value: number) {
  return ((value % 12) + 12) % 12;
}

function isWrittenFifth(interval: WrittenInterval, semitones: number) {
  return (
    Math.abs(interval.diatonicSteps) % 7 === 4 &&
    intervalMod12(interval.semitones) === semitones
  );
}

function isPerfectFifth(interval: WrittenInterval) {
  return isWrittenFifth(interval, 7);
}

function isDiminishedFifth(interval: WrittenInterval) {
  return isWrittenFifth(interval, 6);
}

function chordLabel(chord: AnalysisChord) {
  return formatChordIdentity(
    chord.identity as Parameters<typeof formatChordIdentity>[0],
    chord.semantics as Parameters<typeof formatChordIdentity>[1],
  ).roman;
}

function supportsTertianResolutionRules(chord: AnalysisChord | undefined) {
  if (!chord) return true;
  return (
    chord.identity.structure.kind === "tertian" &&
    !chord.identity.structure.extensions.some((extension) => extension >= 9) &&
    (!chord.semantics ||
      (chord.semantics.interpretations.length === 1 &&
        !chord.semantics.pedalContext))
  );
}

function voiceName(analysis: HarmonyAnalysis, voiceId: VoiceId) {
  return (
    analysis.project.satbTracks.find((track) => track.id === voiceId)?.name ??
    VOICE_CONFIG[voiceId].name
  );
}

function noteEvidence(note: AnalysisNote, label = "音符"): DiagnosticEvidence {
  return {
    kind: "note",
    id: note.id,
    label,
    value: formatSpelledPitch(note.pitch),
  };
}

function chordEvidence(chord: AnalysisChord): DiagnosticEvidence {
  return {
    kind: "chord",
    id: chord.id,
    label: "和弦",
    value: chordLabel(chord),
  };
}

function intervalName(interval: WrittenInterval) {
  const diatonic = Math.abs(interval.diatonicSteps);
  const semitones = Math.abs(interval.semitones);
  const simpleIndex = diatonic % 7;
  const octaveCount = Math.floor(diatonic / 7);
  const number = diatonic + 1;
  const baseSemitones = [0, 2, 4, 5, 7, 9, 11][simpleIndex] + octaveCount * 12;
  const difference = semitones - baseSemitones;
  const perfectClass = [0, 3, 4].includes(simpleIndex);
  const quality = perfectClass
    ? difference === 0
      ? "纯"
      : difference > 0
        ? "增"
        : "减"
    : difference === 0
      ? "大"
      : difference === -1
        ? "小"
        : difference > 0
          ? "增"
          : "减";
  return {
    number,
    quality,
    label: `${quality}${number}度`,
    altered: quality === "增" || quality === "减",
  };
}

function hasExactPitch(
  note: AnalysisNote,
  spellings: readonly SpelledPitchClass[],
) {
  return spellings.some((tone) => pitchClassEquals(note.pitch, tone));
}

function finalSameHarmonySlice(analysis: HarmonyAnalysis, sliceIndex: number) {
  const current = analysis.slices[sliceIndex];
  const next = analysis.slices[sliceIndex + 1];
  return Boolean(
    next &&
    current.chord &&
    next.chord &&
    analysis.sliceTransitions[sliceIndex]?.sameHarmony,
  );
}

function activeNotes(slice: HarmonyAnalysis["slices"][number]) {
  return VOICE_ORDER.map((voiceId) => ({
    voiceId,
    note: slice.notes[voiceId],
  })).filter((item): item is { voiceId: VoiceId; note: AnalysisNote } =>
    Boolean(item.note),
  );
}

function voiceRangeRule(analysis: HarmonyAnalysis, config: RuleConfig = {}) {
  const diagnostics: RuleDiagnostic[] = [];
  VOICE_ORDER.forEach((voiceId) =>
    analysis.notesByVoice[voiceId].forEach((note) => {
      const range = VOICE_CONFIG[voiceId];
      const configuredRange = config[voiceId];
      const configuredMin =
        configuredRange &&
        typeof configuredRange === "object" &&
        "minMidi" in configuredRange
          ? configuredRange.minMidi
          : undefined;
      const configuredMax =
        configuredRange &&
        typeof configuredRange === "object" &&
        "maxMidi" in configuredRange
          ? configuredRange.maxMidi
          : undefined;
      const minimum =
        typeof configuredMin === "number" && Number.isFinite(configuredMin)
          ? configuredMin
          : range.min;
      const maximum =
        typeof configuredMax === "number" && Number.isFinite(configuredMax)
          ? configuredMax
          : range.max;
      const midi = toMidi(note.pitch);
      if (midi < minimum || midi > maximum) {
        diagnostics.push(
          diagnostic(
            "voice.range",
            note.startTick,
            note.startTick + note.durationTicks,
            [voiceId],
            [note],
            "超出建议音域",
            `${voiceName(analysis, voiceId)}建议使用 MIDI ${range.min}-${range.max}，当前音高为 ${formatSpelledPitch(note.pitch)}（MIDI ${midi}）。`,
            {
              params: { midi, minimum, maximum },
              evidence: [noteEvidence(note)],
            },
          ),
        );
      }
    }),
  );
  return diagnostics;
}

function noteOverlapRule(analysis: HarmonyAnalysis) {
  return analysis.melodyTransitions.flatMap((transition) =>
    transition.current.startTick <
    transition.previous.startTick + transition.previous.durationTicks
      ? [
          diagnostic(
            "voice.polyphonic-overlap",
            transition.current.startTick,
            transition.current.startTick + transition.current.durationTicks,
            [transition.voiceId],
            [transition.previous, transition.current],
            "同声部音符重叠",
            `${voiceName(analysis, transition.voiceId)}中存在时间上互相重叠的音符。`,
            {
              evidence: [
                noteEvidence(transition.previous, "前一音"),
                noteEvidence(transition.current, "当前音"),
              ],
            },
          ),
        ]
      : [],
  );
}

function validMelodyTransitions(analysis: HarmonyAnalysis) {
  return analysis.melodyTransitions.filter(
    (transition) =>
      transition.current.startTick >=
      transition.previous.startTick + transition.previous.durationTicks,
  );
}

function melodicLeapRule(
  analysis: HarmonyAnalysis,
  ruleId: "melody.leap-over-octave" | "melody.large-leap" | "melody.tritone",
) {
  const diagnostics: RuleDiagnostic[] = [];
  validMelodyTransitions(analysis).forEach((transition) => {
    const interval = Math.abs(transition.writtenInterval.semitones);
    const matches =
      ruleId === "melody.leap-over-octave"
        ? interval > 12
        : ruleId === "melody.large-leap"
          ? interval > 7 && interval <= 12
          : interval === 6;
    if (!matches) return;
    const title =
      ruleId === "melody.leap-over-octave"
        ? "旋律跳进过大"
        : ruleId === "melody.large-leap"
          ? "较大旋律跳进"
          : "旋律三全音";
    const message =
      ruleId === "melody.leap-over-octave"
        ? `${voiceName(analysis, transition.voiceId)}出现超过八度的跳进（${interval} 个半音）。`
        : ruleId === "melody.large-leap"
          ? `${voiceName(analysis, transition.voiceId)}出现大于纯五度的跳进，需检查前后旋律方向。`
          : `${voiceName(analysis, transition.voiceId)}出现三全音跳进。`;
    const writtenName = intervalName(transition.writtenInterval);
    diagnostics.push(
      diagnostic(
        ruleId,
        transition.current.startTick,
        transition.current.startTick + transition.current.durationTicks,
        [transition.voiceId],
        [transition.previous, transition.current],
        title,
        message,
        {
          params: { semitones: interval },
          evidence: [
            noteEvidence(transition.previous, "前一音"),
            noteEvidence(transition.current, "当前音"),
            {
              kind: "interval",
              label: ruleId === "melody.tritone" ? "书写音程" : "音程",
              value:
                ruleId === "melody.tritone"
                  ? writtenName.label
                  : `${interval} 个半音`,
            },
          ],
          exceptionContexts:
            transition.sameHarmony && ruleId !== "melody.leap-over-octave"
              ? ["same-harmony"]
              : undefined,
        },
      ),
    );
  });
  return diagnostics;
}

function augmentedDiminishedIntervalRule(
  analysis: HarmonyAnalysis,
  ruleId: "melody.augmented-interval" | "melody.diminished-interval",
) {
  const diagnostics: RuleDiagnostic[] = [];
  validMelodyTransitions(analysis).forEach((transition) => {
    const named = intervalName(transition.writtenInterval);
    const expectedQuality =
      ruleId === "melody.augmented-interval" ? "增" : "减";
    if (
      !named.altered ||
      named.quality !== expectedQuality ||
      Math.abs(transition.writtenInterval.semitones) === 0
    )
      return;
    diagnostics.push(
      diagnostic(
        ruleId,
        transition.current.startTick,
        transition.current.startTick + transition.current.durationTicks,
        [transition.voiceId],
        [transition.previous, transition.current],
        "旋律出现增减音程",
        `${voiceName(analysis, transition.voiceId)}的 ${formatSpelledPitch(transition.previous.pitch)} 到 ${formatSpelledPitch(transition.current.pitch)} 构成${named.label}。`,
        {
          messageKey: `${ruleId}.${named.quality}`,
          params: {
            intervalNumber: named.number,
            quality: named.quality,
            semitones: Math.abs(transition.writtenInterval.semitones),
          },
          evidence: [
            noteEvidence(transition.previous, "前一音"),
            noteEvidence(transition.current, "当前音"),
            { kind: "interval", label: "书写音程", value: named.label },
          ],
          exceptionContexts: transition.sameHarmony
            ? ["same-harmony"]
            : undefined,
        },
      ),
    );
  });
  return diagnostics;
}

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

function leadingToneStateStep(
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

function seventhStateStep(
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

function dominantNinthStateStep(
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

function alteredToneStateStep(
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

function secondaryDominantStateStep(
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
function crossRelationRule(
  analysis: HarmonyAnalysis,
  ruleId:
    | "voice-leading.cross-relation-simultaneous"
    | "voice-leading.cross-relation-successive",
  config: RuleConfig,
) {
  const configuredWindow = config.window;
  const windowTicks =
    configuredWindow && typeof configuredWindow === "object" &&
    "value" in configuredWindow && "unit" in configuredWindow
      ? Math.max(
          0,
          Math.floor(
            configuredWindow.value *
              (configuredWindow.unit === "ticks"
                ? 1
                : configuredWindow.unit === "beats"
                  ? analysis.project.ppq
                  : analysis.project.ppq * 4),
          ),
        )
      : analysis.project.ppq;
  const notes = VOICE_ORDER.flatMap((voiceId) =>
    analysis.notesByVoice[voiceId].map((note) => ({ voiceId, note })),
  ).sort(
    (left, right) =>
      left.note.startTick - right.note.startTick ||
      left.voiceId.localeCompare(right.voiceId),
  );
  const diagnostics: RuleDiagnostic[] = [];

  for (let leftIndex = 0; leftIndex < notes.length; leftIndex += 1) {
    const left = notes[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < notes.length;
      rightIndex += 1
    ) {
      const right = notes[rightIndex];
      if (
        right.note.startTick - (left.note.startTick + left.note.durationTicks) >
        windowTicks
      )
        break;
      if (left.voiceId === right.voiceId) continue;
      if (
        left.note.pitch.step !== right.note.pitch.step ||
        left.note.pitch.alter === right.note.pitch.alter
      )
        continue;
      const leftEnd = left.note.startTick + left.note.durationTicks;
      const rightEnd = right.note.startTick + right.note.durationTicks;
      const overlapStart = Math.max(left.note.startTick, right.note.startTick);
      const overlapEnd = Math.min(leftEnd, rightEnd);
      const simultaneous = overlapStart < overlapEnd;
      const gap = simultaneous ? 0 : right.note.startTick - leftEnd;
      if (!simultaneous && (gap < 0 || gap > windowTicks)) continue;
      const leftKey = analysisKeyAtTick(analysis, left.note.startTick);
      const rightKey = analysisKeyAtTick(analysis, right.note.startTick);
      if (
        leftKey.mode !== rightKey.mode ||
        !pitchClassEquals(leftKey.tonic, rightKey.tonic)
      )
        continue;

      const kind = simultaneous ? "simultaneous" : "successive";
      if (
        (simultaneous &&
          ruleId !== "voice-leading.cross-relation-simultaneous") ||
        (!simultaneous &&
          ruleId !== "voice-leading.cross-relation-successive")
      )
        continue;
      diagnostics.push(
        diagnostic(
          ruleId,
          simultaneous ? overlapStart : right.note.startTick,
          simultaneous ? overlapEnd : rightEnd,
          [left.voiceId, right.voiceId],
          [left.note, right.note],
          simultaneous ? "同时对斜" : "先后对斜",
          `${voiceName(analysis, left.voiceId)}的 ${formatSpelledPitch(left.note.pitch)} 与${voiceName(analysis, right.voiceId)}的 ${formatSpelledPitch(right.note.pitch)} 使用同一字母音名但不同升降号。`,
          {
            messageKey: `${ruleId}.${kind}`,
            params: { kind, windowTicks },
            evidence: [
              noteEvidence(left.note, voiceName(analysis, left.voiceId)),
              noteEvidence(right.note, voiceName(analysis, right.voiceId)),
            ],
            confidence: simultaneous ? 1 : 0.9,
          },
        ),
      );
    }
  }
  return diagnostics;
}

function verticalRule(
  analysis: HarmonyAnalysis,
  ruleId: "voice.crossing" | "voice.upper-spacing",
) {
  const diagnostics: RuleDiagnostic[] = [];
  const adjacent: Array<[VoiceId, VoiceId]> = [
    ["soprano", "alto"],
    ["alto", "tenor"],
    ["tenor", "bass"],
  ];
  analysis.slices.forEach((slice) => {
    adjacent.forEach(([upperId, lowerId], index) => {
      const upper = slice.notes[upperId];
      const lower = slice.notes[lowerId];
      if (!upper || !lower) return;
      const distance = toMidi(upper.pitch) - toMidi(lower.pitch);
      const matches =
        ruleId === "voice.crossing" ? distance < 0 : index < 2 && distance > 12;
      if (!matches) return;
      diagnostics.push(
        diagnostic(
          ruleId,
          slice.tick,
          slice.endTick,
          [upperId, lowerId],
          [upper, lower],
          ruleId === "voice.crossing" ? "声部交叉" : "上三声部间距过宽",
          ruleId === "voice.crossing"
            ? "较高声部低于相邻的较低声部。"
            : "S-A 与 A-T 的相邻声部间距通常不应超过八度。",
          {
            params: { semitones: Math.abs(distance) },
            evidence: [
              noteEvidence(upper, voiceName(analysis, upperId)),
              noteEvidence(lower, voiceName(analysis, lowerId)),
              {
                kind: "interval",
                label: "垂直间距",
                value: `${Math.abs(distance)} 个半音`,
              },
            ],
          },
        ),
      );
    });
  });
  return diagnostics;
}

function voiceLeadingRule(
  analysis: HarmonyAnalysis,
  ruleId:
    | "voice-leading.parallel-fifths"
    | "voice-leading.parallel-octaves"
    | "voice-leading.hidden-fifth"
    | "voice-leading.hidden-octave"
    | "voice-leading.overlap"
    | "voice-leading.unequal-fifths-perfect-to-diminished"
    | "voice-leading.unequal-fifths-outer-diminished-to-perfect"
    | "voice-leading.unequal-fifths-inner-diminished-to-perfect",
  config: RuleConfig = {},
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.sliceTransitions.forEach((transition) => {
    for (
      let upperIndex = 0;
      upperIndex < VOICE_ORDER.length - 1;
      upperIndex += 1
    ) {
      for (
        let lowerIndex = upperIndex + 1;
        lowerIndex < VOICE_ORDER.length;
        lowerIndex += 1
      ) {
        const upperId = VOICE_ORDER[upperIndex];
        const lowerId = VOICE_ORDER[lowerIndex];
        const previousUpper = transition.previous.notes[upperId];
        const previousLower = transition.previous.notes[lowerId];
        const currentUpper = transition.current.notes[upperId];
        const currentLower = transition.current.notes[lowerId];
        if (!previousUpper || !previousLower || !currentUpper || !currentLower)
          continue;
        const upperDirection = direction(
          toMidi(previousUpper.pitch),
          toMidi(currentUpper.pitch),
        );
        const lowerDirection = direction(
          toMidi(previousLower.pitch),
          toMidi(currentLower.pitch),
        );
        const previousInterval = pitchClass(
          toMidi(previousUpper.pitch) - toMidi(previousLower.pitch),
        );
        const currentInterval = pitchClass(
          toMidi(currentUpper.pitch) - toMidi(currentLower.pitch),
        );
        const similarMotion =
          upperDirection !== 0 && upperDirection === lowerDirection;
        let matches = false;
        let exceptionContexts: RuleExceptionContext[] | undefined;
        if (
          ruleId ===
            "voice-leading.unequal-fifths-perfect-to-diminished" ||
          ruleId ===
            "voice-leading.unequal-fifths-outer-diminished-to-perfect" ||
          ruleId ===
            "voice-leading.unequal-fifths-inner-diminished-to-perfect"
        ) {
          const previousWritten = writtenInterval(
            previousLower.pitch,
            previousUpper.pitch,
          );
          const currentWritten = writtenInterval(
            currentLower.pitch,
            currentUpper.pitch,
          );
          const previousDiminished = isDiminishedFifth(previousWritten);
          const currentDiminished = isDiminishedFifth(currentWritten);
          const previousPerfect = isPerfectFifth(previousWritten);
          const currentPerfect = isPerfectFifth(currentWritten);
          const isOuter =
            upperId === "soprano" && lowerId === "bass";
          const lowStepwise = bassMotionFact(transition) === "step-up";
          matches =
            similarMotion &&
            ((ruleId ===
              "voice-leading.unequal-fifths-perfect-to-diminished" &&
              previousPerfect &&
              currentDiminished) ||
              (ruleId ===
                "voice-leading.unequal-fifths-outer-diminished-to-perfect" &&
                isOuter &&
                previousDiminished &&
                currentPerfect) ||
              (ruleId ===
                "voice-leading.unequal-fifths-inner-diminished-to-perfect" &&
                !isOuter &&
                previousDiminished &&
                currentPerfect));
          if (
            matches &&
            ruleId ===
              "voice-leading.unequal-fifths-inner-diminished-to-perfect" &&
            lowStepwise
          )
            exceptionContexts = ["bass-step-up"];
        } else if (ruleId === "voice-leading.parallel-fifths" || ruleId === "voice-leading.parallel-octaves") {
          const target = ruleId === "voice-leading.parallel-fifths" ? 7 : 0;
          matches =
            similarMotion &&
            previousInterval === target &&
            currentInterval === target;
        } else if (
          ruleId === "voice-leading.hidden-fifth" ||
          ruleId === "voice-leading.hidden-octave"
        ) {
          const targetInterval =
            ruleId === "voice-leading.hidden-fifth" ? 7 : 0;
          matches =
            upperId === "soprano" &&
            lowerId === "bass" &&
            similarMotion &&
            currentInterval === targetInterval &&
            previousInterval !== currentInterval &&
            Math.abs(toMidi(currentUpper.pitch) - toMidi(previousUpper.pitch)) >
              2;
        } else {
          const adjacent = lowerIndex === upperIndex + 1;
          matches =
            adjacent &&
            (toMidi(currentUpper.pitch) < toMidi(previousLower.pitch) ||
              toMidi(currentLower.pitch) > toMidi(previousUpper.pitch));
        }
        if (
          matches &&
          transition.sameHarmony &&
          (ruleId === "voice-leading.overlap" ||
            ruleId === "voice-leading.hidden-fifth" ||
            ruleId === "voice-leading.hidden-octave" ||
            ruleId ===
              "voice-leading.unequal-fifths-perfect-to-diminished")
        )
          exceptionContexts = [
            ...(exceptionContexts ?? []),
            "same-harmony",
          ];
        if (!matches) continue;
        const title =
          ruleId === "voice-leading.parallel-fifths"
            ? "平行纯五度"
            : ruleId === "voice-leading.parallel-octaves"
              ? "平行八度或同度"
              : ruleId === "voice-leading.hidden-fifth"
                ? "外声部隐伏五度"
                : ruleId === "voice-leading.hidden-octave"
                  ? "外声部隐伏八度"
                : ruleId ===
                    "voice-leading.unequal-fifths-perfect-to-diminished"
                  ? "纯五度到减五度"
                  : ruleId ===
                      "voice-leading.unequal-fifths-outer-diminished-to-perfect"
                    ? "外声部减五度到纯五度"
                    : ruleId ===
                        "voice-leading.unequal-fifths-inner-diminished-to-perfect"
                      ? "内声部减五度到纯五度"
                : "声部重叠";
        const message =
          ruleId === "voice-leading.parallel-fifths" || ruleId === "voice-leading.parallel-octaves"
            ? "两个声部同向移动，并连续形成相同类型的完全协和音程。"
            : ruleId === "voice-leading.hidden-fifth"
              ? "外声部同向进入纯五度，且高声部发生跳进。"
              : ruleId === "voice-leading.hidden-octave"
                ? "外声部同向进入八度或同度，且高声部发生跳进。"
              : ruleId ===
                  "voice-leading.unequal-fifths-perfect-to-diminished"
                ? "前一切片为纯五度，后一切片为减五度；该进行按默认 profile 通常允许。"
                : ruleId ===
                    "voice-leading.unequal-fifths-outer-diminished-to-perfect"
                  ? "男低音与女高音由减五度同向进入纯五度，按斯波索宾口径严格禁止。"
                  : ruleId ===
                      "voice-leading.unequal-fifths-inner-diminished-to-perfect"
                    ? "涉及内声部的减五度同向进入纯五度；只有低音上行级进时可按默认口径放宽。"
              : "当前声部进入了相邻声部上一位置所占据的音域。";
        diagnostics.push(
          diagnostic(
            ruleId,
            transition.current.tick,
            transition.current.endTick,
            [upperId, lowerId],
            [previousUpper, previousLower, currentUpper, currentLower],
            title,
            message,
            {
              evidence: [
                noteEvidence(
                  previousUpper,
                  `${voiceName(analysis, upperId)}前一音`,
                ),
                noteEvidence(
                  previousLower,
                  `${voiceName(analysis, lowerId)}前一音`,
                ),
                noteEvidence(
                  currentUpper,
                  `${voiceName(analysis, upperId)}当前音`,
                ),
                noteEvidence(
                  currentLower,
                  `${voiceName(analysis, lowerId)}当前音`,
                ),
              ],
              exceptionContexts,
            },
          ),
        );
      }
    }
  });
  return diagnostics;
}

function chordSliceRule(
  analysis: HarmonyAnalysis,
  ruleId:
    | "chord.unclassified-nonchord-tone"
    | "chord.incomplete-members"
    | "chord.inversion-bass"
    | "chord.doubled-leading-tone"
    | "chord.doubled-seventh"
    | "chord.doubled-altered-tendency-tone"
    | "chord.dominant-ninth-voicing"
    | "chord.dominant-ninth-root-spacing"
    | "chord.augmented-sixth-voicing",
  config: RuleConfig = {},
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.slices.forEach((slice, sliceIndex) => {
    const chord = slice.chord;
    if (!chord) return;
    const specializedVoicingRule =
      ruleId === "chord.dominant-ninth-voicing" ||
      ruleId === "chord.dominant-ninth-root-spacing" ||
      ruleId === "chord.augmented-sixth-voicing" ||
      ruleId === "chord.doubled-altered-tendency-tone";
    if (!specializedVoicingRule && !supportsTertianResolutionRules(chord))
      return;
    const active = activeNotes(slice);
    const tones = chordIdentityToneSpellings(chord.identity);
    const intermediate = finalSameHarmonySlice(analysis, sliceIndex);

    if (ruleId === "chord.unclassified-nonchord-tone") {
      const outside = active.filter(
        ({ note }) => !note.nonChordToneRole && !hasExactPitch(note, tones),
      );
      if (outside.length > 0) {
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            outside.map((item) => item.voiceId),
            outside.map((item) => item.note),
            "和弦外音需要确认",
            `标注和弦 ${chordLabel(chord)} 中存在拼写不属于和弦构成音、且未人工标注角色的音符。`,
            {
              chordIds: [chord.id],
              evidence: [
                chordEvidence(chord),
                ...outside.map((item) => noteEvidence(item.note)),
              ],
            },
          ),
        );
      }
      return;
    }

    if (ruleId === "chord.inversion-bass") {
      const bass = active.find((item) => item.voiceId === "bass");
      if (bass && !pitchClassEquals(bass.note.pitch, chord.identity.bass)) {
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            ["bass"],
            [bass.note],
            "低音与转位不一致",
            `${chordLabel(chord)} 要求低音写作 ${formatPitchClass(chord.identity.bass)}，当前为 ${formatPitchClass(bass.note.pitch)}。`,
            {
              chordIds: [chord.id],
              evidence: [
                chordEvidence(chord),
                noteEvidence(bass.note, "男低音"),
              ],
            },
          ),
        );
      }
      return;
    }

    if (!slice.completeSatb || intermediate) return;

    const isDominantNinth =
      chord.identity.structure.kind === "tertian" &&
      chord.identity.structure.quality === "dominant7" &&
      chord.identity.structure.extensions.includes(9);

    if (ruleId === "chord.doubled-altered-tendency-tone") {
      if (chord.identity.structure.kind !== "tertian") return;
      const directionalTones: Array<{
        tone: SpelledPitchClass;
        tendency: "up" | "down";
        degree: number;
      }> = [];
      chord.identity.structure.alterations.forEach((alteration) => {
        if (!alteration.tendency) return;
        const tone = chordIdentityToneSpellingForDegree(
          chord.identity,
          alteration.degree,
        );
        if (!tone) return;
        directionalTones.push({
          tone,
          tendency: alteration.tendency,
          degree: alteration.degree,
        });
      });
      const interpretation = chord.semantics
        ? primaryHarmonyInterpretation(chord.semantics)
        : undefined;
      const designationKind = interpretation?.designation?.kind;
      const targetDegree =
        interpretation?.appliedTarget?.degree ??
        (designationKind === "double-dominant" ||
        designationKind === "double-dominant-leading-tone"
          ? 5
          : undefined);
      if (targetDegree) {
        const targetTonic = scaleDegreePitchClass(slice.key, targetDegree, 0);
        const targetLeadingTone = scaleDegreePitchClass(
          { tonic: targetTonic, mode: "major" },
          7,
          0,
        );
        if (
          chordIdentityToneSpellings(chord.identity).some((tone) =>
            pitchClassEquals(tone, targetLeadingTone),
          ) &&
          !directionalTones.some(({ tone }) =>
            pitchClassEquals(tone, targetLeadingTone),
          )
        ) {
          directionalTones.push({
            tone: targetLeadingTone,
            tendency: "up",
            degree: 7,
          });
        }
      }
      directionalTones.forEach(({ tone, tendency, degree }) => {
        const repeated = active.filter(({ note }) =>
          pitchClassEquals(note.pitch, tone),
        );
        if (repeated.length <= 1) return;
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            [],
            [],
            "重复变化倾向音",
            `${chordLabel(chord)} 的 ${formatPitchClass(tone)} 具有明确的${tendency === "up" ? "上行" : "下行"}倾向，不应重复。`,
            {
              chordIds: [chord.id],
              params: {
                degree,
                tendency,
                count: repeated.length,
              },
              evidence: [
                chordEvidence(chord),
                ...repeated.map(({ note }) =>
                  noteEvidence(note, "重复变化倾向音"),
                ),
              ],
            },
          ),
        );
      });
      return;
    }
    if (
      (ruleId === "chord.dominant-ninth-voicing" ||
        ruleId === "chord.dominant-ninth-root-spacing") &&
      !isDominantNinth
    )
      return;

    if (ruleId === "chord.dominant-ninth-voicing") {
      const tones = chordIdentityToneSpellings(chord.identity);
      const counts = tones.map(
        (tone) =>
          active.filter(({ note }) => pitchClassEquals(note.pitch, tone)).length,
      );
      const required = chordVoicingPolicy(chord.identity).requiredDegrees;
      const missing = required
        .map((degree) => {
          const index = degree === 1 ? 0 : degree === 3 ? 1 : degree === 5 ? 2 : degree === 7 ? 3 : 4;
          return counts[index] === 0 ? tones[index] : undefined;
        })
        .filter((tone): tone is SpelledPitchClass => Boolean(tone));
      const fifthPresent = counts[2] > 0;
      if (missing.length > 0 || fifthPresent) {
        const problems = [
          ...(missing.length > 0
            ? [`缺少 ${missing.map(formatPitchClass).join("、")}`]
            : []),
          ...(fifthPresent ? ["不应出现五音"] : []),
        ];
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            [],
            [],
            "属九和弦配置不符合四声部要求",
            `${chordLabel(chord)} ${problems.join("，")}。四声部 D9 默认采用 1/3/7/9。`,
            {
              chordIds: [chord.id],
              params: {
                missing: missing.map(formatPitchClass).join(","),
                fifthPresent,
              },
              evidence: [chordEvidence(chord)],
            },
          ),
        );
      }
      return;
    }

    if (ruleId === "chord.augmented-sixth-voicing") {
      if (chord.identity.structure.kind !== "augmented-sixth") return;
      const expected =
        chord.identity.structure.variant === "italian"
          ? [1, 2, 1]
          : [1, 1, 1, 1];
      const counts = tones.map(
        (tone) =>
          active.filter(({ note }) => pitchClassEquals(note.pitch, tone)).length,
      );
      if (counts.every((count, index) => count === expected[index])) return;
      const variantLabel =
        chord.identity.structure.variant === "italian"
          ? "It+6"
          : chord.identity.structure.variant === "french"
            ? "Fr+6"
            : "Ger+6";
      diagnostics.push(
        diagnostic(
          ruleId,
          slice.tick,
          slice.endTick,
          [],
          [],
          "增六和弦配置不正确",
          `${variantLabel} 应按 ${expected.join("/")} 配置 ${tones.map(formatPitchClass).join("、")}；增六两端变化音必须各出现一次。`,
          {
            chordIds: [chord.id],
            params: {
              variant: variantLabel,
              expected: expected.join("/"),
              actual: counts.join("/"),
            },
            evidence: [
              chordEvidence(chord),
              ...active.map(({ note }) => noteEvidence(note, "当前配置")),
            ],
          },
        ),
      );
      return;
    }

    if (ruleId === "chord.dominant-ninth-root-spacing") {
      const tones = chordIdentityToneSpellings(chord.identity);
      const root = active.find(
        ({ voiceId, note }) =>
          voiceId === "bass" && pitchClassEquals(note.pitch, tones[0]),
      );
      const ninth = active.find(({ note }) =>
        pitchClassEquals(note.pitch, tones[4]),
      );
      const minimumSemitones = 12;
      if (
        root &&
        ninth &&
        toMidi(ninth.note.pitch) - toMidi(root.note.pitch) <= minimumSemitones
      ) {
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            ["bass"],
            [root.note, ninth.note],
            "属九和弦根音与九音间距不足",
            `${chordLabel(chord)} 的九音必须位于根音上方超过八度。`,
            {
              chordIds: [chord.id],
              params: {
                distance: toMidi(ninth.note.pitch) - toMidi(root.note.pitch),
                minimumSemitones,
              },
              evidence: [
                chordEvidence(chord),
                noteEvidence(root.note, "根音"),
                noteEvidence(ninth.note, "九音"),
              ],
            },
          ),
        );
      }
      return;
    }

    if (ruleId === "chord.incomplete-members") {
      const missing = tones.filter(
        (tone) =>
          !active.some(({ note }) => pitchClassEquals(note.pitch, tone)),
      );
      if (missing.length > 0) {
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            [],
            [],
            "和弦构成音不完整",
            `${chordLabel(chord)} 缺少 ${missing.map(formatPitchClass).join("、")}。`,
            {
              chordIds: [chord.id],
              params: { missing: missing.map(formatPitchClass).join(",") },
              evidence: [
                chordEvidence(chord),
                {
                  kind: "chord",
                  id: chord.id,
                  label: "缺少构成音",
                  value: missing.map(formatPitchClass).join("、"),
                },
              ],
            },
          ),
        );
      }
      return;
    }

    const target =
      ruleId === "chord.doubled-leading-tone"
        ? scaleDegreePitchClass(
            slice.key,
            7,
            slice.key.mode === "minor" ? 1 : 0,
          )
        : tones.length === 4
          ? tones[3]
          : undefined;
    if (!target) return;
    const repeated = active.filter(({ note }) =>
      pitchClassEquals(note.pitch, target),
    );
    if (repeated.length <= 1) return;
    diagnostics.push(
      diagnostic(
        ruleId,
        slice.tick,
        slice.endTick,
        repeated.map((item) => item.voiceId),
        repeated.map((item) => item.note),
        ruleId === "chord.doubled-leading-tone" ? "重复导音" : "重复和弦七音",
        ruleId === "chord.doubled-leading-tone"
          ? `四部和声中通常不应重复局部调性内的书写导音 ${formatPitchClass(target)}。`
          : `${chordLabel(chord)} 的七音 ${formatPitchClass(target)} 不应重复。`,
        {
          chordIds: [chord.id],
          evidence: [
            chordEvidence(chord),
            ...repeated.map((item) => noteEvidence(item.note)),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

/**
 * 正常调色盘和编辑命令会阻止语义与实体分叉；这里仍在规则层做一次防御检查，
 * 以覆盖迁移、外置工具或未经过命令层写入的工程数据。
 */
function chordInterpretationIdentityRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.project.chordTrack.regions.forEach((chord) => {
    if (!chord.semantics) return;
    const key = analysisKeyAtTick(analysis, chord.startTick);
    if (
      harmonySemanticsCompatibleWithIdentity(
        chord.identity,
        chord.semantics,
        key,
      )
    )
      return;
    const interpretation = primaryHarmonyInterpretation(chord.semantics);
    diagnostics.push(
      diagnostic(
        "chord.interpretation-identity-conflict",
        chord.startTick,
        chord.startTick + chord.durationTicks,
        [],
        [],
        "功能解释与和弦实体冲突",
        `${chordLabel(chord)} 的和声解释无法重新生成当前根音、结构或低音。`,
        {
          chordIds: [chord.id],
          params: {
            interpretationId: interpretation.id,
            degree: interpretation.degree,
          },
          evidence: [
            chordEvidence(chord),
            {
              kind: "function",
              label: "主要解释",
              value:
                interpretation.designation?.kind ??
                `第 ${interpretation.degree} 级`,
            },
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function augmentedSixthResolutionRule(
  analysis: HarmonyAnalysis,
  ruleId:
    | "resolution.augmented-sixth"
    | "connection.italian-augmented-sixth"
    | "connection.french-augmented-sixth"
    | "connection.german-augmented-sixth" = "resolution.augmented-sixth",
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((sourceSpan) => {
    const sourceSpanChord = sourceSpan.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    if (sourceSpanChord?.identity.structure.kind !== "augmented-sixth") return;
    const expectedVariant =
      ruleId === "connection.italian-augmented-sixth"
        ? "italian"
        : ruleId === "connection.french-augmented-sixth"
          ? "french"
          : ruleId === "connection.german-augmented-sixth"
            ? "german"
            : undefined;
    if (
      expectedVariant &&
      sourceSpanChord.identity.structure.variant !== expectedVariant
    )
      return;
    const connection = analysis.connections.find(
      (candidate) => candidate.previousSpanId === sourceSpan.id,
    );
    if (!connection?.contiguous || !connection.sameKey) return;
    const targetSpan = analysis.harmonySpans.find(
      (candidate) => candidate.id === connection.currentSpanId,
    );
    if (!targetSpan) return;
    let sourceSliceIndex = -1;
    analysis.slices.forEach((_slice, index) => {
      if (analysis.sliceSpanIds.get(index) === sourceSpan.id)
        sourceSliceIndex = index;
    });
    const targetSliceIndex = analysis.slices.findIndex(
      (_slice, index) => analysis.sliceSpanIds.get(index) === targetSpan.id,
    );
    if (sourceSliceIndex < 0 || targetSliceIndex < 0) return;
    const sourceSlice = analysis.slices[sourceSliceIndex];
    const targetSlice = analysis.slices[targetSliceIndex];
    const sourceChord = sourceSlice.chord;
    const targetChord = targetSlice.chord;
    if (
      !sourceChord ||
      !targetChord ||
      !sourceSlice.completeSatb ||
      !targetSlice.completeSatb
    )
      return;

    const tones = chordIdentityToneSpellings(sourceChord.identity);
    const sourceNotes = activeNotes(sourceSlice);
    const lowCandidates = sourceNotes.filter(({ note }) =>
      pitchClassEquals(note.pitch, tones[0]),
    );
    const highCandidates = sourceNotes.filter(({ note }) =>
      pitchClassEquals(note.pitch, tones.at(-1)!),
    );
    // 两端音缺失或重复属于 D.13 的静态配置错误；本规则只在端点唯一时检查横向解决。
    if (lowCandidates.length !== 1 || highCandidates.length !== 1) return;
    const low = lowCandidates[0];
    const high = highCandidates[0];
    const targetLow = targetSlice.notes[low.voiceId];
    const targetHigh = targetSlice.notes[high.voiceId];
    const targetInterpretation = targetSpan.semantics
      ? primaryHarmonyInterpretation(targetSpan.semantics)
      : undefined;
    const targetKind = targetInterpretation?.designation?.kind;
    const isCadential64 =
      targetKind === "cadential64" ||
      targetSpan.semantics?.cadenceRole === "cadential64";
    const isDominant =
      targetInterpretation?.designation?.primaryFunction === "dominant" ||
      targetInterpretation?.degree === 5 ||
      targetInterpretation?.degree === 7;
    const dominantPitch = scaleDegreePitchClass(sourceSlice.key, 5, 0);
    const lowDelta = targetLow
      ? toMidi(targetLow.pitch) - toMidi(low.note.pitch)
      : undefined;
    const highDelta = targetHigh
      ? toMidi(targetHigh.pitch) - toMidi(high.note.pitch)
      : undefined;
    const lowResolves = Boolean(
      targetLow &&
        lowDelta === -1 &&
        pitchClassEquals(targetLow.pitch, dominantPitch),
    );
    const highResolves = Boolean(
      targetHigh &&
        highDelta === 1 &&
        pitchClassEquals(targetHigh.pitch, dominantPitch),
    );
    let characteristicResolves = true;
    let characteristicSource: AnalysisNote | undefined;
    let characteristicTarget: AnalysisNote | undefined;
    if (ruleId === "connection.french-augmented-sixth") {
      const candidates = sourceNotes.filter(({ note }) =>
        pitchClassEquals(note.pitch, tones[2]),
      );
      characteristicSource = candidates.length === 1
        ? candidates[0].note
        : undefined;
      characteristicTarget = candidates.length === 1
        ? targetSlice.notes[candidates[0].voiceId]
        : undefined;
      const motion =
        characteristicSource && characteristicTarget
          ? Math.abs(
              toMidi(characteristicTarget.pitch) -
                toMidi(characteristicSource.pitch),
            )
          : undefined;
      characteristicResolves = Boolean(
        characteristicSource &&
          characteristicTarget &&
          motion !== undefined &&
          motion <= 2 &&
          hasExactPitch(
            characteristicTarget,
            chordIdentityToneSpellings(targetChord.identity),
          ),
      );
    }
    if (
      (isDominant || isCadential64) &&
      lowResolves &&
      highResolves &&
      characteristicResolves
    )
      return;

    const problems = [
      ...(!isDominant && !isCadential64
        ? ["目标不是明确的属功能或 K46"]
        : []),
      ...(!lowResolves ? ["增六低端未下行半音到属音"] : []),
      ...(!highResolves ? ["增六高端未上行半音到属音"] : []),
      ...(!characteristicResolves
        ? ["Fr+6 特有构成音未保持或级进到目标和弦音"]
        : []),
    ];
    const sourceAllNotes = sourceNotes.map(({ note }) => note);
    const targetAllNotes = activeNotes(targetSlice).map(({ note }) => note);
    const variantLabel =
      sourceChord.identity.structure.kind === "augmented-sixth"
        ? sourceChord.identity.structure.variant === "italian"
          ? "It+6"
          : sourceChord.identity.structure.variant === "french"
            ? "Fr+6"
            : "Ger+6"
        : "增六和弦";
    diagnostics.push(
      diagnostic(
        ruleId,
        targetSlice.tick,
        targetSlice.endTick,
        [...VOICE_ORDER],
        [...sourceAllNotes, ...targetAllNotes],
        ruleId === "resolution.augmented-sixth"
          ? "增六音程未按反向半音解决"
          : `${variantLabel} 连接不正确`,
        `${chordLabel(sourceChord)}：${problems.join("；")}。`,
        {
          chordIds: [sourceChord.id, targetChord.id],
          params: {
            target: isCadential64 ? "K46" : isDominant ? "D" : "other",
            lowDelta: lowDelta ?? 99,
            highDelta: highDelta ?? 99,
          },
          evidence: [
            chordEvidence(sourceChord),
            noteEvidence(low.note, "增六低端"),
            noteEvidence(high.note, "增六高端"),
            chordEvidence(targetChord),
            ...(targetLow ? [noteEvidence(targetLow, "低端后继音")] : []),
            ...(targetHigh ? [noteEvidence(targetHigh, "高端后继音")] : []),
            ...(characteristicSource
              ? [noteEvidence(characteristicSource, "Fr+6 特有音")]
              : []),
            ...(characteristicTarget
              ? [noteEvidence(characteristicTarget, "特有音后继音")]
              : []),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function deceptiveCadenceTargetRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((sourceSpan) => {
    if (sourceSpan.semantics?.cadenceRole !== "deceptive") return;
    const sourceInterpretation = sourceSpan.semantics
      ? primaryHarmonyInterpretation(sourceSpan.semantics)
      : undefined;
    const sourceIsDominant =
      sourceInterpretation?.designation?.primaryFunction === "dominant" ||
      sourceInterpretation?.degree === 5 ||
      sourceInterpretation?.degree === 7;
    const connection = analysis.connections.find(
      (candidate) => candidate.previousSpanId === sourceSpan.id,
    );
    const targetSpan = connection
      ? analysis.harmonySpans.find(
          (candidate) => candidate.id === connection.currentSpanId,
        )
      : undefined;
    const sourceChord = sourceSpan.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    const targetChord = targetSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    if (!sourceChord) return;
    const resolves = Boolean(
      sourceIsDominant &&
        connection?.relation === "deceptive" &&
        connection.contiguous &&
        connection.sameKey,
    );
    if (resolves) return;
    diagnostics.push(
      diagnostic(
        "function.deceptive-cadence-target",
        targetChord
          ? targetChord.startTick
          : Math.min(
              analysis.project.lengthTicks,
              sourceChord.startTick + sourceChord.durationTicks,
            ),
        targetChord
          ? targetChord.startTick
          : Math.min(
              analysis.project.lengthTicks,
              sourceChord.startTick + sourceChord.durationTicks,
            ),
        [],
        [],
        "阻碍进行标注与目标不一致",
        `${chordLabel(sourceChord)} 已标注为阻碍进行起点，后继应为同一调性内的 TSVI。`,
        {
          chordIds: targetChord
            ? [sourceChord.id, targetChord.id]
            : [sourceChord.id],
          evidence: [
            chordEvidence(sourceChord),
            ...(targetChord ? [chordEvidence(targetChord)] : []),
            {
              kind: "function",
              label: "预期连接",
              value: "D → TSVI",
            },
          ],
          exceptionContexts: connection
            ? [...connection.exceptionTags]
            : ["insufficient-context"],
        },
      ),
    );
  });
  return diagnostics;
}

function deceptiveVoiceLeadingRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((sourceSpan) => {
    if (sourceSpan.semantics?.cadenceRole !== "deceptive") return;
    const connection = analysis.connections.find(
      (candidate) => candidate.previousSpanId === sourceSpan.id,
    );
    if (
      connection?.relation !== "deceptive" ||
      !connection.contiguous ||
      !connection.sameKey
    )
      return;
    const targetSpan = analysis.harmonySpans.find(
      (candidate) => candidate.id === connection.currentSpanId,
    );
    if (!targetSpan) return;
    let sourceSliceIndex = -1;
    analysis.slices.forEach((_slice, index) => {
      if (analysis.sliceSpanIds.get(index) === sourceSpan.id)
        sourceSliceIndex = index;
    });
    const targetSliceIndex = analysis.slices.findIndex(
      (_slice, index) => analysis.sliceSpanIds.get(index) === targetSpan.id,
    );
    if (sourceSliceIndex < 0 || targetSliceIndex < 0) return;
    const sourceSlice = analysis.slices[sourceSliceIndex];
    const targetSlice = analysis.slices[targetSliceIndex];
    const sourceChord = sourceSlice.chord;
    const targetChord = targetSlice.chord;
    if (
      !sourceChord ||
      !targetChord ||
      !sourceSlice.completeSatb ||
      !targetSlice.completeSatb
    )
      return;

    const sourceBass = sourceSlice.notes.bass;
    const targetBass = targetSlice.notes.bass;
    const dominant = scaleDegreePitchClass(sourceSlice.key, 5, 0);
    const submediant = scaleDegreePitchClass(sourceSlice.key, 6, 0);
    const tonic = sourceSlice.key.tonic;
    const leadingTone = scaleDegreePitchClass(
      sourceSlice.key,
      7,
      sourceSlice.key.mode === "minor" ? 1 : 0,
    );
    const bassResolves = Boolean(
      sourceBass &&
        targetBass &&
        pitchClassEquals(sourceBass.pitch, dominant) &&
        pitchClassEquals(targetBass.pitch, submediant),
    );
    const leadingSources = activeNotes(sourceSlice).filter(({ note }) =>
      pitchClassEquals(note.pitch, leadingTone),
    );
    const leadingResolves =
      leadingSources.length === 1 &&
      (() => {
        const source = leadingSources[0];
        const target = targetSlice.notes[source.voiceId];
        return Boolean(
          target &&
            pitchClassEquals(target.pitch, tonic) &&
            toMidi(target.pitch) - toMidi(source.note.pitch) === 1,
        );
      })();
    const targetTones = chordIdentityToneSpellings(targetChord.identity);
    const targetCounts = targetTones.map(
      (tone) =>
        activeNotes(targetSlice).filter(({ note }) =>
          pitchClassEquals(note.pitch, tone),
        ).length,
    );
    const targetProfile =
      targetChord.identity.structure.kind === "tertian" &&
      targetTones.length === 3 &&
      targetCounts[0] === 1 &&
      targetCounts[1] === 2 &&
      targetCounts[2] === 1 &&
      pitchClassEquals(targetTones[1], tonic);
    if (bassResolves && leadingResolves && targetProfile) return;

    const problems = [
      ...(!bassResolves ? ["低音未按 5→6 进行"] : []),
      ...(!leadingResolves ? ["导音未按 7→1 上行解决"] : []),
      ...(!targetProfile ? ["TSVI 未采用三音重复配置"] : []),
    ];
    const sourceNotes = activeNotes(sourceSlice).map(({ note }) => note);
    const targetNotes = activeNotes(targetSlice).map(({ note }) => note);
    diagnostics.push(
      diagnostic(
        "connection.deceptive-voice-leading",
        targetSlice.tick,
        targetSlice.endTick,
        [
          "bass",
          ...leadingSources.map(({ voiceId }) => voiceId),
        ],
        [...sourceNotes, ...targetNotes],
        "阻碍进行声部配置不正确",
        `${chordLabel(sourceChord)} → ${chordLabel(targetChord)}：${problems.join("；")}。`,
        {
          chordIds: [sourceChord.id, targetChord.id],
          params: {
            bassResolves,
            leadingResolves,
            targetProfile,
          },
          evidence: [
            chordEvidence(sourceChord),
            chordEvidence(targetChord),
            ...(sourceBass ? [noteEvidence(sourceBass, "属和弦低音")] : []),
            ...(targetBass ? [noteEvidence(targetBass, "TSVI 低音")] : []),
            ...leadingSources.map(({ note }) => noteEvidence(note, "导音")),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function mixtureSourceRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  const qualities = {
    major: [
      "major",
      "minor",
      "minor",
      "major",
      "major",
      "minor",
      "diminished",
    ],
    minor: [
      "minor",
      "diminished",
      "major",
      "minor",
      "minor",
      "major",
      "major",
    ],
  } as const;
  analysis.project.chordTrack.regions.forEach((chord) => {
    const mixture = chord.semantics?.mixture;
    if (!mixture || mixture === "modal") return;
    if (
      chord.identity.structure.kind !== "tertian" ||
      chord.identity.structure.extensions.length > 0 ||
      chord.identity.structure.alterations.length > 0
    )
      return;
    const interpretation = primaryHarmonyInterpretation(chord.semantics!);
    const localKey = interpretation.localKey ??
      analysisKeyAtTick(analysis, chord.startTick);
    const sourceMode =
      mixture === "parallel-major" ? "major" : "minor";
    const sourceKey = { tonic: localKey.tonic, mode: sourceMode } as const;
    const expectedRoot = scaleDegreePitchClass(
      sourceKey,
      interpretation.degree,
      0,
    );
    const expectedQuality = qualities[sourceMode][interpretation.degree - 1];
    if (
      pitchClassEquals(chord.identity.root, expectedRoot) &&
      chord.identity.structure.quality === expectedQuality
    )
      return;
    diagnostics.push(
      diagnostic(
        "tonality.mixture-source",
        chord.startTick,
        chord.startTick + chord.durationTicks,
        [],
        [],
        "借用和弦与来源调式不一致",
        `${chordLabel(chord)} 标注为${mixture === "parallel-major" ? "同主大调" : "同主小调"}借用，但第 ${interpretation.degree} 级应为 ${formatPitchClass(expectedRoot)} ${expectedQuality} 三和弦。`,
        {
          chordIds: [chord.id],
          params: {
            sourceMode,
            degree: interpretation.degree,
            expectedRoot: formatPitchClass(expectedRoot),
            expectedQuality,
          },
          evidence: [
            chordEvidence(chord),
            {
              kind: "key",
              label: "声明的借用来源",
              value: `${formatPitchClass(sourceKey.tonic)} ${sourceMode}`,
            },
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function functionalRetrogressionRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.connections.forEach((connection) => {
    if (
      connection.relation !== "retrogression" ||
      !connection.contiguous ||
      !connection.sameKey ||
      connection.confidence === "ambiguous" ||
      connection.confidence === "unknown"
    )
      return;
    const previousSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.previousSpanId,
    );
    const currentSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.currentSpanId,
    );
    const previous = previousSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    const current = currentSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    if (!previous || !current) return;
    diagnostics.push(
      diagnostic(
        "function.retrogression",
        current.startTick,
        current.startTick,
        [],
        [],
        "逆功能进行",
        `${chordLabel(previous)} 到 ${chordLabel(current)} 形成属功能到下属功能的逆向进行。`,
        {
          chordIds: [previous.id, current.id],
          evidence: [
            chordEvidence(previous),
            chordEvidence(current),
            {
              kind: "function",
              label: "功能连接",
              value: connection.evidence
                .filter((item) => item.code.endsWith("family"))
                .map((item) => item.value)
                .join(" → "),
            },
          ],
          confidence: connection.confidence === "certain" ? 1 : 0.8,
          exceptionContexts: [...connection.exceptionTags],
        },
      ),
    );
  });
  return diagnostics;
}

function doubleDominantTargetRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.connections.forEach((connection) => {
    if (connection.relation !== "double-dominant-target") return;
    const previousSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.previousSpanId,
    );
    const currentSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.currentSpanId,
    );
    const previous = previousSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    const current = currentSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    if (
      !previous ||
      !current ||
      !connection.contiguous ||
      connection.targetMatched
    )
      return;
    diagnostics.push(
      diagnostic(
        "function.double-dominant-target",
        current.startTick,
        current.startTick,
        [],
        [],
        "重属功能未进入属功能",
        `${chordLabel(previous)} 通常应进入属功能，或经终止四六进入属功能。`,
        {
          chordIds: [previous.id, current.id],
          evidence: [
            chordEvidence(previous),
            chordEvidence(current),
            {
              kind: "function",
              label: "预期连接",
              value: "重属功能 → 属功能 / K46",
            },
          ],
          confidence:
            connection.confidence === "certain"
              ? 1
              : connection.confidence === "probable"
                ? 0.8
                : 0,
          exceptionContexts: [...connection.exceptionTags],
        },
      ),
    );
  });
  return diagnostics;
}

function cadential64ResolutionRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((span) => {
    const interpretation = span.semantics
      ? primaryHarmonyInterpretation(span.semantics)
      : undefined;
    if (
      interpretation?.designation?.kind !== "cadential64" &&
      span.semantics?.cadenceRole !== "cadential64"
    )
      return;
    const previous = span.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    if (!previous) return;
    const connection = analysis.connections.find(
      (candidate) => candidate.previousSpanId === span.id,
    );
    const currentSpan = connection
      ? analysis.harmonySpans.find(
          (candidate) => candidate.id === connection.currentSpanId,
        )
      : undefined;
    const current = currentSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    const resolves = Boolean(
      connection?.relation === "cadential64-target" &&
        connection.targetMatched &&
        connection.contiguous &&
        connection.sameKey,
    );
    if (resolves) return;
    diagnostics.push(
      diagnostic(
        "function.cadential64-target",
        Math.min(
          analysis.project.lengthTicks,
          previous.startTick + previous.durationTicks,
        ),
        Math.min(
          analysis.project.lengthTicks,
          previous.startTick + previous.durationTicks,
        ),
        [],
        [],
        "终止四六未进入属和弦",
        `${chordLabel(previous)} 已标记为终止四六，通常应连续进入属功能和弦。`,
        {
          chordIds: current ? [previous.id, current.id] : [previous.id],
          evidence: [
            chordEvidence(previous),
            ...(current ? [chordEvidence(current)] : []),
            {
              kind: "function",
              label: "预期连接",
              value: "终止四六 → 属功能",
            },
          ],
          exceptionContexts: connection
            ? [...connection.exceptionTags]
            : ["insufficient-context"],
        },
      ),
    );
  });
  return diagnostics;
}

type StatefulHarmonyRuleId =
  | "resolution.leading-tone"
  | "resolution.chord-seventh"
  | "resolution.dominant-ninth"
  | "resolution.altered-tone"
  | "function.applied-dominant-target";
type StatelessHarmonyRuleId =
  | "voice.range"
  | "voice.polyphonic-overlap"
  | "voice.crossing"
  | "voice.upper-spacing"
  | "voice-leading.overlap"
  | "voice-leading.unequal-fifths-perfect-to-diminished"
  | "voice-leading.unequal-fifths-outer-diminished-to-perfect"
  | "voice-leading.unequal-fifths-inner-diminished-to-perfect"
  | "voice-leading.parallel-fifths"
  | "voice-leading.parallel-octaves"
  | "voice-leading.hidden-fifth"
  | "voice-leading.hidden-octave"
  | "voice-leading.cross-relation-simultaneous"
  | "voice-leading.cross-relation-successive"
  | "melody.leap-over-octave"
  | "melody.large-leap"
  | "melody.tritone"
  | "melody.augmented-interval"
  | "melody.diminished-interval"
  | "chord.unclassified-nonchord-tone"
  | "chord.incomplete-members"
  | "chord.inversion-bass"
  | "chord.interpretation-identity-conflict"
  | "chord.doubled-leading-tone"
  | "chord.doubled-seventh"
  | "chord.doubled-altered-tendency-tone"
  | "chord.dominant-ninth-voicing"
  | "chord.dominant-ninth-root-spacing"
  | "chord.augmented-sixth-voicing"
  | "function.retrogression"
  | "function.double-dominant-target"
  | "function.cadential64-target"
  | "function.deceptive-cadence-target"
  | "connection.deceptive-voice-leading"
  | "connection.italian-augmented-sixth"
  | "connection.french-augmented-sixth"
  | "connection.german-augmented-sixth"
  | "tonality.mixture-source"
  | "resolution.augmented-sixth";

const evaluators: Record<
  StatelessHarmonyRuleId,
  (analysis: HarmonyAnalysis, config: RuleConfig) => RuleDiagnostic[]
> = {
  "voice.range": (analysis, config) => voiceRangeRule(analysis, config),
  "voice.polyphonic-overlap": (analysis) => noteOverlapRule(analysis),
  "voice.crossing": (analysis) => verticalRule(analysis, "voice.crossing"),
  "voice.upper-spacing": (analysis) => verticalRule(analysis, "voice.upper-spacing"),
  "voice-leading.overlap": (analysis) => voiceLeadingRule(analysis, "voice-leading.overlap"),
  "voice-leading.unequal-fifths-perfect-to-diminished": (analysis, config) =>
    voiceLeadingRule(
      analysis,
      "voice-leading.unequal-fifths-perfect-to-diminished",
      config,
    ),
  "voice-leading.unequal-fifths-outer-diminished-to-perfect": (
    analysis,
    config,
  ) =>
    voiceLeadingRule(
      analysis,
      "voice-leading.unequal-fifths-outer-diminished-to-perfect",
      config,
    ),
  "voice-leading.unequal-fifths-inner-diminished-to-perfect": (
    analysis,
    config,
  ) =>
    voiceLeadingRule(
      analysis,
      "voice-leading.unequal-fifths-inner-diminished-to-perfect",
      config,
    ),
  "melody.leap-over-octave": (analysis) =>
    melodicLeapRule(analysis, "melody.leap-over-octave"),
  "melody.large-leap": (analysis) =>
    melodicLeapRule(analysis, "melody.large-leap"),
  "melody.tritone": (analysis) => melodicLeapRule(analysis, "melody.tritone"),
  "melody.augmented-interval": (analysis) =>
    augmentedDiminishedIntervalRule(analysis, "melody.augmented-interval"),
  "melody.diminished-interval": (analysis) =>
    augmentedDiminishedIntervalRule(analysis, "melody.diminished-interval"),
  "voice-leading.cross-relation-simultaneous": (analysis, config) =>
    crossRelationRule(
      analysis,
      "voice-leading.cross-relation-simultaneous",
      config,
    ),
  "voice-leading.cross-relation-successive": (analysis, config) =>
    crossRelationRule(
      analysis,
      "voice-leading.cross-relation-successive",
      config,
    ),
  "voice-leading.parallel-fifths": (analysis) =>
    voiceLeadingRule(analysis, "voice-leading.parallel-fifths"),
  "voice-leading.parallel-octaves": (analysis) =>
    voiceLeadingRule(analysis, "voice-leading.parallel-octaves"),
  "voice-leading.hidden-fifth": (analysis) =>
    voiceLeadingRule(analysis, "voice-leading.hidden-fifth"),
  "voice-leading.hidden-octave": (analysis) =>
    voiceLeadingRule(analysis, "voice-leading.hidden-octave"),
  "chord.unclassified-nonchord-tone": (analysis) =>
    chordSliceRule(analysis, "chord.unclassified-nonchord-tone"),
  "chord.incomplete-members": (analysis) =>
    chordSliceRule(analysis, "chord.incomplete-members"),
  "chord.inversion-bass": (analysis) => chordSliceRule(analysis, "chord.inversion-bass"),
  "chord.interpretation-identity-conflict": (analysis) =>
    chordInterpretationIdentityRule(analysis),
  "chord.doubled-leading-tone": (analysis) =>
    chordSliceRule(analysis, "chord.doubled-leading-tone"),
  "chord.doubled-seventh": (analysis) =>
    chordSliceRule(analysis, "chord.doubled-seventh"),
  "chord.doubled-altered-tendency-tone": (analysis) =>
    chordSliceRule(analysis, "chord.doubled-altered-tendency-tone"),
  "chord.dominant-ninth-voicing": (analysis, config) =>
    chordSliceRule(analysis, "chord.dominant-ninth-voicing", config),
  "chord.dominant-ninth-root-spacing": (analysis, config) =>
    chordSliceRule(analysis, "chord.dominant-ninth-root-spacing", config),
  "chord.augmented-sixth-voicing": (analysis, config) =>
    chordSliceRule(analysis, "chord.augmented-sixth-voicing", config),
  "resolution.augmented-sixth": (analysis) =>
    augmentedSixthResolutionRule(analysis),
  "connection.italian-augmented-sixth": (analysis) =>
    augmentedSixthResolutionRule(
      analysis,
      "connection.italian-augmented-sixth",
    ),
  "connection.french-augmented-sixth": (analysis) =>
    augmentedSixthResolutionRule(
      analysis,
      "connection.french-augmented-sixth",
    ),
  "connection.german-augmented-sixth": (analysis) =>
    augmentedSixthResolutionRule(
      analysis,
      "connection.german-augmented-sixth",
    ),
  "function.retrogression": (analysis) =>
    functionalRetrogressionRule(analysis),
  "function.double-dominant-target": (analysis) =>
    doubleDominantTargetRule(analysis),
  "function.cadential64-target": (analysis) => cadential64ResolutionRule(analysis),
  "function.deceptive-cadence-target": (analysis) =>
    deceptiveCadenceTargetRule(analysis),
  "connection.deceptive-voice-leading": (analysis) =>
    deceptiveVoiceLeadingRule(analysis),
  "tonality.mixture-source": (analysis) => mixtureSourceRule(analysis),
};

export const BUILTIN_HARMONY_RULES: readonly RuleDefinition[] =
  HARMONY_RULE_DEFINITIONS.filter((definition) => definition.implemented).map((definition) => {
    if (definition.id === "resolution.leading-tone") {
      return {
        ...definition,
        process: (
          context: RuleStepContext,
          incoming: readonly RuleStateEnvelope[],
        ) => leadingToneStateStep(context, incoming),
      };
    }
    if (definition.id === "resolution.chord-seventh") {
      return {
        ...definition,
        process: (
          context: RuleStepContext,
          incoming: readonly RuleStateEnvelope[],
        ) => seventhStateStep(context, incoming),
      };
    }
    if (definition.id === "resolution.dominant-ninth") {
      return {
        ...definition,
        process: (
          context: RuleStepContext,
          incoming: readonly RuleStateEnvelope[],
        ) => dominantNinthStateStep(context, incoming),
      };
    }
    if (definition.id === "resolution.altered-tone") {
      return {
        ...definition,
        process: (
          context: RuleStepContext,
          incoming: readonly RuleStateEnvelope[],
        ) => alteredToneStateStep(context, incoming),
      };
    }
    if (definition.id === "function.applied-dominant-target") {
      return {
        ...definition,
        process: (
          context: RuleStepContext,
          incoming: readonly RuleStateEnvelope[],
        ) => secondaryDominantStateStep(context, incoming),
      };
    }
    return {
      ...definition,
      evaluate: ({ analysis }: { analysis: HarmonyAnalysis }, config: RuleConfig) =>
        evaluation(
          evaluators[definition.id as StatelessHarmonyRuleId](analysis, config),
        ),
    };
  });

export function createHarmonyRuleScheduler() {
  return new RuleScheduler(BUILTIN_HARMONY_RULES);
}

export function checkHarmony(
  project: ProjectDocument,
  ruleSeverities: HarmonyRuleSeverities = defaultHarmonyRuleSeverities(),
  configs: Partial<Record<HarmonyRuleId, RuleConfig>> = {},
  exceptions: Partial<Record<HarmonyRuleId, RuleExceptionPolicy>> = {},
): HarmonyCheckResult {
  return runRulesSynchronously(
    BUILTIN_HARMONY_RULES,
    project,
    ruleSeverities,
    0,
    configs,
    exceptions,
  );
}
