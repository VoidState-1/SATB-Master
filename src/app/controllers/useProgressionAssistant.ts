import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { replaceProject } from "../../domain/editing";
import {
  applyProgressionCandidate,
  type HarmonizationStyle,
  type ProgressionSearchMode,
  type ProgressionSearchResult,
  type ProgressionShortLength,
  type ProgressionStepPreset,
} from "../../domain/harmony/harmonization";
import type { ProjectDocument } from "../../domain/project";
import type { useAppNotices } from "../../components/AppNoticeStack";
import type { ProgressionPreview } from "../../features/editor";
import type { ProgressionAssistantPanelProps, ProgressionSelection } from "../../features/progressionAssistant";
import { logger } from "../../services/logging";
import type { ProgressionSearchRequest, ProgressionSearchResponse } from "../../workers/progressionSearch.worker";
import type { PlaybackController } from "./usePlaybackController";

interface ProgressionAssistantOptions {
  enabled: boolean;
  isPlaying: boolean;
  project: ProjectDocument;
  playheadTick: number;
  setPlayheadTick(tick: number): void;
  gridTicks: number;
  commit(project: ProjectDocument): void;
  stopPlayback: PlaybackController["handleStop"];
  auditionProject: PlaybackController["handleAuditionProject"];
  showNotice: ReturnType<typeof useAppNotices>["showNotice"];
}

const SEARCH_DELAY_MS = 60;
const SLOW_SEARCH_MS = 150;
const LOG_INTERVAL_MS = 5_000;

function searchInWorker(request: ProgressionSearchRequest, onResponse: (response: ProgressionSearchResponse) => void) {
  const worker = new Worker(new URL("../../workers/progressionSearch.worker.ts", import.meta.url), { type: "module" });
  const finish = (response: ProgressionSearchResponse) => {
    worker.terminate();
    onResponse(response);
  };
  worker.onmessage = (event: MessageEvent<ProgressionSearchResponse>) => finish(event.data);
  worker.onerror = event => {
    event.preventDefault();
    finish({ error: event.message || "和声连接搜索线程启动失败" });
  };
  worker.onmessageerror = () => finish({ error: "无法读取和声连接搜索结果" });
  try {
    worker.postMessage(request);
  } catch (error) {
    worker.terminate();
    throw error;
  }
  return () => worker.terminate();
}

