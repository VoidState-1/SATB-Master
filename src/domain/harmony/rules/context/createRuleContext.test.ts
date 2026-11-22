import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ } from "../../../project";
import { spellMidi } from "../../../pitch";
import { buildHarmonyAnalysis } from "../../analysis";
import {
  correctionChord,
  correctionNote,
  setCorrectionVoice,
} from "../../testing/fixtures/harmonyProject";
import { createHarmonyRuleContext } from "./createRuleContext";

function contextFixture() {
  const project = createEmptyProject("规则上下文测试");
  project.lengthTicks = PPQ * 3;
  const firstChord = correctionChord("c1", 0, PPQ * 2);
  const secondChord = correctionChord("c2", PPQ * 2, PPQ);
  secondChord.semantics = structuredClone(firstChord.semantics);
  project.chordTrack.regions = [firstChord, secondChord];
  setCorrectionVoice(project, "alto", [
    correctionNote("a1", 0, spellMidi(62), PPQ),
    correctionNote("a2", PPQ, spellMidi(62), PPQ),
    correctionNote("a3", PPQ * 2, spellMidi(63), PPQ),
  ]);
  return createHarmonyRuleContext(buildHarmonyAnalysis(project, 1));
}

function separatedSpanFixture() {
  const project = createEmptyProject("跨空洞规则上下文测试");
  project.lengthTicks = PPQ * 3;
  const firstChord = correctionChord("source", 0, PPQ);
  const secondChord = correctionChord("target", PPQ * 2, PPQ);
  secondChord.identity.root = { step: "G", alter: 0 };
  secondChord.identity.bass = { step: "G", alter: 0 };
  project.chordTrack.regions = [firstChord, secondChord];
  return createHarmonyRuleContext(buildHarmonyAnalysis(project, 2));
}

