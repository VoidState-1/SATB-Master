import { describe, expect, it } from "vitest";
import type { HarmonyDiagnostic } from "../../domain/harmony";
import { groupDiagnostics, orderTracksForRendering } from "./geometry";
import type { VoiceId } from "../../domain/project";

function diagnostic(): HarmonyDiagnostic {
  return {
    id: "diagnostic",
    ruleId: "resolution.leading-tone",
    source: "builtin",
    severity: "warning",
    tick: 480,
    endTick: 960,
    voiceIds: ["alto"],
    noteIds: ["source-note", "failure-note"],
    chordIds: [],
    title: "导音未解决",
    message: "测试",
    messageKey: "resolution.leading-tone",
    params: {},
    evidence: [],
    confidence: 1,
    subjects: {
      origin: { voiceIds: ["alto"], noteIds: ["source-note"] },
      failure: { voiceIds: ["alto"], noteIds: ["failure-note"] },
      context: { voiceIds: ["alto"], noteIds: ["context-note"] },
    },
  };
}

describe("诊断对象分层", () => {
  it("错误标记只分组到 failure 音符", () => {
    const grouped = groupDiagnostics([diagnostic()], "noteIds", "failure");

    expect(grouped.has("source-note")).toBe(false);
    expect(grouped.get("failure-note")).toHaveLength(1);
  });

  it("没有分层信息的旧诊断继续使用完整 noteIds", () => {
    const legacy = diagnostic();
    legacy.subjects = undefined;
    const grouped = groupDiagnostics([legacy], "noteIds", "failure");

    expect(grouped.has("source-note")).toBe(true);
    expect(grouped.has("failure-note")).toBe(true);
  });

  it("涉及对象包含来源与失败音符，但排除纯上下文音符", () => {
    const grouped = groupDiagnostics([diagnostic()], "noteIds", "involved");

    expect(grouped.get("source-note")).toHaveLength(1);
    expect(grouped.get("failure-note")).toHaveLength(1);
    expect(grouped.has("context-note")).toBe(false);
  });
});

describe("声部渲染分层策略", () => {
  const tracks: Array<{ id: VoiceId; name: string }> = [
    { id: "soprano", name: "女高" },
    { id: "alto", name: "女低" },
    { id: "tenor", name: "男高" },
    { id: "bass", name: "男低" },
  ];

  it("当前选中的声部动态置于最上层（数组末尾）以支持覆盖渲染与优先拾取", () => {
    const tenorOnTop = orderTracksForRendering(tracks, "tenor");
    expect(tenorOnTop.map((t) => t.id)).toEqual([
      "soprano",
      "alto",
      "bass",
      "tenor",
    ]);

    const sopranoOnTop = orderTracksForRendering(tracks, "soprano");
    expect(sopranoOnTop.map((t) => t.id)).toEqual([
      "alto",
      "tenor",
      "bass",
      "soprano",
    ]);

    const altoOnTop = orderTracksForRendering(tracks, "alto");
    expect(altoOnTop.map((t) => t.id)).toEqual([
      "soprano",
      "tenor",
      "bass",
      "alto",
    ]);

    const bassOnTop = orderTracksForRendering(tracks, "bass");
    expect(bassOnTop.map((t) => t.id)).toEqual([
      "soprano",
      "alto",
      "tenor",
      "bass",
    ]);
  });
});
