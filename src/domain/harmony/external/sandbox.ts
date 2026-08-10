import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import {
  EXTERNAL_RULE_API_VERSION,
  EXTERNAL_RULE_MEMORY_BYTES,
  EXTERNAL_RULE_TIMEOUT_MS,
  type ExternalRuleContext,
  type ExternalRuleFailureCode,
} from "./api";

export interface ExternalRuleSandboxInspection {
  manifest: unknown;
  executableRuleIds: string[];
  statefulRuleIds: string[];
}

export interface ExternalRuleSandboxEvaluation {
  manifest: unknown;
  value: unknown;
}

export class ExternalRuleSandboxError extends Error {
  constructor(
    readonly code: Exclude<
      ExternalRuleFailureCode,
      | "missing-package"
      | "source-error"
      | "manifest-mismatch"
      | "invalid-result"
    >,
    message: string,
  ) {
    super(message);
    this.name = "ExternalRuleSandboxError";
  }
}

const quickJsModule = newQuickJSWASMModuleFromVariant(RELEASE_SYNC);

function now() {
  return globalThis.performance?.now() ?? Date.now();
}

function sandboxBootstrap(source: string, finalExpression: string) {
  return `
"use strict";
(() => {
  let registration;
  const deepFreeze = (value, seen = new Set()) => {
    if (!value || typeof value !== "object" || seen.has(value)) return value;
    seen.add(value);
    Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
    return Object.freeze(value);
  };
  const register = (candidate) => {
    if (registration !== undefined) throw new Error("规则包只能注册一次");
    registration = candidate;
  };
  Object.defineProperty(globalThis, "SATB_RULE", {
    value: Object.freeze({ register }),
    writable: false,
    configurable: false,
    enumerable: true,
  });
  ${source}
  if (!registration || typeof registration !== "object") {
    throw new Error("规则包未调用 SATB_RULE.register");
  }
  ${finalExpression}
})()
`;
}

function formatSandboxError(value: unknown) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "Error";
    const message =
      typeof record.message === "string"
        ? record.message
        : JSON.stringify(value);
    return `${name}: ${message}`;
  }
  return String(value);
}

