import type {
  ExternalRuleContext,
  ExternalRuleFailure,
  ExternalRuleManifestRule,
  InstalledExternalRulePackage,
} from "./externalRules";
import type {
  HarmonyRuleSeverity,
  RuleConfig,
  RuleExceptionPolicy,
} from "./harmonyRules";

export type ExternalRuleWorkerRequest =
  | {
      id: number;
      type: "inspect";
      source: string;
    }
  | {
      id: number;
      type: "run";
      context: ExternalRuleContext;
      entries: Array<{
        package: InstalledExternalRulePackage;
        source: string;
        rule: ExternalRuleManifestRule;
        severity: Exclude<HarmonyRuleSeverity, "off">;
        config: RuleConfig;
        exceptionPolicy: RuleExceptionPolicy;
      }>;
    };

export type ExternalRuleWorkerResponse =
  | {
      id: number;
      ok: true;
      type: "inspect";
      inspection: {
        manifest: unknown;
        executableRuleIds: string[];
        statefulRuleIds: string[];
      };
    }
  | {
      id: number;
      ok: true;
      type: "run";
      evaluations: Array<{
        package: InstalledExternalRulePackage;
        rule: ExternalRuleManifestRule;
        severity: Exclude<HarmonyRuleSeverity, "off">;
        exceptionPolicy: RuleExceptionPolicy;
        manifest: unknown;
        value: unknown;
      }>;
      failures: ExternalRuleFailure[];
    }
  | {
      id: number;
      ok: false;
      type: "inspect" | "run";
      error: string;
    };
