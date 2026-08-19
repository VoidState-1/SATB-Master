import { createEmptyProject } from "../../project";
import { HARMONY_RULE_DEFINITION_BY_ID } from "../rules/catalog";
import type { HarmonyRuleTestCase } from "./model";
import { dematerializeRuleTestProject } from "./projectFixture";

export function testCaseFor(
  project = createEmptyProject("规则用例"),
  ruleId: HarmonyRuleTestCase["target"]["ruleId"] = "voice.range",
): HarmonyRuleTestCase {
  const definition = HARMONY_RULE_DEFINITION_BY_ID.get(ruleId)!;
  return {
    format: "satb-rule-test-case",
    formatVersion: 1,
    id: "voice-range-case",
    title: "声部音域测试",
    tags: ["voice"],
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
