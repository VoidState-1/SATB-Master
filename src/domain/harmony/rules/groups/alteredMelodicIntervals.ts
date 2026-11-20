import { formatPitchClass, formatSpelledPitch, pitchClassEquals } from "../../../pitch";
import type { MelodyTransition } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { diagnostic, intervalName, noteEvidence, voiceName } from "../helpers/core";
import { isWrittenLowerNeighborMotion } from "../helpers/writtenLowerNeighborPair";
import { hasSupportedChromaticPreparation } from "./chromaticUnison";
import { readWrittenDominantSpelling } from "./writtenDominantSpelling";
import { chromaticPassingMotions } from "./chromaticPassing";
import { halfDiminishedChainArrivals } from "./halfDiminishedChain";
import { isMinorSixthChordBassLine } from "./minorSixthChordBass";
import { resolvesContextualMinorDominantSixth } from "./dominantSixthSubstitution";
import { isResolvedDominantSixthBass } from "./resolvedDominantSixthBass";
import { resolvesDominantSeventhEntry } from "./resolvedDominantSeventhEntry";
import { resolvesRaisedSecondApproach } from "./chromaticDoubleDominant";
import { resolvesGermanSixthDiminishedThird } from "./chromaticAugmentedSixth";
import { isNeapolitanSeventhBassTritone } from "./neapolitanSeventhBass";
import { sameHarmonyAtMelodicAttack } from "../helpers/motionHarmony";

function hasSupportedDiminishedMotion(context: HarmonyRuleContext, motion: MelodyTransition) {
  return isResolvedDominantSixthBass(context, motion) ||
    resolvesDominantSeventhEntry(context, motion) ||
    resolvesRaisedSecondApproach(context, motion) ||
    resolvesGermanSixthDiminishedThird(context, motion) ||
    isWrittenLowerNeighborMotion(context, motion);
}

function alteredIntervalRule(
  context: HarmonyRuleContext,
  expectedQuality: "增" | "减",
) {
  const augmented = expectedQuality === "增";
  const ruleId = augmented ? "melody.augmented-interval" : "melody.diminished-interval";
  const supportsMotion = augmented ? hasSupportedChromaticPreparation : hasSupportedDiminishedMotion;
  const diagnostics: RuleDiagnostic[] = [];
  const passing = augmented ? chromaticPassingMotions(context) : undefined;
  const chain = halfDiminishedChainArrivals(context, expectedQuality);
  for (const transition of context.melodyTransitions().where(item => item.contiguous)) {
    const named = intervalName(transition.writtenInterval);
    if (augmented && named.quality !== "减") {
      const spelling = readWrittenDominantSpelling(context, transition);
      if (spelling) {
        const notes = [transition.previous, transition.current];
        const expected = [spelling.previous, spelling.current];
        const incorrect = notes.flatMap((note, i) => pitchClassEquals(note.pitch, expected[i])
          ? [] : [`${formatSpelledPitch(note.pitch)} 宜写为 ${formatPitchClass(expected[i])}`]);
        if (incorrect.length) {
          diagnostics.push(diagnostic(ruleId, transition.current.startTick,
            transition.current.startTick + transition.current.durationTicks, [transition.voiceId], notes,
            "和声性半音的拼写", incorrect.join("，") + "。",
            {
              melodyTransitionId: transition.id,
              messageKey: `${ruleId}.structural-spelling`,
              params: { intervalNumber: named.number, quality: named.quality, semitones: 1 },
              evidence: [noteEvidence(transition.previous, "前一音"), noteEvidence(transition.current, "当前音")],
            }));
        }
        continue;
      }
    }
    if (
      !named.altered ||
      named.quality !== expectedQuality ||
      Math.abs(transition.writtenInterval.semitones) === 0 ||
      isNeapolitanSeventhBassTritone(context, transition) ||
      passing?.supported.has(transition.id) ||
      chain.has(transition.current.id) ||
      isMinorSixthChordBassLine(context, transition) ||
      supportsMotion(context, transition)
    )
      continue;
    const attack = context.sliceAt(transition.current.startTick);
    // The following 6→5 stays within V7. That internal continuity cannot
    // exempt a separate melodic leap into the proved start of this V7.
    const contextualDominantOnset = attack && attack.notes.bass?.startTick === attack.tick &&
      attack.notes.soprano?.startTick === attack.tick &&
      resolvesContextualMinorDominantSixth(attack, context);
    const correction = passing?.corrections.get(transition.id);
    const message = correction
      ? `单声部半音经过时，${formatSpelledPitch(correction.note.pitch)} 建议写为同音高的 ${formatSpelledPitch(correction.spelling)}。`
      : `${voiceName(context.analysis, transition.voiceId)}的 ${formatSpelledPitch(transition.previous.pitch)} 到 ${formatSpelledPitch(transition.current.pitch)} 构成${named.label}。`;
    diagnostics.push(
      diagnostic(
        ruleId,
        transition.current.startTick,
        transition.current.startTick + transition.current.durationTicks,
        [transition.voiceId],
        [transition.previous, transition.current],
        correction ? "半音经过音的拼写" : "旋律出现增减音程",
        message,
        {
          melodyTransitionId: correction ? transition.id : undefined,
          motionSameHarmony: correction || contextualDominantOnset
            ? sameHarmonyAtMelodicAttack(context, transition.current.startTick, transition.voiceId)
            : undefined,
          messageKey: correction ? `${ruleId}.passing-spelling` : `${ruleId}.${named.quality}`,
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
  }
  return diagnostics;
}

export function augmentedIntervalRule(context: HarmonyRuleContext) {
  return alteredIntervalRule(context, "增");
}

export function diminishedIntervalRule(context: HarmonyRuleContext) {
  return alteredIntervalRule(context, "减");
}
