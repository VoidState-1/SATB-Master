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
export * from "./progressionSearch";

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
    let paths = solveHarmonization(grid, style, limit);
    while (paths.length) {
      for (const path of paths) {
        const solution = verifyPath(project, grid, path, respectLocks);
        if (solution) solutions.push(solution);
      }
      const level = paths[0].relaxedLevel;
      if (level === 2 || solutions.some(solution => solution.diagnosticSummary.errorCount === 0)) break;
      paths = solveHarmonization(grid, style, limit, level === 0 ? 1 : 2);
    }
    solutions.sort((left, right) =>
      left.diagnosticSummary.errorCount - right.diagnosticSummary.errorCount ||
      left.diagnosticSummary.warningCount - right.diagnosticSummary.warningCount ||
      left.diagnosticSummary.suggestionCount - right.diagnosticSummary.suggestionCount ||
      right.score - left.score);
    if (style === "expressive-secondary" && solutions.length > 1) {
      const labels = new Set([solutions[0].label]);
      for (let index = 1; index < Math.min(maxSolutions, solutions.length); index++) {
        const current = solutions[index];
        const alternate = solutions.findIndex((solution, position) => position >= index &&
          solution.diagnosticSummary.errorCount === current.diagnosticSummary.errorCount &&
          solution.diagnosticSummary.warningCount === current.diagnosticSummary.warningCount &&
          !labels.has(solution.label));
        if (alternate > index) solutions.splice(index, 0, ...solutions.splice(alternate, 1));
        labels.add(solutions[index].label);
      }
    }
    if (!solutions.length) warnings.push("选区内未能构造可用的和声方案。");
    else warnings.push(...solutions[0].warnings);
  } else {
    warnings.push("选区内没有给定声部音符。");
  }
  return {
    givenVoice: grid.givenVoice, style, range: grid.range, warnings,
    solutions: structuredClone(solutions.slice(0, maxSolutions)),
    elapsedMs: performance.now() - start,
  };
}