async function evaluateJson<T>(
  source: string,
  finalExpression: string,
  options?: { timeoutMs?: number; memoryLimitBytes?: number },
) {
  const QuickJS = await quickJsModule;
  const runtime = QuickJS.newRuntime();
  const timeoutMs = options?.timeoutMs ?? EXTERNAL_RULE_TIMEOUT_MS;
  const memoryLimitBytes =
    options?.memoryLimitBytes ?? EXTERNAL_RULE_MEMORY_BYTES;
  const deadline = now() + timeoutMs;
  let interrupted = false;
  runtime.setMemoryLimit(memoryLimitBytes);
  runtime.setMaxStackSize(512 * 1024);
  runtime.setInterruptHandler(() => {
    interrupted = now() > deadline;
    return interrupted;
  });
  const context = runtime.newContext();
  try {
    const result = context.evalCode(
      sandboxBootstrap(source, finalExpression),
      "external-rule.satb-rule.js",
    );
    if (result.error) {
      const dumped = context.dump(result.error);
      result.error.dispose();
      const message = formatSandboxError(dumped);
      if (interrupted || /interrupted/i.test(message))
        throw new ExternalRuleSandboxError(
          "timeout",
          `规则执行超过 ${timeoutMs} ms 限制`,
        );
      if (/out of memory|memory limit|allocation failed/i.test(message))
        throw new ExternalRuleSandboxError(
          "memory-limit",
          "规则执行超过 32 MiB 堆限制",
        );
      throw new ExternalRuleSandboxError("exception", message);
    }
    const serialized = context.dump(result.value);
    result.value.dispose();
    if (typeof serialized !== "string")
      throw new ExternalRuleSandboxError(
        "exception",
        "规则沙箱没有返回可序列化结果",
      );
    return JSON.parse(serialized) as T;
  } catch (error) {
    if (error instanceof ExternalRuleSandboxError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/out of memory|memory limit|allocation failed/i.test(message))
      throw new ExternalRuleSandboxError(
        "memory-limit",
        "规则执行超过 32 MiB 堆限制",
      );
    throw new ExternalRuleSandboxError("exception", message);
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

export function inspectExternalRuleSource(
  source: string,
): Promise<ExternalRuleSandboxInspection> {
  return evaluateJson<ExternalRuleSandboxInspection>(
    source,
    `
      if (!registration.manifest || registration.manifest.apiVersion !== ${EXTERNAL_RULE_API_VERSION}) {
        throw new Error("仅支持外置规则 API v${EXTERNAL_RULE_API_VERSION}");
      }
      const rules = Array.isArray(registration.rules) ? registration.rules : [];
      return JSON.stringify({
        manifest: registration.manifest,
        executableRuleIds: rules
          .filter((rule) =>
            rule && (typeof rule.evaluate === "function" || typeof rule.process === "function"))
          .map((rule) => rule.id),
        statefulRuleIds: rules
          .filter((rule) => rule && typeof rule.process === "function")
          .map((rule) => rule.id),
      });
    `,
  );
}

export function evaluateExternalRuleSource(options: {
  source: string;
  ruleId: string;
  context: ExternalRuleContext;
  config: import("../rules/types").RuleConfig;
  timeoutMs?: number;
  memoryLimitBytes?: number;
}): Promise<ExternalRuleSandboxEvaluation> {
  const contextJson = JSON.stringify(options.context);
  const configJson = JSON.stringify(options.config);
  const ruleIdJson = JSON.stringify(options.ruleId);
  return evaluateJson<ExternalRuleSandboxEvaluation>(
    options.source,
    `
      if (!registration.manifest || registration.manifest.apiVersion !== ${EXTERNAL_RULE_API_VERSION}) {
        throw new Error("仅支持外置规则 API v${EXTERNAL_RULE_API_VERSION}");
      }
      const rules = Array.isArray(registration.rules) ? registration.rules : [];
      const rule = rules.find((candidate) => candidate && candidate.id === ${ruleIdJson});
      if (!rule || (typeof rule.evaluate !== "function" && typeof rule.process !== "function")) {
        throw new Error("规则包未提供目标规则的 evaluate/process 函数");
      }
      const context = deepFreeze(JSON.parse(${JSON.stringify(contextJson)}));
      const config = deepFreeze(JSON.parse(${JSON.stringify(configJson)}));
      let value;
      if (typeof rule.process === "function") {
        let incoming = [];
        const diagnostics = [];
        let lastStepContext;
        const validVoiceIds = new Set(["soprano", "alto", "tenor", "bass"]);
        const validNoteIds = new Set(
          context.project.satbTracks.flatMap((track) => track.notes.map((note) => note.id)),
        );
        const validChordIds = new Set(context.project.chordTrack.regions.map((chord) => chord.id));
        const validSpanIds = new Set(context.harmonySpans.map((span) => span.id));
        const spanById = new Map(context.harmonySpans.map((span) => [span.id, span]));
        const validateStates = (states, sliceIndex, tick) => {
          if (!Array.isArray(states) || states.length > 512)
            throw new Error("规则状态最多允许 512 项");
          const ids = new Set();
          states.forEach((state) => {
            if (!state || typeof state !== "object" || typeof state.id !== "string" ||
                !state.id || state.id.length > 128 || ids.has(state.id) ||
                state.ownerRuleId !== rule.id)
              throw new Error("规则状态标识或所有者无效");
            ids.add(state.id);
            if (!state.createdAt || !Number.isInteger(state.createdAt.tick) ||
                !Number.isInteger(state.createdAt.sliceIndex) ||
                state.createdAt.tick < 0 || state.createdAt.tick > tick ||
                state.createdAt.sliceIndex < 0 || state.createdAt.sliceIndex > sliceIndex)
              throw new Error("规则状态创建位置无效");
            const payload = JSON.stringify(state.payload);
            if (payload === undefined || payload.length > 16 * 1024)
              throw new Error("规则状态 payload 无效或超过 16 KiB");
            const refs = state.subjectRefs || {};
            const validRefs =
              (!refs.voiceIds || (Array.isArray(refs.voiceIds) && refs.voiceIds.every((id) => validVoiceIds.has(id)))) &&
              (!refs.noteIds || (Array.isArray(refs.noteIds) && refs.noteIds.every((id) => validNoteIds.has(id)))) &&
              (!refs.chordIds || (Array.isArray(refs.chordIds) && refs.chordIds.every((id) => validChordIds.has(id)))) &&
              (!refs.spanIds || (Array.isArray(refs.spanIds) && refs.spanIds.every((id) => validSpanIds.has(id))));
            if (!validRefs) throw new Error("规则状态引用了不存在的分析对象");
          });
          return states;
        };
        for (let index = 0; index < context.slices.length; index += 1) {
          const slice = context.slices[index];
          const previous = context.slices[index - 1];
          const transitionFromPrevious = context.sliceTransitions[index - 1];
          const span = spanById.get(slice.spanId);
          const previousSpanId = previous?.spanId;
          const nextSpanId = context.slices[index + 1]?.spanId;
          const stepContext = {
            analysis: context,
            slice,
            sliceIndex: index,
            previous,
            transitionFromPrevious,
            span,
            isSpanStart: Boolean(span) && span.id !== previousSpanId,
            isSpanEnd: Boolean(span) && span.id !== nextSpanId,
          };
          lastStepContext = stepContext;
          const result = rule.process(deepFreeze(stepContext), deepFreeze(incoming), config);
          if (result && typeof result.then === "function")
            throw new Error("外置规则不支持异步 process");
          if (!result || typeof result !== "object")
            throw new Error("process 必须返回对象");
          if (Array.isArray(result.diagnostics)) diagnostics.push(...result.diagnostics);
          incoming = validateStates(result.outgoing, index, slice.tick);
        }
        if (typeof rule.finalize === "function") {
          const result = rule.finalize(deepFreeze(lastStepContext), deepFreeze(incoming), config);
          if (result && typeof result.then === "function")
            throw new Error("外置规则不支持异步 finalize");
          if (result && typeof result === "object" && Array.isArray(result.diagnostics))
            diagnostics.push(...result.diagnostics);
        }
        value = { diagnostics, states: incoming };
      } else {
        value = rule.evaluate(context, config);
        if (value && typeof value.then === "function") {
          throw new Error("外置规则不支持异步 evaluate");
        }
      }
      return JSON.stringify({ manifest: registration.manifest, value });
    `,
    options,
  );
}
