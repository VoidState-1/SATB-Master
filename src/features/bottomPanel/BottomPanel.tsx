import { useCallback, useState } from "react";
import { AlertCircle, List, Maximize2, Music2 } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { ProjectDocument } from "../../domain/project";
import type {
  HarmonyCheckResult,
  HarmonyDiagnostic,
} from "../../domain/harmony";
import {
  DiagnosticsPanel,
  DiagnosticsSummary,
  LogsPanel,
  type LogFocus,
} from "../diagnostics";
import {
  getInitialHighlightMode,
  HIGHLIGHT_MODE_STORAGE_KEY,
  nextScale,
  SCALE_STEPS,
  ScorePreviewPane,
  ScorePreviewToolbar,
  type ScoreHighlightMode,
  type ScoreNoteSelection,
} from "../scorePreview";
import type { ScorePreviewWarning } from "../../domain/notation";

export type BottomPanelTab = "diagnostics" | "score" | "logs";

export interface BottomPanelProps {
  activeTab: BottomPanelTab;
  onTabChange(tab: BottomPanelTab): void;
  project: ProjectDocument;
  harmonyResult: HarmonyCheckResult;
  onSelectDiagnostic(diagnostic: HarmonyDiagnostic): void;
  onToggleIgnoredDiagnostic(diagnostic: HarmonyDiagnostic): void;
  onCopyDiagnostic?(diagnostic: HarmonyDiagnostic): void;
  developerMode?: boolean;
  showLogs?: boolean;
  unreadLogErrors?: number;
  logFocus?: LogFocus;
  revision: number;
  playheadTick: number;
  isPlaying?: boolean;
  selectedNoteIds?: ReadonlySet<string>;
  onSelectScoreNote?(selection: ScoreNoteSelection): void;
  onOpenScoreDialog?(): void;
}

export function BottomPanel({
  activeTab,
  onTabChange,
  project,
  harmonyResult,
  onSelectDiagnostic,
  onToggleIgnoredDiagnostic,
  onCopyDiagnostic,
  developerMode = false,
  showLogs = false,
  unreadLogErrors = 0,
  logFocus,
  revision,
  playheadTick,
  isPlaying = false,
  selectedNoteIds,
  onSelectScoreNote,
  onOpenScoreDialog,
}: BottomPanelProps) {
  // 五线谱面板状态
  const [scale, setScale] = useState(0.9);
  const [followPlayhead, setFollowPlayhead] = useState(false);
  const [highlightMode, setHighlightModeState] = useState<ScoreHighlightMode>(
    getInitialHighlightMode,
  );
  const [scoreModelInfo, setScoreModelInfo] = useState<{
    measureCount: number;
    revision: number;
    warnings: readonly ScorePreviewWarning[];
  }>({
    measureCount: 0,
    revision,
    warnings: [],
  });

  const setHighlightMode = useCallback((mode: ScoreHighlightMode) => {
    setHighlightModeState(mode);
    try {
      window.localStorage.setItem(HIGHLIGHT_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  }, []);

  const canZoomIn = scale < SCALE_STEPS[SCALE_STEPS.length - 1];
  const canZoomOut = scale > SCALE_STEPS[0];

  // 问题统计
  const ignoredDiagnosticIds = new Set(
    project.diagnosticPreferences.ignoredDiagnosticIds,
  );
  const activeDiagnostics = harmonyResult.diagnostics.filter(
    (item) => !ignoredDiagnosticIds.has(item.id),
  );
  const errorCount = activeDiagnostics.filter(
    (item) => item.severity === "error",
  ).length;
  const warningCount = activeDiagnostics.filter(
    (item) => item.severity === "warning",
  ).length;
  const suggestionCount = activeDiagnostics.filter(
    (item) => item.severity === "suggestion",
  ).length;
  const totalIssueCount = activeDiagnostics.length;
  const badgeSeverity =
    errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "suggestion";

  return (
    <section className="bottom-panel" aria-label="底部工作台">
      <header className="bottom-panel-header">
        <div className="bottom-panel-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "diagnostics"}
            className={`bottom-panel-tab ${activeTab === "diagnostics" ? "is-active" : ""}`}
            onClick={() => onTabChange("diagnostics")}
          >
            <AlertCircle aria-hidden="true" />
            <span>问题</span>
            {totalIssueCount > 0 ? (
              <span className={`bottom-tab-badge ${badgeSeverity}`}>
                {totalIssueCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "score"}
            className={`bottom-panel-tab ${activeTab === "score" ? "is-active" : ""}`}
            onClick={() => onTabChange("score")}
          >
            <Music2 aria-hidden="true" />
            <span>五线谱</span>
            {scoreModelInfo.warnings.length > 0 ? (
              <span className="bottom-tab-badge warning">
                {scoreModelInfo.warnings.length}
              </span>
            ) : null}
          </button>
          {developerMode || showLogs || unreadLogErrors > 0 || activeTab === "logs" ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "logs"}
              className={`bottom-panel-tab ${activeTab === "logs" ? "is-active" : ""}`}
              onClick={() => onTabChange("logs")}
            >
              <List aria-hidden="true" />
              <span>日志</span>
              {unreadLogErrors > 0 ? (
                <span className="bottom-tab-badge error" aria-label={`${unreadLogErrors} 条未读错误`}>
                  {unreadLogErrors > 99 ? "99+" : unreadLogErrors}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>

        <div className="bottom-panel-context">
          {activeTab === "diagnostics" ? (
            <DiagnosticsSummary
              result={harmonyResult}
              ignoredCount={
                harmonyResult.diagnostics.length - activeDiagnostics.length
              }
            />
          ) : activeTab === "score" ? (
            <ScorePreviewToolbar
              compact
              scale={scale}
              canZoomIn={canZoomIn}
              canZoomOut={canZoomOut}
              onZoomIn={() => setScale((v) => nextScale(v, 1))}
              onZoomOut={() => setScale((v) => nextScale(v, -1))}
              followPlayhead={followPlayhead}
              onFollowPlayheadChange={setFollowPlayhead}
              highlightMode={highlightMode}
              onHighlightModeChange={setHighlightMode}
              measureCount={scoreModelInfo.measureCount}
              revision={scoreModelInfo.revision}
              extra={
                onOpenScoreDialog ? (
                  <IconButton
                    label="在独立大窗口中打开五线谱"
                    icon={<Maximize2 />}
                    onClick={onOpenScoreDialog}
                  />
                ) : null
              }
            />
          ) : null}
        </div>
      </header>

      <div className="bottom-panel-content">
        {activeTab === "diagnostics" ? (
          <DiagnosticsPanel
            project={project}
            result={harmonyResult}
            onSelect={onSelectDiagnostic}
            onToggleIgnored={onToggleIgnoredDiagnostic}
            onCopy={onCopyDiagnostic}
            developerMode={developerMode}
            hideHeader
          />
        ) : activeTab === "logs" ? (
          <LogsPanel project={project} harmonyResult={harmonyResult} focus={logFocus} />
        ) : (
          <ScorePreviewPane
            project={project}
            revision={revision}
            playheadTick={playheadTick}
            isPlaying={isPlaying}
            selectedNoteIds={selectedNoteIds}
            scale={scale}
            followPlayhead={followPlayhead}
            highlightMode={highlightMode}
            onSelectNote={onSelectScoreNote}
            onModelInfoChange={setScoreModelInfo}
          />
        )}
      </div>
    </section>
  );
}
