import { describe, expect, it } from "vitest";
import { searchProgressionCandidates } from "../../domain/harmony/harmonization";
import { createEmptyProject } from "../../domain/project";
import {
  assessProgressionRecommendation,
  classifyProgressionCandidate,
  computeBatchScoreStats,
  groupProgressionCandidates,
} from "./progressionPresentation";

const project = createEmptyProject();
const searchResult = searchProgressionCandidates(project, {
  mode: "single",
  fromTick: 0,
});
const baseCandidate = searchResult.candidates[0]!;
const baseVariant = baseCandidate.variants[0]!;

describe("progressionPresentation", () => {
  it("assigns green, yellow, and red recommendation tiers from score, warnings, errors, and relaxedLevel", () => {
    const highCand = { ...baseCandidate, score: 20, relaxedLevel: 0 as const };
    const midCand = { ...baseCandidate, score: 15, relaxedLevel: 0 as const };
    const lowScoreCand = { ...baseCandidate, score: 8, relaxedLevel: 0 as const };
    const stats = computeBatchScoreStats([highCand, midCand, lowScoreCand]);

    const high = assessProgressionRecommendation(
      highCand,
      { ...baseVariant, score: 20, diagnosticSummary: { errorCount: 0, warningCount: 0, suggestionCount: 0 } },
      stats,
    );
    expect(high.tier).toBe("high");
    expect(high.bars).toBe(3);

    const midByGap = assessProgressionRecommendation(
      midCand,
      { ...baseVariant, score: 15, diagnosticSummary: { errorCount: 0, warningCount: 0, suggestionCount: 0 } },
      stats,
    );
    expect(midByGap.tier).toBe("medium");
    expect(midByGap.bars).toBe(2);

    const midByWarning = assessProgressionRecommendation(
      highCand,
      { ...baseVariant, score: 20, diagnosticSummary: { errorCount: 0, warningCount: 1, suggestionCount: 0 } },
      stats,
    );
    expect(midByWarning.tier).toBe("medium");

    const lowByScore = assessProgressionRecommendation(
      lowScoreCand,
      { ...baseVariant, score: 8, diagnosticSummary: { errorCount: 0, warningCount: 0, suggestionCount: 0 } },
      stats,
    );
    expect(lowByScore.tier).toBe("low");
    expect(lowByScore.bars).toBe(1);

    const lowByError = assessProgressionRecommendation(
      highCand,
      { ...baseVariant, score: 20, diagnosticSummary: { errorCount: 1, warningCount: 0, suggestionCount: 0 } },
      stats,
    );
    expect(lowByError.tier).toBe("low");
    expect(lowByError.label).toBe("慎用");

    const lowByRelaxed = assessProgressionRecommendation(
      { ...highCand, relaxedLevel: 2 },
      { ...baseVariant, score: 20, diagnosticSummary: { errorCount: 0, warningCount: 0, suggestionCount: 0 } },
      stats,
    );
    expect(lowByRelaxed.tier).toBe("low");
  });

  it("groups single-chord candidates by harmonic function and short progressions by musical role", () => {
    const groups = groupProgressionCandidates(searchResult.candidates, "single");
    expect(groups.length).toBeGreaterThan(0);
    const total = groups.reduce((sum, group) => sum + group.candidates.length, 0);
    expect(total).toBe(searchResult.candidates.length);

    const cadenceRole = classifyProgressionCandidate(
      { ...baseCandidate, mode: "short", tag: "正格收束" },
      "short",
    );
    expect(cadenceRole.id).toBe("cadence");

    const bridgeRole = classifyProgressionCandidate(
      { ...baseCandidate, mode: "short", tag: "双向桥接" },
      "short",
    );
    expect(bridgeRole.id).toBe("motion");
  });
});