describe("HarmonyRuleContext", () => {
  it("解析 span 的切片、和弦与连接边界", () => {
    const context = contextFixture();
    const spans = context.spans().toArray();
    expect(spans).toHaveLength(1);
    expect(spans[0].chords.map((chord) => chord.id)).toEqual(["c1", "c2"]);
    expect(spans[0].firstSlice.tick).toBe(0);
    expect(spans[0].lastSlice.endTick).toBe(PPQ * 3);
  });

  it("NoteNeighborhood 使用同声部相邻起奏音", () => {
    const context = contextFixture();
    const current = context.notes({ voiceId: "alto" }).toArray()[1];
    const neighborhood = context.noteNeighborhood(current);
    expect(neighborhood?.previous?.note.id).toBe("a1");
    expect(neighborhood?.current.note.id).toBe("a2");
    expect(neighborhood?.next?.note.id).toBe("a3");
    expect(neighborhood?.attackSlice.tick).toBe(PPQ);

    const first = context.notes({ voiceId: "alto" }).first()!;
    const last = context.notes({ voiceId: "alto" }).last()!;
    expect(context.noteNeighborhood(first)?.previous).toBeUndefined();
    expect(context.noteNeighborhood(last)?.next).toBeUndefined();
  });

  it("查询 options 先缩小集合，where 继续自由筛选", () => {
    const context = contextFixture();
    expect(
      context
        .notes({ voiceId: "alto", startingAfter: 0 })
        .where(({ note }) => note.startTick < PPQ * 2)
        .select(({ note }) => note.id)
        .toArray(),
    ).toEqual(["a2"]);
    expect(context.sliceAt(PPQ)?.tick).toBe(PPQ);
    expect(context.spanAt(PPQ)?.span.fromTick).toBe(0);
    expect(context.keyAt(PPQ)).toBe(context.sliceAt(PPQ)?.key);
    expect(context.keyAt(PPQ * 3)).toBeUndefined();
  });

  it("默认音符查询保持声部顺序，单声部查询保持起奏顺序", () => {
    const project = createEmptyProject("音符查询顺序测试");
    project.lengthTicks = PPQ * 2;
    setCorrectionVoice(project, "soprano", [
      correctionNote("s-later", PPQ, spellMidi(72), PPQ),
    ]);
    setCorrectionVoice(project, "alto", [
      correctionNote("a-first", 0, spellMidi(67), PPQ),
      correctionNote("a-later", PPQ, spellMidi(69), PPQ),
    ]);
    setCorrectionVoice(project, "tenor", [
      correctionNote("t-middle", PPQ / 2, spellMidi(60), PPQ),
    ]);
    const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));

    expect(context.notes().select(({ note }) => note.id).toArray()).toEqual([
      "s-later",
      "a-first",
      "a-later",
      "t-middle",
    ]);
    expect(
      context
        .notes({ voiceId: "alto" })
        .select(({ note }) => note.id)
        .toArray(),
    ).toEqual(["a-first", "a-later"]);
  });

  it("时间查询采用稳定的半开区间与组合条件", () => {
    const context = contextFixture();
    expect(
      context
        .notes({ voiceId: "alto", startingAt: PPQ })
        .select(({ note }) => note.id)
        .toArray(),
    ).toEqual(["a2"]);
    expect(
      context
        .notes({
          voiceId: "alto",
          startingAt: PPQ,
          startingAfter: PPQ,
        })
        .any(),
    ).toBe(false);
    expect(
      context
        .notes({ voiceId: "alto", startingAt: PPQ, startingAfter: 0 })
        .select(({ note }) => note.id)
        .toArray(),
    ).toEqual(["a2"]);
    expect(
      context
        .notes({ startingAfter: PPQ })
        .select(({ note }) => note.id)
        .toArray(),
    ).toEqual(["a3"]);
    expect(
      context
        .slices({ overlapping: { fromTick: 0, toTick: PPQ } })
        .select((slice) => slice.tick)
        .toArray(),
    ).toEqual([0]);
    expect(
      context
        .slices({
          containingTick: 0,
          overlapping: { fromTick: PPQ, toTick: PPQ * 2 },
        })
        .any(),
    ).toBe(false);

    const span = context.spans().first()!;
    expect(
      context
        .spans({ id: span.span.id, containingTick: PPQ * 3 })
        .any(),
    ).toBe(false);
    expect(
      context
        .spans({ id: span.span.id, containingTick: PPQ })
        .first(),
    ).toBe(span);
  });

  it("slice transition options 精确命中前后切片索引", () => {
    const context = contextFixture();
    const transitions = context.sliceTransitions().toArray();
    expect(transitions.length).toBeGreaterThan(1);

    const target = transitions[1];
    expect(
      context
        .sliceTransitions({ fromSliceIndex: target.previousIndex })
        .toArray(),
    ).toEqual([target]);
    expect(
      context
        .sliceTransitions({ toSliceIndex: target.currentIndex })
        .toArray(),
    ).toEqual([target]);
    expect(
      context
        .sliceTransitions({
          fromSliceIndex: target.previousIndex,
          toSliceIndex: target.currentIndex,
        })
        .toArray(),
    ).toEqual([target]);
    expect(
      context
        .sliceTransitions({ fromSliceIndex: target.previousIndex + 10 })
        .toArray(),
    ).toEqual([]);
  });

  it("同一 revision 内复用 span 与 connection 两端视图", () => {
    const context = separatedSpanFixture();
    const connection = context.connections().first()!;

    expect(connection.source).toBe(
      context.spans({ id: connection.source.span.id }).first(),
    );
    expect(connection.target).toBe(
      context.spans({ id: connection.target.span.id }).first(),
    );
    expect(connection.sourceBoundary).toBe(connection.source.lastSlice);
    expect(connection.targetBoundary).toBe(connection.target.firstSlice);
    expect(
      context.connections({
        sourceSpanId: connection.source.span.id,
        targetSpanId: connection.target.span.id,
      }).first(),
    ).toBe(connection);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(connection)).toBe(true);
    expect(Object.isFrozen(connection.source)).toBe(true);
    expect(Object.isFrozen(connection.source.slices)).toBe(true);
    expect(Object.isFrozen(connection.source.chords)).toBe(true);
    expect(Object.isFrozen(context.spanNeighborhood(connection.source))).toBe(
      true,
    );
  });

  it("邻接查询拒绝其他 revision 中恰好同 ID 的视图", () => {
    const context = contextFixture();
    const other = contextFixture();

    expect(context.noteNeighborhood(other.notes().first()!)).toBeUndefined();
    expect(() =>
      context.spanNeighborhood(other.spans().first()!),
    ).toThrow(/当前 revision/);
  });

  it("项目首尾、和弦空洞与不连续 span 保持正常边界", () => {
    const context = separatedSpanFixture();
    const [first, second] = context.spans().toArray();
    const connection = context.connections().first()!;

    expect(context.spanNeighborhood(first).previous).toBeUndefined();
    expect(context.spanNeighborhood(second).next).toBeUndefined();
    expect(context.spanNeighborhood(first).next).toBe(second);
    expect(context.spanNeighborhood(second).previous).toBe(first);
    expect(connection.connection.contiguous).toBe(false);
    expect(context.sliceAt(PPQ)?.chord).toBeUndefined();
    expect(context.spanAt(PPQ)).toBeUndefined();
    expect(context.spanAt(-1)).toBeUndefined();
    expect(context.spanAt(PPQ * 3)).toBeUndefined();
  });

  it("查询乐句与终止范围，并优先返回人工终止标注", () => {
    const project = createEmptyProject("终止查询测试");
    project.lengthTicks = PPQ * 2;
    project.structure.phraseBoundaries = [
      {
        id: "phrase-end",
        tick: PPQ,
        source: "manual",
        confidence: "certain",
      },
    ];
    project.chordTrack.regions = [
      correctionChord("source", 0, PPQ),
      correctionChord("target", PPQ, PPQ),
    ];
    project.chordTrack.cadenceAnnotations = [
      {
        id: "manual-cadence",
        phraseId: "phrase-0-960",
        fromTick: 0,
        toTick: PPQ,
        kind: "half",
        source: "manual",
        confidence: "certain",
        locked: false,
      },
    ];
    const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));

    expect(context.phrases().toArray()).toHaveLength(2);
    expect(context.phraseAt(0)?.id).toBe("phrase-0-960");
    expect(context.boundaryAt(PPQ)?.id).toBe("phrase-end");
    expect(context.cadenceAt(0)).toMatchObject({
      id: "manual-cadence",
      source: "manual",
      kind: "half",
    });
    expect(context.cadences({ kind: "full" }).toArray()).toEqual([]);
  });
});
