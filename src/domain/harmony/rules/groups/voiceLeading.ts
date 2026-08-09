import {
  analysisKeyAtTick,
  type AnalysisNote,
  type AnalysisSlice,
  type HarmonyAnalysis,
} from "../../analysis";
import type { RuleConfig, RuleDiagnostic } from "../../runtime";
import {
  chordIdentityToneSpellings,
  primaryHarmonyInterpretation,
} from "../../../chordModel";
import { VOICE_ORDER } from "../../../project";
import { durationToTicksAt } from "../../../time";
import {
  formatSpelledPitch,
  pitchClassEquals,
  toMidi,
} from "../../../pitch";
import { voicePairTransitionFacts } from "../sharedFacts";
import {
  diagnostic,
  hasExactPitch,
  isDiminishedFifth,
  isPerfectFifth,
  noteEvidence,
  pitchClass,
  voiceName,
} from "../helpers/core";

function chromaticHarmonyLicenses(
  note: AnalysisNote,
  slice: AnalysisSlice | undefined,
) {
  const chord = slice?.chord;
  if (!chord || !hasExactPitch(note, chordIdentityToneSpellings(chord.identity)))
    return false;
  const interpretation = chord.semantics
    ? primaryHarmonyInterpretation(chord.semantics)
    : undefined;
  const kind = interpretation?.designation?.kind;
  return (
    chord.identity.structure.kind === "augmented-sixth" ||
    (chord.identity.structure.kind === "tertian" &&
      chord.identity.structure.alterations.length > 0) ||
    Boolean(chord.semantics?.mixture) ||
    Boolean(interpretation?.appliedTarget) ||
    kind === "applied-dominant" ||
    kind === "applied-leading-tone" ||
    kind === "double-dominant" ||
    kind === "double-dominant-leading-tone" ||
    kind === "neapolitan" ||
    kind === "augmented-sixth"
  );
}

export function crossRelationRule(
  analysis: HarmonyAnalysis,
  ruleId:
    | "voice-leading.cross-relation-simultaneous"
    | "voice-leading.cross-relation-successive",
  config: RuleConfig,
) {
  const configuredWindow = config.window;
  const duration =
    configuredWindow && typeof configuredWindow === "object" &&
    "value" in configuredWindow && "unit" in configuredWindow
      ? configuredWindow
      : { value: 1, unit: "beats" as const };
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
    const leftEnd = left.note.startTick + left.note.durationTicks;
    const windowTicks = durationToTicksAt(analysis.project, leftEnd, duration);
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
      const leftSlice = analysis.slices.find(
        (slice) =>
          slice.tick <= left.note.startTick && left.note.startTick < slice.endTick,
      );
      const rightSlice = analysis.slices.find(
        (slice) =>
          slice.tick <= right.note.startTick && right.note.startTick < slice.endTick,
      );
      // 明确写入变化和弦实体的半音化构成音不是“声部间偶然对斜”。
      if (
        !simultaneous &&
        (chromaticHarmonyLicenses(left.note, leftSlice) ||
          chromaticHarmonyLicenses(right.note, rightSlice))
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

export function voiceLeadingRule(
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
  _config: RuleConfig = {},
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.sliceTransitions.forEach((transition) => {
    voicePairTransitionFacts(transition).forEach((fact) => {
        const [upperId, lowerId] = fact.voiceIds;
        const [previousUpper, previousLower] = fact.previousNotes;
        const [currentUpper, currentLower] = fact.currentNotes;
        const previousInterval = pitchClass(fact.previousInterval.semitones);
        const currentInterval = pitchClass(fact.currentInterval.semitones);
        const similarMotion = fact.sameDirection;
        let matches = false;
        if (
          ruleId ===
            "voice-leading.unequal-fifths-perfect-to-diminished" ||
          ruleId ===
            "voice-leading.unequal-fifths-outer-diminished-to-perfect" ||
          ruleId ===
            "voice-leading.unequal-fifths-inner-diminished-to-perfect"
        ) {
          const previousDiminished = isDiminishedFifth(fact.previousInterval);
          const currentDiminished = isDiminishedFifth(fact.currentInterval);
          const previousPerfect = isPerfectFifth(fact.previousInterval);
          const currentPerfect = isPerfectFifth(fact.currentInterval);
          matches =
            similarMotion &&
            ((ruleId ===
              "voice-leading.unequal-fifths-perfect-to-diminished" &&
              previousPerfect &&
              currentDiminished) ||
              (ruleId ===
                "voice-leading.unequal-fifths-outer-diminished-to-perfect" &&
                fact.outerVoicesOnly &&
                previousDiminished &&
                currentPerfect) ||
              (ruleId ===
                "voice-leading.unequal-fifths-inner-diminished-to-perfect" &&
                fact.includesInnerVoice &&
                previousDiminished &&
                currentPerfect));
        } else if (
          ruleId === "voice-leading.parallel-fifths" ||
          ruleId === "voice-leading.parallel-octaves"
        ) {
          const previousMatches =
            ruleId === "voice-leading.parallel-fifths"
              ? isPerfectFifth(fact.previousInterval)
              : Math.abs(fact.previousInterval.diatonicSteps) % 7 === 0 &&
                previousInterval === 0;
          const currentMatches =
            ruleId === "voice-leading.parallel-fifths"
              ? isPerfectFifth(fact.currentInterval)
              : Math.abs(fact.currentInterval.diatonicSteps) % 7 === 0 &&
                currentInterval === 0;
          matches = similarMotion && previousMatches && currentMatches;
        } else if (
          ruleId === "voice-leading.hidden-fifth" ||
          ruleId === "voice-leading.hidden-octave"
        ) {
          const currentMatches =
            ruleId === "voice-leading.hidden-fifth"
              ? isPerfectFifth(fact.currentInterval)
              : Math.abs(fact.currentInterval.diatonicSteps) % 7 === 0 &&
                currentInterval === 0;
          const previousMatches =
            ruleId === "voice-leading.hidden-fifth"
              ? isPerfectFifth(fact.previousInterval)
              : Math.abs(fact.previousInterval.diatonicSteps) % 7 === 0 &&
                previousInterval === 0;
          matches =
            fact.outerVoicesOnly &&
            similarMotion &&
            currentMatches &&
            !previousMatches &&
            Math.abs(toMidi(currentUpper.pitch) - toMidi(previousUpper.pitch)) >
              2;
        } else {
          const adjacent =
            VOICE_ORDER.indexOf(lowerId) === VOICE_ORDER.indexOf(upperId) + 1;
          matches =
            adjacent &&
            (toMidi(currentUpper.pitch) < toMidi(previousLower.pitch) ||
              toMidi(currentLower.pitch) > toMidi(previousUpper.pitch));
        }
        if (!matches) return;
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
              causeRefs: [
                `${ruleId}|${transition.id}|voices:${upperId},${lowerId}`,
              ],
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
            },
          ),
        );
    });
  });
  return diagnostics;
}
