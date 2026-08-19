import { createEmptyProject } from "../../project";
import { createRuleTestCase } from "./factory";
import type { HarmonyRuleTestCase } from "./model";

export function testCaseFor(
  project = createEmptyProject("规则用例"),
  ruleId: HarmonyRuleTestCase["target"]["ruleId"] = "voice.range",
): HarmonyRuleTestCase {
  const testCase = createRuleTestCase({
    project,
    ruleId,
    id: "voice-range-case",
    title: "声部音域测试",
  });
  testCase.tags = ["voice"];
  return testCase;
}
