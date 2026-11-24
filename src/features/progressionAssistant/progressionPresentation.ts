import { primaryHarmonyInterpretation } from "../../domain/chordModel";
import { effectiveFunctionalDesignation } from "../../domain/functionalHarmonyCatalog";
import type {
  ProgressionCandidate,
  ProgressionSearchMode,
  ProgressionVoicingVariant,
} from "../../domain/harmony/harmonization";

export type RecommendationTier = "high" | "medium" | "low";

export interface RecommendationAssessment {
  tier: RecommendationTier;
  bars: 1 | 2 | 3;
  label: string;
  perStepScore: number;
  scoreGap: number;
  tooltip: string;
}

export interface BatchScoreStats {
  bestPerStep: number;
  minPerStep: number;
  spread: number;
}

export type ProgressionCategoryId =
  | "tonic"
  | "subdominant"
  | "dominant"
  | "chromatic"
  | "cadence"
  | "motion"
  | "smooth"
  | "other";

export interface ProgressionCategoryMeta {
  id: ProgressionCategoryId;
  shortBadge: string;
  label: string;
  order: number;
}

export interface ProgressionCategoryGroup {
  meta: ProgressionCategoryMeta;
  candidates: ProgressionCandidate[];
}

const CATEGORY_META: Record<ProgressionCategoryId, ProgressionCategoryMeta> = {
  tonic: { id: "tonic", shortBadge: "T", label: "主功能", order: 1 },
  subdominant: { id: "subdominant", shortBadge: "S", label: "下属功能", order: 2 },
  dominant: { id: "dominant", shortBadge: "D", label: "属功能", order: 3 },
  cadence: { id: "cadence", shortBadge: "终", label: "终止与收束", order: 4 },
  motion: { id: "motion", shortBadge: "桥", label: "桥接与经过", order: 5 },
  chromatic: { id: "chromatic", shortBadge: "副", label: "色彩 / 副属", order: 6 },
  smooth: { id: "smooth", shortBadge: "进", label: "平稳推进", order: 7 },
  other: { id: "other", shortBadge: "和", label: "其他和声", order: 8 },
};

const CHROMATIC_KINDS = new Set([
  "applied-dominant",
  "applied-leading-tone",
  "double-dominant",
  "double-dominant-leading-tone",
  "neapolitan",
  "augmented-sixth",
  "altered-dominant",
]);

const SINGLE_CATEGORIES: readonly ProgressionCategoryMeta[] = [
  CATEGORY_META.tonic,
  CATEGORY_META.subdominant,
  CATEGORY_META.dominant,
  CATEGORY_META.chromatic,
];

const SHORT_CATEGORIES: readonly ProgressionCategoryMeta[] = [
  CATEGORY_META.cadence,
  CATEGORY_META.smooth,
  CATEGORY_META.motion,
  CATEGORY_META.chromatic,
];

export function categoriesForMode(
  mode: ProgressionSearchMode,
): readonly ProgressionCategoryMeta[] {
  return mode === "short" ? SHORT_CATEGORIES : SINGLE_CATEGORIES;
}

export function classifyProgressionCandidate(
  candidate: ProgressionCandidate,
  mode: ProgressionSearchMode = candidate.mode,
): ProgressionCategoryMeta {
  if (mode === "short" || candidate.steps.length > 1) {
    switch (candidate.tag) {
      case "正格收束":
      case "半终止":
      case "阻碍进行":
        return CATEGORY_META.cadence;
      case "双向桥接":
      case "经过四六":
      case "辅助延长":
        return CATEGORY_META.motion;
      case "副属推进":
        return CATEGORY_META.chromatic;
      default:
        return CATEGORY_META.smooth;
    }
  }

  const firstChord = candidate.steps[0]?.chord;
  if (!firstChord) return CATEGORY_META.other;

  const { identity, semantics } = firstChord;
  const interpretation = primaryHarmonyInterpretation(semantics);
  const quality =
    identity.structure.kind === "tertian" ? identity.structure.quality : undefined;
  const designation = effectiveFunctionalDesignation(semantics, quality);

  if (
    interpretation?.appliedTarget ||
    (designation?.kind && CHROMATIC_KINDS.has(designation.kind)) ||
    semantics.mixture
  ) {
    return CATEGORY_META.chromatic;
  }

  if (designation?.primaryFunction === "tonic") return CATEGORY_META.tonic;
  if (designation?.primaryFunction === "subdominant") return CATEGORY_META.subdominant;
  if (designation?.primaryFunction === "dominant") return CATEGORY_META.dominant;

  const degree = interpretation?.degree;
  if (degree === 1 || degree === 6) return CATEGORY_META.tonic;
  if (degree === 4 || degree === 2) return CATEGORY_META.subdominant;
  if (degree === 5 || degree === 7 || degree === 3) return CATEGORY_META.dominant;
  return CATEGORY_META.other;
}

