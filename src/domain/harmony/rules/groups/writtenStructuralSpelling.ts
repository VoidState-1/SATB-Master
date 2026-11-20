import { pitchClassEquals } from "../../../pitch";
import type { MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { readWrittenAugmentedSixthSpelling } from "./writtenAugmentedSixthSpelling";
import { readWrittenDominantSpelling } from "./writtenDominantSpelling";
import { readWrittenSupertonicSpelling } from "./writtenSupertonicSpelling";

export function readWrittenStructuralSpelling(context: HarmonyRuleContext, transition: MelodyTransition) {
  const readings = [
    readWrittenDominantSpelling(context, transition),
    readWrittenAugmentedSixthSpelling(context, transition),
    readWrittenSupertonicSpelling(context, transition),
  ].filter(reading => reading !== undefined);
  const first = readings[0];
  if (first && readings.every(reading =>
    pitchClassEquals(reading.previous, first.previous) && pitchClassEquals(reading.current, first.current))) return first;
}
