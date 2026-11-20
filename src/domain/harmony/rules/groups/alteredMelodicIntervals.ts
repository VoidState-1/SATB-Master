import { formatPitchClass, formatSpelledPitch, pitchClassEquals } from "../../../pitch";
import type { MelodyTransition } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { diagnostic, intervalName, noteEvidence, voiceName } from "../helpers/core";
import { sameHarmonyAtMelodicAttack } from "../helpers/motionHarmony";
import { isWrittenLowerNeighborMotion } from "../helpers/writtenLowerNeighborPair";
import { resolvesGermanSixthDiminishedThird } from "./chromaticAugmentedSixth";
import { resolvesRaisedSecondApproach } from "./chromaticDoubleDominant";
import { chromaticPassingSpellingCorrections } from "./chromaticPassing";
import { readDominantSeventhHandoffSpelling } from "./dominantSeventhHandoffSpelling";
import { resolvesContextualMinorDominantSixth } from "./dominantSixthSubstitution";
import { halfDiminishedChainArrivals } from "./halfDiminishedChain";
import { isMinorSixthChordBassLine } from "./minorSixthChordBass";
import { isNeapolitanSeventhBassTritone } from "./neapolitanSeventhBass";
import { resolvesDominantSeventhEntry } from "./resolvedDominantSeventhEntry";
import { isResolvedDominantSixthBass } from "./resolvedDominantSixthBass";
import { readWrittenStructuralSpelling } from "./writtenStructuralSpelling";

const AUGMENTED = "melody.augmented-interval";

function hasSupportedDiminishedMotion(context: HarmonyRuleContext, motion: MelodyTransition) {
  return isMinorSixthChordBassLine(context, motion) ||
    isResolvedDominantSixthBass(context, motion) ||
    resolvesDominantSeventhEntry(context, motion) ||
    resolvesRaisedSecondApproach(context, motion) ||
    resolvesGermanSixthDiminishedThird(context, motion) ||
    isWrittenLowerNeighborMotion(context, motion);
}

function chromaticSpellingDiagnostic(
  context: HarmonyRuleContext,
  transition: MelodyTransition,
  named: ReturnType<typeof intervalName>,
  corrections: ReturnType<typeof chromaticPassingSpellingCorrections>,
): RuleDiagnostic | undefined {
  const { previous, current, voiceId } = transition;
  // An established chordal reading takes precedence over a conjectured passing note.
  const handoff = readDominantSeventhHandoffSpelling(context, transition);
  const spelling = handoff ?? readWrittenStructuralSpelling(context, transition);
  const correction = corrections.get(transition.id);
  if (!spelling && !correction) return;
  const notes = [previous, current];
  const evidence = [noteEvidence(previous, "前一音"), noteEvidence(current, "当前音")];
  const options = {
    melodyTransitionId: transition.id,
    params: { intervalNumber: named.number, quality: named.quality, semitones: 1 },
  };
  if (spelling) {
    const expected = [spelling.previous, spelling.current];
    const incorrect = notes.flatMap((note, i) => pitchClassEquals(note.pitch, expected[i])
      ? [] : [`${formatSpelledPitch(note.pitch)} 宜写为 ${formatPitchClass(expected[i])}`]);
    if (!incorrect.length) return;
    if (handoff) evidence.push(
      noteEvidence(handoff.resolvingSeventh, "另一声部的原七音"),
      noteEvidence(handoff.resolvedThird, "同次进行解决到新三音"),
    );
    return diagnostic(AUGMENTED, current.startTick, current.startTick + current.durationTicks,
      [voiceId], notes, "和声性半音的拼写", incorrect.join("，") + "。", {
        ...options, motionSameHarmony: handoff ? false : undefined,
        messageKey: `${AUGMENTED}.structural-spelling`, evidence,
      });
  }
  if (!correction) return;
  evidence.push({ kind: "interval", label: "书写音程", value: named.label });
  return diagnostic(AUGMENTED, current.startTick, current.startTick + current.durationTicks,
    [voiceId], notes, "半音经过音的拼写",
    `单声部半音经过时，${formatSpelledPitch(correction.note.pitch)} 建议写为同音高的 ${formatSpelledPitch(correction.spelling)}。`, {
      ...options, motionSameHarmony: sameHarmonyAtMelodicAttack(context, current.startTick, voiceId),
      messageKey: `${AUGMENTED}.passing-spelling`, evidence,
    });
}

function alteredIntervalRule(context: HarmonyRuleContext, expectedQuality: "增" | "减") {
  const augmented = expectedQuality === "增";
  const ruleId = augmented ? AUGMENTED : "melody.diminished-interval";
  const diagnostics: RuleDiagnostic[] = [];
  const corrections = augmented ? chromaticPassingSpellingCorrections(context) : undefined;
  const chain = augmented ? undefined : halfDiminishedChainArrivals(context);
  for (const transition of context.melodyTransitions().where(item => item.contiguous)) {
    const { previous, current, voiceId, writtenInterval } = transition;
    const named = intervalName(writtenInterval);
    const semitones = Math.abs(writtenInterval.semitones);
    // §32: a chromatic alteration normally occurs in the same voice. Its mere
    // presence cannot diagnose a mistake, even when the harmony is unknown.
    if (corrections && semitones === 1 && named.quality !== "减") {
      const issue = chromaticSpellingDiagnostic(context, transition, named, corrections);
      if (issue) diagnostics.push(issue);
      continue;
    }
    if (named.quality !== expectedQuality || semitones === 0 ||
        isNeapolitanSeventhBassTritone(context, transition) ||
        chain?.has(current.id) || (!augmented && hasSupportedDiminishedMotion(context, transition))) continue;

    const attack = context.sliceAt(current.startTick);
    // The following 6→5 stays within V7. That internal continuity cannot
    // exempt a separate melodic leap into the proved start of this V7.
    const contextualDominantOnset = attack && attack.notes.bass?.startTick === attack.tick &&
      attack.notes.soprano?.startTick === attack.tick && resolvesContextualMinorDominantSixth(attack, context);
    diagnostics.push(diagnostic(ruleId, current.startTick, current.startTick + current.durationTicks,
      [voiceId], [previous, current], "旋律出现增减音程",
      `${voiceName(context.analysis, voiceId)}的 ${formatSpelledPitch(previous.pitch)} 到 ${formatSpelledPitch(current.pitch)} 构成${named.label}。`, {
        motionSameHarmony: contextualDominantOnset
          ? sameHarmonyAtMelodicAttack(context, current.startTick, voiceId) : undefined,
        messageKey: `${ruleId}.${named.quality}`,
        params: { intervalNumber: named.number, quality: named.quality, semitones },
        evidence: [noteEvidence(previous, "前一音"), noteEvidence(current, "当前音"),
          { kind: "interval", label: "书写音程", value: named.label }],
      }));
  }
  return diagnostics;
}

export function augmentedIntervalRule(context: HarmonyRuleContext) {
  return alteredIntervalRule(context, "增");
}

export function diminishedIntervalRule(context: HarmonyRuleContext) {
  return alteredIntervalRule(context, "减");
}
