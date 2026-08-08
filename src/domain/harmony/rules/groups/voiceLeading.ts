import { analysisKeyAtTick, type HarmonyAnalysis } from "../../analysis";
import type { RuleConfig, RuleDiagnostic } from "../../runtime";
import type { RuleExceptionContext } from "../../ruleTypes";
import { VOICE_ORDER } from "../../../project";
import {
  formatSpelledPitch,
  pitchClassEquals,
  toMidi,
  writtenInterval,
} from "../../../pitch";
import { bassMotionFact } from "../sharedFacts";
import {
  diagnostic,
  direction,
  isDiminishedFifth,
  isPerfectFifth,
  noteEvidence,
  pitchClass,
  voiceName,
} from "../helpers/core";

export function crossRelationRule(
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
