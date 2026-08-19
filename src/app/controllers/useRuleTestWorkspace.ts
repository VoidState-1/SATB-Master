import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canonicalizeRuleTestCase,
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
import type { ProjectDocument } from "../../domain/project";
import { useDocumentHistory } from "../../hooks/useDocumentHistory";
import {
  createRuleTestCaseStore,
  type RuleTestCaseStore,
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
  const runnerRef = useRef(new RuleTestRunner());
  const abortRef = useRef<AbortController | undefined>(undefined);
  const autoRunTimeoutRef = useRef<number | undefined>(undefined);
  const runRequestRef = useRef(0);
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
      const testCase = createRuleTestCase({
        project: structuredClone(project),
        ruleId: document.testCase.target.ruleId,
      });
      const next = workspaceDocument(testCase);
      replaceDocument(next, true);
      setFilePath(undefined);
      showNotice("已从当前工程创建规则用例");
      return true;
    },
    [
      confirmReplacement,
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
      const next = workspaceDocument(parsed.testCase);
      replaceDocument(next, false);
      setFilePath(opened.filePath);
      showNotice(`已打开 ${opened.displayName ?? parsed.testCase.title}`);
      return true;
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "规则测试用例打开失败",
      );
      return false;
    }
  }, [confirmReplacement, hasSession, replaceDocument, showNotice, store]);

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
          defaultName: parsed.testCase.id,
        });
        if (!result) return false;
        setFilePath(result.filePath);
        history.markSaved();
        showNotice(result.filePath ? `已保存到 ${result.filePath}` : "规则用例已下载");
        return true;
      } catch (error) {
        showNotice(
          error instanceof Error ? error.message : "规则测试用例保存失败",
        );
        return false;
      }
    }, [document, filePath, history, showNotice, store],
  );

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
    if (autoRunTimeoutRef.current !== undefined) {
      window.clearTimeout(autoRunTimeoutRef.current);
      autoRunTimeoutRef.current = undefined;
    }
    const requestId = ++runRequestRef.current;
    const revision = history.revision;
    abortRef.current?.abort();
    runnerRef.current.cancel();
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
  }, [document, history.revision]);

  const cancelRun = useCallback(() => {
    runRequestRef.current += 1;
    abortRef.current?.abort();
    runnerRef.current.cancel();
    if (autoRunTimeoutRef.current !== undefined) {
      window.clearTimeout(autoRunTimeoutRef.current);
      autoRunTimeoutRef.current = undefined;
    }
    setRunState("idle");
  }, []);

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
      runnerRef.current.cancel();
      if (autoRunTimeoutRef.current !== undefined) {
        window.clearTimeout(autoRunTimeoutRef.current);
        autoRunTimeoutRef.current = undefined;
      }
    },
    [],
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
    save,
    run,
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
