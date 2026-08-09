import type { HarmonyAnalysis } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import { formatSpelledPitch } from "../../../pitch";
import {
  diagnostic,
  intervalName,
  noteEvidence,
  voiceName,
} from "../helpers/core";

function validMelodyTransitions(analysis: HarmonyAnalysis) {
  return analysis.melodyTransitions.filter((transition) => transition.contiguous);
}

export function melodicLeapRule(
  analysis: HarmonyAnalysis,
  ruleId: "melody.leap-over-octave" | "melody.large-leap" | "melody.tritone",
) {
  const diagnostics: RuleDiagnostic[] = [];
  validMelodyTransitions(analysis).forEach((transition) => {
    const interval = Math.abs(transition.writtenInterval.semitones);
    const writtenName = intervalName(transition.writtenInterval);
    const matches =
      ruleId === "melody.leap-over-octave"
        ? interval > 12
        : ruleId === "melody.large-leap"
          ? interval > 7 && interval <= 12
          : writtenName.altered &&
            ((writtenName.number === 4 && writtenName.quality === "增") ||
              (writtenName.number === 5 && writtenName.quality === "减"));
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
        },
      ),
    );
  });
  return diagnostics;
}

export function augmentedDiminishedIntervalRule(
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
        },
      ),
    );
  });
  return diagnostics;
}
