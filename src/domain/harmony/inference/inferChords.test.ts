import { describe, expect, it } from "vitest";
import {
  applyChordInference,
  inferChords,
} from "./index";
import { updateChordRegion } from "../../editing";
import { createEmptyProject, PPQ, type NoteEvent, type VoiceId } from "../../project";
import { spellMidi } from "../../pitch";

function note(
  id: string,
  startTick: number,
  durationTicks: number,
  midiNote: number,
  patch: Partial<NoteEvent> = {},
): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch: spellMidi(midiNote),
    velocity: 88,
    locked: false,
    spellingSource: "manual",
    ...patch,
  };
}

function addLine(
  project: ReturnType<typeof createEmptyProject>,
  voiceId: VoiceId,
  values: readonly number[],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = values.map(
    (midiNote, index) => note(`${voiceId}-${index}`, index * PPQ, PPQ, midiNote),
  );
}

function addHarmony(project: ReturnType<typeof createEmptyProject>) {
  addLine(project, "soprano", [72, 74, 72]);
  addLine(project, "alto", [67, 71, 67]);
  addLine(project, "tenor", [64, 67, 64]);
  addLine(project, "bass", [48, 55, 48]);
  project.lengthTicks = PPQ * 3;
}

describe("自动和弦推导", () => {
  it("按时间序列合并连续的同一功能，并保留不同功能区段", () => {
    const project = createEmptyProject();
    addHarmony(project);

    const result = inferChords(project);

    expect(result.regions.map((region) => [region.fromTick, region.toTick])).toEqual([
      [0, PPQ],
      [PPQ, PPQ * 2],
      [PPQ * 2, PPQ * 3],
    ]);
    expect(result.regions.map((region) => region.selected?.functionalBaseId)).toEqual([
      "T",
      "D",
      "T",
    ]);
  });

  it("结合后续属功能识别终止四六，而不是只按实体标记为 T", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addLine(project, "soprano", [76, 77]);
    addLine(project, "alto", [72, 74]);
    addLine(project, "tenor", [67, 71]);
    addLine(project, "bass", [55, 55]);

    const result = inferChords(project);
    expect(result.regions[0].selected?.functionalBaseId).toBe("K46");
    expect(result.regions[0].status).toBe("resolved");
    expect(result.regions[1].selected?.functionalBaseId).toBe("D");
  });

  it("默认只应用已解析区段，并保护已有和弦", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    addLine(project, "soprano", [72]);
    addLine(project, "alto", [67]);
    addLine(project, "tenor", [64]);
    addLine(project, "bass", [48]);
    const result = inferChords(project);

    const applied = applyChordInference(project, result, {
      mode: "fill-gaps",
    });

    expect(applied.skipped).toHaveLength(0);
    expect(applied.project.chordTrack.regions).toHaveLength(1);
    expect(applied.project.chordTrack.regions[0].semantics?.interpretations[0].source).toBe(
      "inferred",
    );
    expect(project.chordTrack.regions).toHaveLength(0);

    const again = applyChordInference(applied.project, result, {
      mode: "fill-gaps",
    });
    expect(again.project.chordTrack.regions).toHaveLength(1);
    expect(again.skipped[0]?.code).toBe("overlap");
  });

  it("应用阶段可选地写入已有依据的非和弦音角色", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.satbTracks.find((track) => track.id === "soprano")!.notes = [
      note("soprano-extra", 0, PPQ, 74, { nonChordToneRole: "passing" }),
    ];
    addLine(project, "alto", [67]);
    addLine(project, "tenor", [64]);
    addLine(project, "bass", [48]);
    const result = inferChords(project, {
      allowNonChordToneCandidates: true,
    });

    const applied = applyChordInference(project, result, {
      mode: "fill-gaps",
      writeNonChordToneRoles: true,
    });

    expect(applied.project.satbTracks.find((track) => track.id === "soprano")!.notes[0]
      .nonChordToneRole).toBe("passing");
  });

  it("手动编辑自动和弦后将语义来源改为 manual", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    addLine(project, "soprano", [72]);
    addLine(project, "alto", [67]);
    addLine(project, "tenor", [64]);
    addLine(project, "bass", [48]);
    const result = applyChordInference(project, inferChords(project), {
      mode: "fill-gaps",
    });
    const chord = result.project.chordTrack.regions[0];
    const edited = updateChordRegion(result.project, chord.id, {
      draft: { inversion: 1 },
    });

    expect(edited.error).toBeUndefined();
    expect(
      edited.project.chordTrack.regions[0].semantics?.interpretations[0].source,
    ).toBe("manual");
  });
});
