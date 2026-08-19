import type { ProjectDocument } from "../../project";
import { HARMONY_RULE_DEFINITION_BY_ID } from "../rules/catalog";
import type { HarmonyRuleTestCase } from "./model";
import { dematerializeRuleTestProject } from "./projectFixture";

interface CreateRuleTestCaseOptions {
  project: ProjectDocument;
  ruleId?: HarmonyRuleTestCase["target"]["ruleId"];
  id?: string;
  title?: string;
}

export function createRuleTestCase({
  project,
  ruleId = "voice.range",
  id = `${ruleId}-case`,
  title = `${project.title || "未命名工程"}规则用例`,
}: CreateRuleTestCaseOptions): HarmonyRuleTestCase {
  const definition = HARMONY_RULE_DEFINITION_BY_ID.get(ruleId);
  if (!definition) throw new Error(`未知规则：${ruleId}`);
  return {
    format: "satb-rule-test-case",
    formatVersion: 1,
    id,
    title,
    tags: [],
    target: { source: "builtin", ruleId },
    execution: {
      mode: "isolated",
      severity:
        definition.defaultSeverity === "off"
          ? "warning"
          : definition.defaultSeverity,
      config: structuredClone(definition.defaultConfig),
      exceptions: { ...definition.defaultExceptionPolicies },
    },
    project: dematerializeRuleTestProject(project),
    expected: {
      diagnostics: [],
      allowUnexpectedDiagnostics: false,
      skips: [],
    },
  };
}
