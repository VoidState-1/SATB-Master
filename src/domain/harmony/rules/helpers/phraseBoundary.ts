import type { HarmonyRuleContext } from "../context/createRuleContext";

export function crossesManualPhraseBoundary(
  context: Pick<HarmonyRuleContext, "analysis">, fromTick: number, toTick: number,
) {
  return context.analysis.phraseBoundaries.some(boundary =>
    boundary.source === "manual" && fromTick < boundary.tick && boundary.tick <= toTick);
}
