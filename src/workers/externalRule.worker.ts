import {
  ExternalRuleSandboxError,
  evaluateExternalRuleSource,
  inspectExternalRuleSource,
} from "../domain/harmony/external/sandbox";
import type {
  ExternalRuleWorkerRequest,
  ExternalRuleWorkerResponse,
} from "../domain/harmony/external/protocol";

self.addEventListener(
  "message",
  (event: MessageEvent<ExternalRuleWorkerRequest>) => {
    void handleRequest(event.data).then((response) =>
      self.postMessage(response),
    );
  },
);

async function handleRequest(
  request: ExternalRuleWorkerRequest,
): Promise<ExternalRuleWorkerResponse> {
  if (request.type === "inspect") {
    try {
      return {
        id: request.id,
        ok: true,
        type: "inspect",
        inspection: await inspectExternalRuleSource(request.source),
      };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        type: "inspect",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const evaluations: Extract<
    ExternalRuleWorkerResponse,
    { ok: true; type: "run" }
  >["evaluations"] = [];
  const failures: Extract<
    ExternalRuleWorkerResponse,
    { ok: true; type: "run" }
  >["failures"] = [];
  for (const entry of request.entries) {
    try {
      const evaluation = await evaluateExternalRuleSource({
        source: entry.source,
        ruleId: entry.rule.id,
        context: entry.rule.supportsDoubleAugmented43
          ? request.context
          : request.legacyNoteContext ?? request.context,
        config: entry.config,
      });
      evaluations.push({
        package: entry.package,
        rule: entry.rule,
        severity: entry.severity,
        exceptionPolicy: entry.exceptionPolicy,
        manifest: evaluation.manifest,
        value: evaluation.value,
      });
    } catch (error) {
      const sandboxError =
        error instanceof ExternalRuleSandboxError ? error : undefined;
      failures.push({
        packageId: entry.package.manifest.packageId,
        version: entry.package.manifest.version,
        contentHash: entry.package.contentHash,
        ruleId: entry.rule.id,
        code: sandboxError?.code ?? "exception",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    id: request.id,
    ok: true,
    type: "run",
    evaluations,
    failures,
  };
}
