import { describe, expect, it } from "vitest";
import { spellMidi } from "../../../../pitch";
import { createEmptyProject, PPQ, validateProject } from "../../../../project";
import {
  resolveBuiltinRuleProfile,
  setBuiltinRuleConfig,
  setBuiltinRuleException,
  setBuiltinRuleSeverity,
} from "../../../../ruleProfile";
import { checkHarmony } from "../../../registry";
import { pitch, setLine } from "../../../testing/fixtures/ruleProjects";
import { defaultHarmonyRuleSeverities } from "../../catalog";

describe("声部音域与工程规则配置", () => {
  describe("声部音域配置", () => {
    it("建议音域诊断显示当前 profile 的实际上下界", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ;
      setLine(project, "soprano", [pitch("C", 0, 4)]);
      const severities = defaultHarmonyRuleSeverities();
      const diagnostic = checkHarmony(project, severities, {
        "voice.range": {
          soprano: { minMidi: 61, maxMidi: 79 },
        },
      }).diagnostics.find((item) => item.ruleId === "voice.range");

      expect(diagnostic?.message).toContain("MIDI 61-79");
      expect(diagnostic?.params).toMatchObject({ minimum: 61, maximum: 79 });
    });

    it("工程规则配置会规范化、持久化并覆盖目录默认值", () => {
      const project = createEmptyProject();
      setBuiltinRuleSeverity(project, "voice.range", "suggestion");
      setBuiltinRuleConfig(project, "voice.range", {
        soprano: { minMidi: 58, maxMidi: 84 },
      });
      setBuiltinRuleException(
        project,
        "voice-leading.unequal-fifths-inner-diminished-to-perfect",
        { "bass-step-up": "strict" },
      );

      const serialized = JSON.parse(JSON.stringify(project));
      expect(validateProject(serialized)).toBe(true);
      const resolved = resolveBuiltinRuleProfile(serialized);
      expect(resolved.severities["voice.range"]).toBe("suggestion");
      expect(resolved.configs["voice.range"]).toMatchObject({
        soprano: { minMidi: 58, maxMidi: 84 },
        alto: { minMidi: 55, maxMidi: 74 },
      });
      expect(
        resolved.exceptions[
          "voice-leading.unequal-fifths-inner-diminished-to-perfect"
        ]?.["bass-step-up"],
      ).toBe("strict");
    });

    it("损坏或颠倒的音域配置回退到规则默认值", () => {
      const project = createEmptyProject();
      project.ruleProfile.shared.voiceRanges.soprano = {
        minMidi: 100,
        maxMidi: 40,
      };
      const range = resolveBuiltinRuleProfile(project).configs["voice.range"];
      expect(range).toMatchObject({
        soprano: { minMidi: 60, maxMidi: 81 },
        alto: { minMidi: 55, maxMidi: 74 },
      });
    });

    it("自定义音域会立即改变音域规则结论", () => {
      const project = createEmptyProject();
      setLine(project, "soprano", [spellMidi(58)]);
      const severities = defaultHarmonyRuleSeverities();
      expect(
        checkHarmony(project, severities).diagnostics.some(
          (item) => item.ruleId === "voice.range",
        ),
      ).toBe(true);
      expect(
        checkHarmony(project, severities, {
          "voice.range": { soprano: { minMidi: 58, maxMidi: 81 } },
        }).diagnostics.some((item) => item.ruleId === "voice.range"),
      ).toBe(false);
    });
  });
});
