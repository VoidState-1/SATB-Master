import { pitchClassEquals, type SpelledPitchClass } from "../../../pitch";
import type { MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { readDoubleDominantResolution } from "../helpers/doubleDominantResolution";
import { readWrittenAugmentedSixthSpelling } from "./writtenAugmentedSixthSpelling";
import { readWrittenDominantSpelling } from "./writtenDominantSpelling";
import { readWrittenSupertonicSpelling } from "./writtenSupertonicSpelling";

interface StructuralSpelling {
  previous: SpelledPitchClass;
  current: SpelledPitchClass;
  motionSameHarmony?: false;
  reason?: string;
}

function readResolvingSeventhSpelling(context: HarmonyRuleContext, transition: MelodyTransition): StructuralSpelling | undefined {
  if (transition.voiceId === "bass" || transition.writtenInterval.semitones !== 1) return;
  const tick = transition.current.startTick;
  const source = context.sliceAt(tick - 1), target = context.sliceAt(tick);
  if (!source || !target) return;
  const resolution = readDoubleDominantResolution(context, source, target);
  if (resolution?.voiceId === transition.voiceId) return {
    ...resolution,
    motionSameHarmony: false,
    reason: "此处重属导减七和弦进入 K46，升Ⅱ级在原声部上行解决到Ⅲ级。",
  };
}

export function readWrittenStructuralSpelling(context: HarmonyRuleContext, transition: MelodyTransition): StructuralSpelling | undefined {
  const readings = [
    readResolvingSeventhSpelling(context, transition),
    readWrittenDominantSpelling(context, transition),
    readWrittenAugmentedSixthSpelling(context, transition),
    readWrittenSupertonicSpelling(context, transition),
  ].filter(reading => reading !== undefined);
  const first = readings[0];
  if (first && readings.every(reading =>
    pitchClassEquals(reading.previous, first.previous) && pitchClassEquals(reading.current, first.current))) return first;
}
