import type { ProjectDocument } from "../../project/types";
import { buildMelodyGrid } from "./melodyGrid";
import { solveHarmonization } from "./solver";
import type { AutoHarmonizationOptions, AutoHarmonizationResult, HarmonizationSolution } from "./types";
import { verifyPath } from "./verifyAndApply";

export type {
  AutoHarmonizationApplyOptions,
  AutoHarmonizationOptions,
  AutoHarmonizationResult,
  HarmonizationDiagnosticSummary,
  HarmonizationGivenVoice,
  HarmonizationRange,
  HarmonizationRelaxedLevel,
  HarmonizationSolution,
  HarmonizationStyle,
} from "./types";
export { applyAutoHarmonization } from "./verifyAndApply";

export function autoHarmonize(project: ProjectDocument, options: AutoHarmonizationOptions = {}): AutoHarmonizationResult {
  const start = performance.now();
  const grid = buildMelodyGrid(project, options);
  const style = options.style ?? "textbook-standard";
  const respectLocks = options.respectLockedConstraints ?? true;
  const maxSolutions = Number.isFinite(options.maxSolutions)
    ? Math.min(8, Math.max(1, Math.trunc(options.maxSolutions!))) : 3;
  const warnings: string[] = [];
  const solutions: HarmonizationSolution[] = [];
  if (grid.slices.length) {
    const limit = Math.min(8, maxSolutions + 2);
    const paths = solveHarmonization(grid, style, limit);
    for (const path of paths) {
      const solution = verifyPath(project, grid, path, respectLocks);
      if (solution) solutions.push(solution);
    }
    solutions.sort((left, right) =>
      left.diagnosticSummary.errorCount - right.diagnosticSummary.errorCount ||
      left.diagnosticSummary.warningCount - right.diagnosticSummary.warningCount ||
      left.diagnosticSummary.suggestionCount - right.diagnosticSummary.suggestionCount ||
      right.score - left.score);
    if (!solutions.length) warnings.push("选区内未能构造可用的和声方案。");
    else warnings.push(...solutions[0].warnings);
  } else {
    warnings.push("选区内没有给定声部音符。");
  }
  return {
    givenVoice: grid.givenVoice, style, range: grid.range, warnings,
    solutions: structuredClone(solutions.slice(0, maxSolutions).map((solution, index) =>
      ({ ...solution, label: `方案 ${index + 1}` }))),
    elapsedMs: performance.now() - start,
  };
}
