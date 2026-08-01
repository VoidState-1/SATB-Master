import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import {
  EXTERNAL_RULE_MEMORY_BYTES,
  EXTERNAL_RULE_TIMEOUT_MS,
  type ExternalRuleContext,
  type ExternalRuleFailureCode,
} from "./externalRules";

export interface ExternalRuleSandboxInspection {
  manifest: unknown;
  executableRuleIds: string[];
}

export interface ExternalRuleSandboxEvaluation {
  manifest: unknown;
  value: unknown;
}

export class ExternalRuleSandboxError extends Error {
  constructor(
    readonly code: Exclude<
      ExternalRuleFailureCode,
      "missing-package" | "source-error" | "manifest-mismatch" | "invalid-result"
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
      typeof record.message === "string" ? record.message : JSON.stringify(value);
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
      const rules = Array.isArray(registration.rules) ? registration.rules : [];
      return JSON.stringify({
        manifest: registration.manifest,
        executableRuleIds: rules.map((rule) => rule && rule.id),
      });
    `,
  );
}

export function evaluateExternalRuleSource(options: {
  source: string;
  ruleId: string;
  context: ExternalRuleContext;
  config: Record<string, string | number | boolean>;
  timeoutMs?: number;
  memoryLimitBytes?: number;
}): Promise<ExternalRuleSandboxEvaluation> {
  const contextJson = JSON.stringify(options.context);
  const configJson = JSON.stringify(options.config);
  const ruleIdJson = JSON.stringify(options.ruleId);
  return evaluateJson<ExternalRuleSandboxEvaluation>(
    options.source,
    `
      const rules = Array.isArray(registration.rules) ? registration.rules : [];
      const rule = rules.find((candidate) => candidate && candidate.id === ${ruleIdJson});
      if (!rule || typeof rule.evaluate !== "function") {
        throw new Error("规则包未提供目标规则的 evaluate 函数");
      }
      const context = deepFreeze(JSON.parse(${JSON.stringify(contextJson)}));
      const config = deepFreeze(JSON.parse(${JSON.stringify(configJson)}));
      const value = rule.evaluate(context, config);
      if (value && typeof value.then === "function") {
        throw new Error("首版外置规则不支持异步 evaluate");
      }
      return JSON.stringify({ manifest: registration.manifest, value });
    `,
    options,
  );
}
