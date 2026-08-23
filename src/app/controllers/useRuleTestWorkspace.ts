import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canonicalizeRuleTestCase,
  cloneRuleTestCase,
  createRuleTestCase,
  dematerializeRuleTestProject,
  expectedDiagnosticFromActual,
  HARMONY_RULE_DEFINITION_BY_ID,
  materializeRuleTestProject,
  parseRuleTestCase,
  RuleTestRunner,
  serializeRuleTestCase,
  type ExpectedDiagnostic,
  type HarmonyDiagnostic,
  type HarmonyRuleId,
  type HarmonyRuleTestCase,
  type RuleTestRunResult,
} from "../../domain/harmony";
import { defaultChordDraftAtTick } from "../../domain/chords";
import { buildMidi, midiFileName } from "../../domain/midi";
import type { ProjectDocument } from "../../domain/project";
import { exportMidi } from "../../services/desktop";
import { useDocumentHistory } from "../../hooks/useDocumentHistory";
import {
  createRuleTestCaseStore,
  runRuleTestLibraryBatch,
  addRecentRuleTestCaseItem,
  buildRuleTestCaseLibraryItems,
  createRecentRuleTestCaseItem,
  ruleTestLibraryStatus,
  type RuleTestCaseStore,
  type RuleTestCaseLibraryItem,
  type RuleTestCaseLibraryViewItem,
} from "../../services/ruleTestCases";
import type { ConfirmationState } from "./useConfirmationController";
import { useEditorCommands } from "./useEditorCommands";
import { useEditorState } from "./useEditorState";

interface RuleTestWorkspaceDocument {
  testCase: HarmonyRuleTestCase;
  project: ProjectDocument;
}

interface UseRuleTestWorkspaceOptions {
  initialProject: ProjectDocument;
  showNotice(message: string): void;
  requestConfirmation(options: ConfirmationState): Promise<boolean>;
  store?: RuleTestCaseStore;
}

function workspaceDocument(
  testCase: HarmonyRuleTestCase,
): RuleTestWorkspaceDocument {
  return {
    testCase,
    project: materializeRuleTestProject(testCase.project, testCase.title),
  };
}

function synchronizedTestCase(document: RuleTestWorkspaceDocument) {
  return {
    ...document.testCase,
    project: dematerializeRuleTestProject(document.project),
  };
}

function expectationBaseId(diagnostic: HarmonyDiagnostic) {
  const slug = diagnostic.messageKey
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "expected-diagnostic";
}