export function groupProgressionCandidates(
  candidates: readonly ProgressionCandidate[],
  mode: ProgressionSearchMode,
): ProgressionCategoryGroup[] {
  const byCategory = new Map<ProgressionCategoryId, ProgressionCategoryGroup>();
  for (const candidate of candidates) {
    const meta = classifyProgressionCandidate(candidate, mode);
    let group = byCategory.get(meta.id);
    if (!group) {
      group = { meta, candidates: [] };
      byCategory.set(meta.id, group);
    }
    group.candidates.push(candidate);
  }
  return [...byCategory.values()].sort((a, b) => {
    const scoreDiff =
      Math.max(...b.candidates.map((c) => c.score / Math.max(1, c.steps.length))) -
      Math.max(...a.candidates.map((c) => c.score / Math.max(1, c.steps.length)));
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
    return a.meta.order - b.meta.order;
  });
}

export function computeBatchScoreStats(
  candidates: readonly ProgressionCandidate[],
): BatchScoreStats {
  if (!candidates.length) {
    return { bestPerStep: 0, minPerStep: 0, spread: 0 };
  }
  let bestPerStep = -Infinity;
  let minPerStep = Infinity;
  for (const candidate of candidates) {
    const perStep = candidate.score / Math.max(1, candidate.steps.length);
    if (perStep > bestPerStep) bestPerStep = perStep;
    if (perStep < minPerStep) minPerStep = perStep;
  }
  return {
    bestPerStep,
    minPerStep,
    spread: Math.max(0, bestPerStep - minPerStep),
  };
}

export function assessProgressionRecommendation(
  candidate: ProgressionCandidate,
  variant: ProgressionVoicingVariant,
  stats: BatchScoreStats,
): RecommendationAssessment {
  const stepCount = Math.max(1, variant.steps.length);
  const perStepScore = variant.score / stepCount;
  const scoreGap = Math.max(0, stats.bestPerStep - perStepScore);
  const { errorCount, warningCount } = variant.diagnosticSummary;
  const formattedScore = `${perStepScore >= 0 ? "+" : ""}${perStepScore.toFixed(1)}`;
  const gapSuffix = scoreGap > 0.05 ? `（较最优低 ${scoreGap.toFixed(1)}）` : "（当前最优）";

  if (errorCount > 0 || candidate.relaxedLevel === 2) {
    const reason =
      errorCount > 0
        ? `含 ${errorCount} 项和声错误`
        : "已启用兜底放宽限制";
    return {
      tier: "low",
      bars: 1,
      label: "慎用",
      perStepScore,
      scoreGap,
      tooltip: `慎用 · ${reason} · 搜索分 ${formattedScore}`,
    };
  }

  if (stats.spread >= 6 && scoreGap > Math.max(7.5, stats.spread * 0.72)) {
    return {
      tier: "low",
      bars: 1,
      label: "较低",
      perStepScore,
      scoreGap,
      tooltip: `建议度较低 · 搜索分 ${formattedScore}${gapSuffix}`,
    };
  }

  if (
    warningCount > 0 ||
    candidate.relaxedLevel === 1 ||
    (stats.spread >= 2 && scoreGap > Math.max(2.5, stats.spread * 0.35))
  ) {
    const detail =
      warningCount > 0
        ? `含 ${warningCount} 项警告`
        : candidate.relaxedLevel === 1
          ? "轻度放宽配声"
          : `搜索分 ${formattedScore}${gapSuffix}`;
    return {
      tier: "medium",
      bars: 2,
      label: "备选",
      perStepScore,
      scoreGap,
      tooltip: `备选 · ${detail}`,
    };
  }

  return {
    tier: "high",
    bars: 3,
    label: "推荐",
    perStepScore,
    scoreGap,
    tooltip: `强烈推荐 · 搜索分 ${formattedScore}${gapSuffix}`,
  };
}
