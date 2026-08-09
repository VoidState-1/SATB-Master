import { describe, expect, it } from "vitest";
import { createHarmonyRuleScheduler } from "../registry";
import {
  HARMONY_RULE_DEFINITIONS,
  type HarmonyRuleSeverities,
} from "../ruleTypes";
import {
  createEmptyProject,
  type NoteEvent,
  type VoiceId,
} from "../../project";

const VOICES: readonly VoiceId[] = ["soprano", "alto", "tenor", "bass"];

function largeProject() {
  const project = createEmptyProject();
  const noteTicks = 120;
  const notesPerVoice = 1_250;
  project.lengthTicks = noteTicks * notesPerVoice;
  VOICES.forEach((voiceId, voiceIndex) => {
    const octave = [5, 4, 4, 3][voiceIndex];
    project.satbTracks.find((track) => track.id === voiceId)!.notes =
      Array.from({ length: notesPerVoice }, (_, index): NoteEvent => ({
        id: `${voiceId}-${index}`,
        startTick: index * noteTicks,
        durationTicks: noteTicks,
        pitch: { step: "C", alter: 0, octave },
        velocity: 88,
        locked: false,
        spellingSource: "manual",
      }));
  });
  return project;
}

describe("规则引擎性能回归", () => {
  it("5000 音符工程只改一条规则配置时复用分析并在 100 ms 内重检", async () => {
    const project = largeProject();
    const scheduler = createHarmonyRuleScheduler();
    const severities = Object.fromEntries(
      HARMONY_RULE_DEFINITIONS.map((definition) => [definition.id, "off"]),
    ) as HarmonyRuleSeverities;
    severities["voice.range"] = "warning";
    const firstAnalysis = scheduler.prepareAnalysis(project, 1);
    await scheduler.run({
      project,
      analysis: firstAnalysis,
      severities,
      revision: 1,
      configs: {
        "voice.range": {
          soprano: { minMidi: 60, maxMidi: 81 },
        },
      },
    });

    const profileOnly = structuredClone(project);
    profileOnly.ruleProfile.title = "性能测试配置";
    const startedAt = performance.now();
    const secondAnalysis = scheduler.prepareAnalysis(profileOnly, 2);
    await scheduler.run({
      project: profileOnly,
      analysis: secondAnalysis,
      severities,
      revision: 2,
      configs: {
        "voice.range": {
          soprano: { minMidi: 60, maxMidi: 82 },
        },
      },
    });
    const elapsed = performance.now() - startedAt;

    expect(secondAnalysis.slices).toBe(firstAnalysis.slices);
    expect(secondAnalysis.invalidationRanges).toEqual([]);
    expect(elapsed).toBeLessThan(100);
  });
});