function uniqueExpectationId(
  diagnostic: HarmonyDiagnostic,
  expectations: readonly ExpectedDiagnostic[],
) {
  const base = expectationBaseId(diagnostic);
  const ids = new Set(expectations.map((item) => item.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function useRuleTestWorkspace({
  initialProject,
  showNotice,
  requestConfirmation,
  store: suppliedStore,
}: UseRuleTestWorkspaceOptions) {
  const store = useMemo(
    () => suppliedStore ?? createRuleTestCaseStore(),
    [suppliedStore],
  );
  const initialDocument = useMemo(() => {
    const testCase = createRuleTestCase({ project: initialProject });
    return workspaceDocument(testCase);
  }, [initialProject]);
  const history = useDocumentHistory(initialDocument);
  const document = history.document;
  const editor = useEditorState(initialDocument.project, document.project);
  const [hasSession, setHasSession] = useState(false);
  const [filePath, setFilePath] = useState<string>();
  const [playheadTick, setPlayheadTick] = useState(0);
  const [autoRun, setAutoRun] = useState(true);
  const [runState, setRunState] = useState<
    "idle" | "running" | "passed" | "failed" | "error"
  >("idle");
  const [lastRun, setLastRun] = useState<RuleTestRunResult>();
  const [selectedExpectationId, setSelectedExpectationId] =
    useState<string>();
  const [libraryDirectory, setLibraryDirectory] = useState<string>();
  const [libraryItems, setLibraryItems] = useState<
    RuleTestCaseLibraryItem[]
  >([]);
  const [recentItems, setRecentItems] = useState<RuleTestCaseLibraryItem[]>([]);
  const [activeLibraryKey, setActiveLibraryKey] = useState<string>();
  const [batchRunState, setBatchRunState] = useState<
    "idle" | "running" | "completed" | "cancelled"
  >("idle");
  const [batchResults, setBatchResults] = useState<
    Record<string, RuleTestRunResult>
  >({});
  const [batchRunningKey, setBatchRunningKey] = useState<string>();
  const runnerRef = useRef(new RuleTestRunner());
  const abortRef = useRef<AbortController | undefined>(undefined);
  const batchAbortRef = useRef<AbortController | undefined>(undefined);
  const autoRunTimeoutRef = useRef<number | undefined>(undefined);
  const runRequestRef = useRef(0);
  const batchRequestRef = useRef(0);
  const revisionRef = useRef(history.revision);
  revisionRef.current = history.revision;

  const resetEditor = useCallback(
    (project: ProjectDocument) => {
      editor.setSelectedNoteIds(new Set());
      editor.setSelectedChordIds(new Set());
      editor.setChordBrush(defaultChordDraftAtTick(project, 0));
      setPlayheadTick(0);
      setSelectedExpectationId(undefined);
      setLastRun(undefined);
      setRunState("idle");
    },
    [
      editor.setChordBrush,
      editor.setSelectedChordIds,
      editor.setSelectedNoteIds,
    ],
  );

  const replaceDocument = useCallback(
    (next: RuleTestWorkspaceDocument, dirty: boolean) => {
      if (dirty) history.recover(next);
      else history.load(next);
      resetEditor(next.project);
      setHasSession(true);
    },
    [history, resetEditor],
  );

  const cancelCurrentRun = useCallback((resetState = true) => {
    runRequestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = undefined;
    runnerRef.current.cancel();
    if (autoRunTimeoutRef.current !== undefined) {
      window.clearTimeout(autoRunTimeoutRef.current);
      autoRunTimeoutRef.current = undefined;
    }
    if (resetState) setRunState("idle");
  }, []);

  const cancelBatchRun = useCallback(() => {
    if (!batchAbortRef.current) return;
    batchRequestRef.current += 1;
    batchAbortRef.current?.abort();
    batchAbortRef.current = undefined;
    runnerRef.current.cancel();
    setBatchRunningKey(undefined);
    setBatchRunState((current) =>
      current === "running" ? "cancelled" : current,
    );
  }, []);

  const cancelRun = useCallback(() => {
    cancelBatchRun();
    cancelCurrentRun();
  }, [cancelBatchRun, cancelCurrentRun]);

  const confirmReplacement = useCallback(async () => {
    if (!history.isDirty) return true;
    return requestConfirmation({
      title: "替换当前规则用例？",
      message: "当前规则用例有未保存修改。继续后仍可返回普通工程，但这些测试修改会被替换。",
      confirmLabel: "继续",
      cancelLabel: "取消",
    });
  }, [history.isDirty, requestConfirmation]);

  const createFromProject = useCallback(
    async (project: ProjectDocument) => {
      if (hasSession && !(await confirmReplacement())) return false;
      cancelRun();
      const testCase = createRuleTestCase({
        project: structuredClone(project),
        ruleId: document.testCase.target.ruleId,
      });
      const next = workspaceDocument(testCase);
      replaceDocument(next, true);
      setFilePath(undefined);
      setActiveLibraryKey(undefined);
      showNotice("已从当前工程创建规则用例");
      return true;
    },
    [
      confirmReplacement,
      cancelRun,
      document.testCase.target.ruleId,
      hasSession,
      replaceDocument,
      showNotice,
    ],
  );

  const open = useCallback(async () => {
    if (hasSession && !(await confirmReplacement())) return false;
    try {
      const opened = await store.open();
      if (!opened) return false;
      const parsed = parseRuleTestCase(opened.document);
      if (!parsed.testCase) {
        throw new Error(parsed.issues.map((item) => item.message).join("；"));
      }
      cancelRun();
      const next = workspaceDocument(parsed.testCase);
      replaceDocument(next, false);
      setFilePath(opened.filePath);
      const recent = createRecentRuleTestCaseItem({
        testCase: parsed.testCase,
        filePath: opened.filePath,
        displayName: opened.displayName,
      });
      setRecentItems((items) => addRecentRuleTestCaseItem(items, recent));
      setActiveLibraryKey(recent.key);
      showNotice(`已打开 ${opened.displayName ?? parsed.testCase.title}`);
      return true;
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "规则测试用例打开失败",
      );
      return false;
    }
  }, [
    cancelRun,
    confirmReplacement,
    hasSession,
    replaceDocument,
    showNotice,
    store,
  ]);

  const openDirectory = useCallback(async () => {
    try {
      cancelBatchRun();
      const snapshot = await store.openDirectory();
      if (!snapshot) return false;
      const items = buildRuleTestCaseLibraryItems(snapshot);
      setLibraryDirectory(snapshot.directoryPath);
      setLibraryItems(items);
      setBatchResults({});
      setBatchRunState("idle");
      setBatchRunningKey(undefined);
      const activeMatch = items.find(
        (item) => filePath && item.filePath === filePath,
      );
      if (activeMatch) setActiveLibraryKey(activeMatch.key);
      const invalidCount = items.filter((item) => !item.testCase).length;
      showNotice(
        invalidCount > 0
          ? `已载入 ${items.length} 个用例，其中 ${invalidCount} 个无效`
          : `已载入 ${items.length} 个规则测试用例`,
      );
      return true;
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "规则测试用例目录打开失败",
      );
      return false;
    }
  }, [cancelBatchRun, filePath, showNotice, store]);

  const openLibraryItem = useCallback(
    async (key: string) => {
      if (key === activeLibraryKey) return true;
      const item = [...libraryItems, ...recentItems].find(
        (candidate) => candidate.key === key,
      );
      if (!item) return false;
      if (!item.testCase || item.issues.length > 0) {
        showNotice(
          item.issues.map((issue) => issue.message).join("；") ||
            "规则测试用例无效",
        );
        return false;
      }
      if (hasSession && !(await confirmReplacement())) return false;
      cancelRun();
      replaceDocument(workspaceDocument(structuredClone(item.testCase)), false);
      setFilePath(item.filePath);
      setActiveLibraryKey(item.key);
      setRecentItems((items) => addRecentRuleTestCaseItem(items, item));
      showNotice(`已打开 ${item.testCase.title}`);
      return true;
    },
    [
      activeLibraryKey,
      cancelRun,
      confirmReplacement,
      hasSession,
      libraryItems,
      recentItems,
      replaceDocument,
      showNotice,
    ],
  );

  const cloneCurrent = useCallback(() => {
    cancelRun();
    const copy = cloneRuleTestCase(synchronizedTestCase(document));
    replaceDocument(workspaceDocument(copy), true);
    setFilePath(undefined);
    setActiveLibraryKey(undefined);
    showNotice(`已创建“${copy.title}”`);
  }, [cancelRun, document, replaceDocument, showNotice]);

  const save = useCallback(
    async (forceDialog = false) => {
      try {
        const candidate = synchronizedTestCase(document);
        const parsed = parseRuleTestCase(candidate);
        if (!parsed.testCase)
          throw new Error(parsed.issues.map((item) => item.message).join("；"));
        const result = await store.save({
          currentPath: filePath,
          forceDialog,
          json: serializeRuleTestCase(parsed.testCase),
          defaultName:
            parsed.testCase.title?.trim() ||
            parsed.testCase.id ||
            "未命名规则用例",
        });
        if (!result) return false;
        const savedPath = result.filePath ?? filePath;
        setFilePath(savedPath);
        const recent = createRecentRuleTestCaseItem({
          testCase: parsed.testCase,
          filePath: savedPath,
          displayName: parsed.testCase.title,
        });
        setRecentItems((items) => addRecentRuleTestCaseItem(items, recent));
        setLibraryItems((items) =>
          items.map((item) =>
            savedPath && item.filePath === savedPath
              ? { ...item, testCase: structuredClone(parsed.testCase), issues: [] }
              : item,
          ),
        );
        const libraryMatch = libraryItems.find(
          (item) => savedPath && item.filePath === savedPath,
        );
        setActiveLibraryKey(libraryMatch?.key ?? recent.key);
        history.markSaved();
        showNotice(savedPath ? `已保存到 ${savedPath}` : "规则用例已下载");
        return true;
      } catch (error) {
        showNotice(
          error instanceof Error ? error.message : "规则测试用例保存失败",
        );
        return false;
      }
    }, [document, filePath, history, libraryItems, showNotice, store]);

  const exportMidiFile = useCallback(async () => {
    try {
      const result = await exportMidi(
        buildMidi(document.project, true),
        midiFileName(document.project),
      );
      if (!result.canceled) showNotice("MIDI 已导出");
      return !result.canceled;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "MIDI 导出失败");
      return false;
    }
  }, [document.project, showNotice]);

  const commitProject = useCallback(
    (project: ProjectDocument) => {
      history.commit({
        project,
        testCase: {
          ...document.testCase,
          project: dematerializeRuleTestProject(project),
        },
      });
    },
    [document.testCase, history],
  );

  const commitTestCase = useCallback(
    (update: (testCase: HarmonyRuleTestCase) => void) => {
      const testCase = structuredClone(document.testCase);
      update(testCase);
      testCase.project = dematerializeRuleTestProject(document.project);
      history.commit({ ...document, testCase });
    },
    [document, history],
  );

  const setTargetRule = useCallback(
    (ruleId: HarmonyRuleId) => {
      const definition = HARMONY_RULE_DEFINITION_BY_ID.get(ruleId);
      if (!definition) return;
      commitTestCase((testCase) => {
        testCase.target.ruleId = ruleId;
        testCase.execution = {
          mode: "isolated",
          severity:
            definition.defaultSeverity === "off"
              ? "warning"
              : definition.defaultSeverity,
          config: structuredClone(definition.defaultConfig),
          exceptions: { ...definition.defaultExceptionPolicies },
        };
        testCase.expected.diagnostics = [];
        testCase.expected.skips = [];
      });
      setSelectedExpectationId(undefined);
    },
    [commitTestCase],
  );

  const updateExpectation = useCallback(
    (expectationId: string, patch: Partial<ExpectedDiagnostic>) => {
      commitTestCase((testCase) => {
        const expectation = testCase.expected.diagnostics.find(
          (item) => item.id === expectationId,
        );
        if (expectation) Object.assign(expectation, patch);
      });
    },
    [commitTestCase],
  );

  const addActualAsExpectation = useCallback(
    (diagnostic: HarmonyDiagnostic) => {
      let expectationId = "";
      commitTestCase((testCase) => {
        expectationId = uniqueExpectationId(
          diagnostic,
          testCase.expected.diagnostics,
        );
        testCase.expected.diagnostics.push(
          expectedDiagnosticFromActual(diagnostic, expectationId),
        );
      });
      setSelectedExpectationId(expectationId);
    },
    [commitTestCase],
  );

  const addBlankExpectation = useCallback(
    (tick: number) => {
      let expectationId = "";
      commitTestCase((testCase) => {
        const base = `${testCase.target.ruleId}-expected`;
        const ids = new Set(
          testCase.expected.diagnostics.map((item) => item.id),
        );
        expectationId = base;
        let suffix = 2;
        while (ids.has(expectationId)) {
          expectationId = `${base}-${suffix}`;
          suffix += 1;
        }
        testCase.expected.diagnostics.push({
          id: expectationId,
          ruleId: testCase.target.ruleId,
          messageKey: testCase.target.ruleId,
          tick,
        });
      });
      setSelectedExpectationId(expectationId);
    },
    [commitTestCase],
  );

  const updateSelectedFromActual = useCallback(
    (diagnostic: HarmonyDiagnostic) => {
      if (!selectedExpectationId) return;
      commitTestCase((testCase) => {
        const index = testCase.expected.diagnostics.findIndex(
          (item) => item.id === selectedExpectationId,
        );
        if (index < 0) return;
        testCase.expected.diagnostics[index] = expectedDiagnosticFromActual(
          diagnostic,
          selectedExpectationId,
        );
      });
    },
    [commitTestCase, selectedExpectationId],
  );

  const updateExpectationFromActual = useCallback(
    (expectationId: string, diagnostic: HarmonyDiagnostic) => {
      commitTestCase((testCase) => {
        const index = testCase.expected.diagnostics.findIndex(
          (item) => item.id === expectationId,
        );
        if (index < 0) return;
        testCase.expected.diagnostics[index] = expectedDiagnosticFromActual(
          diagnostic,
          expectationId,
        );
      });
      setSelectedExpectationId(expectationId);
    },
    [commitTestCase],
  );

  const deleteExpectation = useCallback(
    (expectationId: string) => {
      commitTestCase((testCase) => {
        testCase.expected.diagnostics =
          testCase.expected.diagnostics.filter(
            (item) => item.id !== expectationId,
          );
      });
      setSelectedExpectationId((current) =>
        current === expectationId ? undefined : current,
      );
    },
    [commitTestCase],
  );

  const acceptAllActual = useCallback(async () => {
    if (!lastRun) return false;
    const confirmed = await requestConfirmation({
      title: "接受全部实际结果？",
      message: `将用 ${lastRun.actual.diagnostics.length} 条实际诊断和 ${lastRun.actual.skippedRules.length} 条跳过状态替换当前预期。`,
      confirmLabel: "替换预期",
      cancelLabel: "取消",
    });
    if (!confirmed) return false;
    commitTestCase((testCase) => {
      const expectations: ExpectedDiagnostic[] = [];
      testCase.expected.diagnostics = lastRun.actual.diagnostics.map(
        (diagnostic) => {
          const id = uniqueExpectationId(diagnostic, expectations);
          const expectation = expectedDiagnosticFromActual(diagnostic, id);
          expectations.push(expectation);
          return expectation;
        },
      );
      testCase.expected.skips = lastRun.actual.skippedRules.map(
        ({ reason, partial }) => ({ reason, partial }),
      );
    });
    return true;
  }, [commitTestCase, lastRun, requestConfirmation]);

  const normalize = useCallback(() => {
    const testCase = canonicalizeRuleTestCase(synchronizedTestCase(document));
    history.commit(workspaceDocument(testCase));
    showNotice("规则用例已规范化");
  }, [document, history, showNotice]);

  const run = useCallback(async () => {
    cancelBatchRun();
    cancelCurrentRun(false);
    const requestId = ++runRequestRef.current;
    const revision = history.revision;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunState("running");
    const result = await runnerRef.current.run(
      synchronizedTestCase(document),
      { signal: controller.signal, project: document.project },
    );
    if (
      controller.signal.aborted ||
      requestId !== runRequestRef.current ||
      revision !== revisionRef.current ||
      result.error?.code === "aborted"
    )
      return undefined;
    setLastRun(result);
    setRunState(result.status);
    return result;
  }, [cancelBatchRun, cancelCurrentRun, document, history.revision]);

  const runLibrary = useCallback(async () => {
    if (batchAbortRef.current) return;
    const runnable = libraryItems.filter(
      (item) => item.testCase && item.issues.length === 0,
    );
    if (runnable.length === 0) {
      showNotice("当前目录没有可运行的规则测试用例");
      return;
    }
    cancelCurrentRun();
    const requestId = ++batchRequestRef.current;
    const controller = new AbortController();
    batchAbortRef.current = controller;
    setBatchResults({});
    setBatchRunState("running");
    const batch = await runRuleTestLibraryBatch(
      libraryItems,
      runnerRef.current,
      {
        signal: controller.signal,
        onStart: setBatchRunningKey,
        onResult: (key, result) =>
          setBatchResults((results) => ({ ...results, [key]: result })),
      },
    );
    if (requestId !== batchRequestRef.current) return;
    batchAbortRef.current = undefined;
    setBatchRunningKey(undefined);
    setBatchResults(batch.results);
    if (batch.status === "cancelled") {
      setBatchRunState("cancelled");
      return;
    }
    setBatchRunState("completed");
    showNotice(`批量运行完成：通过 ${batch.passed}，失败 ${batch.failed}`);
  }, [cancelCurrentRun, libraryItems, showNotice]);

  useEffect(() => {
    if (!hasSession || !autoRun) {
      abortRef.current?.abort();
      runnerRef.current.cancel();
      if (hasSession) setRunState("idle");
      return;
    }
    abortRef.current?.abort();
    runnerRef.current.cancel();
    autoRunTimeoutRef.current = window.setTimeout(() => {
      autoRunTimeoutRef.current = undefined;
      void run();
    }, 250);
    return () => {
      if (autoRunTimeoutRef.current !== undefined) {
        window.clearTimeout(autoRunTimeoutRef.current);
        autoRunTimeoutRef.current = undefined;
      }
    };
  }, [autoRun, hasSession, history.revision, run]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      batchAbortRef.current?.abort();
      runnerRef.current.cancel();
      if (autoRunTimeoutRef.current !== undefined) {
        window.clearTimeout(autoRunTimeoutRef.current);
        autoRunTimeoutRef.current = undefined;
      }
    },
    [],
  );

  const libraryViewItems = useMemo<RuleTestCaseLibraryViewItem[]>(
    () =>
      libraryItems.map((item) => ({
        ...item,
        status:
          batchRunningKey === item.key
            ? "running"
            : activeLibraryKey === item.key
              ? runState
              : ruleTestLibraryStatus(item, batchResults[item.key]),
        dirty: activeLibraryKey === item.key && history.isDirty,
      })),
    [
      activeLibraryKey,
      batchResults,
      batchRunningKey,
      history.isDirty,
      libraryItems,
      runState,
    ],
  );
  const recentViewItems = useMemo<RuleTestCaseLibraryViewItem[]>(
    () =>
      recentItems.map((item) => ({
        ...item,
        status:
          activeLibraryKey === item.key
            ? runState
            : ruleTestLibraryStatus(item, batchResults[item.key]),
        dirty: activeLibraryKey === item.key && history.isDirty,
      })),
    [
      activeLibraryKey,
      batchResults,
      history.isDirty,
      recentItems,
      runState,
    ],
  );
  const currentLibraryItem = useMemo<RuleTestCaseLibraryViewItem>(
    () => ({
      key: activeLibraryKey ?? "current::unsaved",
      displayName: filePath?.split(/[\\/]/).at(-1) ?? "未保存用例",
      filePath,
      testCase: document.testCase,
      issues: [],
      status: runState,
      dirty: history.isDirty,
    }),
    [
      activeLibraryKey,
      document.testCase,
      filePath,
      history.isDirty,
      runState,
    ],
  );

  const editorCommands = useEditorCommands({
    project: document.project,
    history: { commit: commitProject },
    editor,
    playheadTick,
    setPlayheadTick,
    showNotice,
  });

  return {
    hasSession,
    history,
    testCase: document.testCase,
    project: document.project,
    editor,
    editorCommands,
    filePath,
    activeLibraryKey,
    currentLibraryItem,
    libraryDirectory,
    libraryItems: libraryViewItems,
    recentItems: recentViewItems,
    batchRunState,
    batchCompletedCount: Object.keys(batchResults).length,
    batchTotalCount: libraryItems.filter(
      (item) => item.testCase && item.issues.length === 0,
    ).length,
    playheadTick,
    setPlayheadTick,
    autoRun,
    setAutoRun,
    runState,
    lastRun,
    selectedExpectationId,
    setSelectedExpectationId,
    createFromProject,
    open,
    openDirectory,
    openLibraryItem,
    cloneCurrent,
    save,
    run,
    runLibrary,
    cancelBatchRun,
    exportMidi: exportMidiFile,
    cancelRun,
    normalize,
    commitTestCase,
    commitProject,
    setTargetRule,
    updateExpectation,
    addBlankExpectation,
    addActualAsExpectation,
    updateSelectedFromActual,
    updateExpectationFromActual,
    deleteExpectation,
    acceptAllActual,
  } as const;
}

export type RuleTestWorkspaceController = ReturnType<
  typeof useRuleTestWorkspace
>;