export function useProgressionAssistant({
  enabled, isPlaying, project, playheadTick, setPlayheadTick, gridTicks, commit, stopPlayback, auditionProject, showNotice,
}: ProgressionAssistantOptions) {
  const [mode, setMode] = useState<ProgressionSearchMode>("single");
  const [shortLength, setShortLength] = useState<ProgressionShortLength>(3);
  const [stepPreset, setStepPreset] = useState<ProgressionStepPreset>("beat");
  const [style, setStyle] = useState<HarmonizationStyle>("textbook-standard");
  const [writeChordsPreference, setWriteChords] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const writeChords = writeChordsPreference && !project.chordTrack.locked;
  const cursor = enabled && !isPlaying ? playheadTick : undefined;
  const stepTicks = stepPreset === "grid" ? gridTicks : undefined;
  const query = useMemo(() => cursor === undefined ? undefined : ({
    request: {
      project,
      options: { fromTick: cursor, mode, shortLength, stepTicks, stepBeats: stepPreset === "half-bar" ? 2 : 1, style },
    } satisfies ProgressionSearchRequest,
    refresh,
  }), [cursor, mode, project, refresh, shortLength, stepPreset, stepTicks, style]);
  const [completed, setCompleted] = useState<{ query: NonNullable<typeof query>; response: ProgressionSearchResponse }>();
  const isSameQuery = Boolean(
    query &&
    completed &&
    completed.query.request.project === query.request.project &&
    completed.query.refresh === query.refresh &&
    completed.query.request.options.fromTick === query.request.options.fromTick &&
    completed.query.request.options.mode === query.request.options.mode &&
    completed.query.request.options.shortLength === query.request.options.shortLength &&
    completed.query.request.options.stepTicks === query.request.options.stepTicks &&
    completed.query.request.options.stepBeats === query.request.options.stepBeats &&
    completed.query.request.options.style === query.request.options.style,
  );
  const response = isSameQuery ? completed?.response : undefined;
  const freshResult: ProgressionSearchResult | undefined =
    response && "result" in response ? response.result : undefined;
  const previousResult: ProgressionSearchResult | undefined =
    enabled && !isPlaying && completed?.response && "result" in completed.response
      ? completed.response.result
      : undefined;
  const result: ProgressionSearchResult | undefined = freshResult;
  const isSearching = !isPlaying && !response;
  const displayResult: ProgressionSearchResult | undefined =
    freshResult ?? (isSearching ? previousResult : undefined);
  const isRefreshing = isSearching && Boolean(displayResult);
  const lastLog = useRef({ slow: -Infinity, error: -Infinity });
  const [hovered, setHovered] = useState<ProgressionSelection>();
  const [auditioning, setAuditioning] = useState<ProgressionSelection>();
  const audition = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    if (!query || isSameQuery) return;
    const { request } = query;
    let cancel: (() => void) | undefined;
    let active = true;
    const finish = (next: ProgressionSearchResponse) => {
      if (!active) return;
      const now = performance.now();
      if ("error" in next && now - lastLog.current.error >= LOG_INTERVAL_MS) {
        lastLog.current.error = now;
        logger.error("harmonization", "和声连接搜索失败", {
          code: "HARMONIZATION_FAILED", error: new Error(next.error), context: request.options,
        });
      } else if ("result" in next && next.result.elapsedMs >= SLOW_SEARCH_MS &&
          now - lastLog.current.slow >= LOG_INTERVAL_MS) {
        lastLog.current.slow = now;
        logger.warn("harmonization", "和声连接搜索耗时较长", {
          context: { ...request.options, durationMs: next.result.elapsedMs },
        });
      }
      setCompleted({ query, response: next });
    };
    const timer = window.setTimeout(() => {
      try {
        cancel = searchInWorker(request, finish);
      } catch (error) {
        finish({ error: error instanceof Error ? error.message : String(error) });
      }
    }, SEARCH_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
      cancel?.();
    };
  }, [query, isSameQuery]);

  const stopAudition = useCallback(() => {
    if (!audition.current) return;
    const request = audition.current;
    audition.current = undefined;
    request.abort();
    setAuditioning(undefined);
  }, []);
  useLayoutEffect(() => stopAudition, [query, stopAudition]);

  // History retains exact project snapshots. Cursor moves are attached only to a
  // progression commit's two snapshots, leaving ordinary edits and navigation alone.
  const cursorByCommit = useRef(new WeakMap<ProjectDocument, {
    before: WeakRef<ProjectDocument>; fromTick: number; toTick: number;
  }>());
  const previousProject = useRef(project);
  useLayoutEffect(() => {
    const previous = previousProject.current;
    previousProject.current = project;
    if (previous === project) return;
    const undone = cursorByCommit.current.get(previous);
    const redone = cursorByCommit.current.get(project);
    if (undone?.before.deref() === project) setPlayheadTick(undone.fromTick);
    else if (redone?.before.deref() === previous) setPlayheadTick(redone.toTick);
  }, [project, setPlayheadTick]);

  const activeHover = hovered && result?.candidates.includes(hovered.candidate) ? hovered : undefined;
  const steps = activeHover?.candidate.variants[activeHover.variantIndex]?.steps;
  const slot = result?.slot;
  const preview: ProgressionPreview | undefined = slot && {
    slotRange: { fromTick: slot.fromTick, toTick: slot.spanEndTick ?? slot.toTick },
    ghostNotes: steps?.flatMap(step => step.generatedVoices.map(voice => ({
      id: `${step.fromTick}-${voice}`,
      voice,
      startTick: step.fromTick,
      durationTicks: step.toTick - step.fromTick,
      pitch: step.notes[voice],
    }))),
    ghostChords: writeChords ? steps?.map(step => ({
      fromTick: step.fromTick,
      toTick: step.toTick,
      label: step.chord.label,
    })) : undefined,
  };

  const panel: Omit<ProgressionAssistantPanelProps, "project"> = {
    status: isPlaying ? "paused" : !response ? "searching" : "error" in response ? "error" : "ready",
    isRefreshing,
    result: displayResult,
    mode,
    shortLength,
    stepPreset,
    style,
    writeChords,
    auditioning: auditioning && result?.candidates.includes(auditioning.candidate) ? auditioning : undefined,
    onModeChange: setMode,
    onShortLengthChange: setShortLength,
    onStepPresetChange: setStepPreset,
    onStyleChange: setStyle,
    onWriteChordsChange: setWriteChords,
    onRefresh: () => setRefresh(value => value + 1),
    onHoverCandidate(selection) {
      setHovered(current => current?.candidate === selection?.candidate && current?.variantIndex === selection?.variantIndex
        ? current : selection);
    },
    onAudition(candidate, variantIndex) {
      const variant = candidate.variants[variantIndex];
      if (!result?.candidates.includes(candidate) || !variant) return;
      stopAudition();
      stopPlayback();
      const request = new AbortController();
      audition.current = request;
      setAuditioning({ candidate, variantIndex });
      const onEnded = () => {
        if (audition.current !== request) return;
        audition.current = undefined;
        setAuditioning(undefined);
      };
      void auditionProject(variant.previewProject, candidate.previewRange, request.signal, onEnded).catch(onEnded);
    },
    onStopAudition: stopAudition,
    onApply(candidate, variantIndex, options) {
      if (!result?.candidates.includes(candidate)) return;
      stopAudition();
      setHovered(undefined);
      const context = { mode, fromTick: candidate.fromTick, toTick: candidate.toTick, variantIndex, writeChords: options.writeChords };
      try {
        const applied = applyProgressionCandidate(project, candidate, { ...options, variantIndex });
        const nextProject = replaceProject(project, draft => {
          draft.satbTracks = applied.project.satbTracks;
          draft.chordTrack = applied.project.chordTrack;
        });
        cursorByCommit.current.set(nextProject, { before: new WeakRef(project), fromTick: playheadTick, toTick: applied.nextCursorTick });
        commit(nextProject);
        setPlayheadTick(applied.nextCursorTick);
        logger.recordBreadcrumb("harmonization", "apply-progression", {
          ...context, addedNoteCount: applied.addedNoteCount, addedChordCount: applied.addedChordCount,
        });
      } catch (error) {
        const entry = logger.error("harmonization", "采纳和声连接失败", { code: "HARMONIZATION_FAILED", error, context });
        showNotice(error instanceof Error ? error.message : "采纳和声连接失败，请刷新重试。", { level: "error", logEntryId: entry.id });
        setRefresh(value => value + 1);
      }
    },
  };
  return { panel, preview, stopAudition };
}
