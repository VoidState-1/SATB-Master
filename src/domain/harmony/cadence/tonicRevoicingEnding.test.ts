import { describe, expect, it } from "vitest";
import { PPQ } from "../../project";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { phraseInferenceFingerprint } from "../phrase";

const major = `satb 1
key D major
meter 4/4
bars 1..3 {
  S: | r/2. E5/4 | D5/1~ | D5/1 |
  A: | r/2. C#4/4 | D4/4 C4/4 B3/4 Bb3/4 | A3/1 |
  T: | r/2. G3/4 | F#3/4 A3/4 G3/4 E3/4 | F#3/1 |
  B: | r/2. A2/4 | D3/1~ | D3/1 |
  H: | r/2. V7/4 | I/4 r/4 IV64/4 r/4 | I/1 |
}`;

const minor = `satb 1
key Eb major
meter 6/8
bars 1..3 {
  S: | r/t2400 D5/8 | C5/2 r/4 | Bb4/2. |
  A: | r/t2400 B3/8 | C4/4 Ab3/8 G3/8 r/4 | G4/2. |
  T: | r/t2400 F3/8 | Eb3/4 F3/8 Eb3/8 r/4 | Eb4/2. |
  B: | r/t2400 G2/8 | C3/2 r/4 | Eb3/2. |
}
annotations {
  chord dominant range=[1:6,2:1) symbol=V7 localKey="C minor"
  chord arrival range=[2:1,2:3) symbol=t localKey="C minor"
  chord auxiliary range=[2:3,2:4) symbol=iv64 localKey="C minor"
  chord terminal range=[2:4,2:5) symbol=t localKey="C minor"
  chord new-phrase range=[3:1,4:1) symbol=I
  phrase first range=[1:1,2:5)
}`;

function analyze(text: string, barrier?: number) {
  const { project } = compileScoreText(text);
  if (barrier !== undefined) {
    project.structure.phraseBoundaries.push({
      id: "confirmed-split", tick: barrier, source: "manual", confidence: "certain",
    });
  }
  return inspect(project);
}

function inspect(project: ReturnType<typeof compileScoreText>["project"]) {
  const analysis = buildHarmonyAnalysis(project);
  const reading = analysis.cadenceCandidates.find(candidate =>
    candidate.evidence.some(item => item.code === "closing-tonic-revoicing"));
  return { analysis, reading };
}

describe("属七落主后的外声持续与内声重配", () => {
  it("跨小节持续的外声保留实际落主，内声未标的行进可穿过", () => {
    const { analysis, reading } = analyze(major);
    const arrival = analysis.harmonySpans.find(span => span.fromTick === 4 * PPQ)!;
    expect(reading).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", fromTick: 3 * PPQ, toTick: 12 * PPQ,
      evidence: expect.arrayContaining([expect.objectContaining({
        code: "closing-tonic-revoicing", refs: expect.arrayContaining([arrival.id, "note-S-3840", "note-B-3840"]),
      })]),
    });
  });

  it("局部小调尾部在曲中实际齐收和休止，跨不过去连下句", () => {
    expect(analyze(minor).reading).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", fromTick: 2.5 * PPQ, toTick: 5 * PPQ,
    });
  });

  it("明确半终止和后句起奏分开保留", () => {
    const { analysis, reading } = analyze(major, 4 * PPQ);
    expect(reading).toBeUndefined();
    expect(analysis.cadenceCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "half", toTick: 4 * PPQ }),
    ]));
  });

  it.each([
    ["同一低音重新起奏", major.replace("D3/1~ | D3/1", "D3/1 | D3/1")],
    ["顶部跨八度重新起奏", major.replace("D5/1~ | D5/1", "D5/1 | D6/1")],
    ["上声旋律提前放开", major.replace("D5/1~ | D5/1", "D5/1~ | D5/2 r/2")],
    ["内声出现别的实际休止", major.replace("C4/4 B3/4", "r/4 B3/4")],
    ["无标间隔实际另有完整三和弦", major.replace("C4/4 B3/4", "A3/4 B3/4")
      .replace("F#3/4 A3/4 G3/4", "F#3/4 F#3/4 G3/4")],
    ["属七的七音向上", major.replace("G3/4 | F#3/4", "G3/4 | F#4/4")],
    ["最后低音没有共同释放", major.replace("D3/1~ | D3/1", "D3/1~ | D3/2 r/2")],
    ["下属用途来自前后同属而不是一次主音持续", major.replace("IV64", "V64")],
  ])("%s，不能用局部重配补出正格", (_name, text) => {
    expect(analyze(text).reading).toBeUndefined();
  });
});

function declareSameKey(project: ReturnType<typeof compileScoreText>["project"], tick: number) {
  project.keyEvents.push({ ...project.keyEvents[0], id: "same-written-key", tick });
}

describe("主音重配的结构证据范围", () => {
  it("手工句首可取新奏属七，不把句首之前已经发声的属七当新起点", () => {
    expect(analyze(major, 3 * PPQ).reading?.fromTick).toBe(3 * PPQ);
    expect(analyze(major, 3 * PPQ + PPQ / 8).reading).toBeUndefined();
  });

  it.each([44, 192])("速度 %i 不改变单拍与复拍的谱面证据", bpm => {
    for (const [score, release] of [[major, 12 * PPQ], [minor, 5 * PPQ]] as const) {
      const { project } = compileScoreText(score);
      project.tempoEvents[0].bpm = bpm;
      expect(inspect(project).reading?.toTick).toBe(release);
    }
  });

  it.each([
    ["4/4", major, PPQ],
    ["6/8", minor, PPQ / 2],
  ] as const)("%s 的保存推断句界须有一记谱拍静默", (_meter, score, denominatorBeat) => {
    for (const [gap, inferred, manual] of [
      [0, false, false], [1, false, true], [denominatorBeat - 1, false, true], [denominatorBeat, true, true],
    ] as const) {
      const { project } = compileScoreText(score);
      const release = score === major ? project.lengthTicks : 5 * PPQ;
      project.lengthTicks = release + 2 * PPQ;
      for (const track of project.satbTracks) {
        track.notes = track.notes.filter(note => note.startTick < release);
        const last = track.notes.at(-1)!;
        track.notes.push({ ...last, id: `restart-${last.id}`, startTick: release + gap, durationTicks: PPQ });
      }
      project.chordTrack.regions = project.chordTrack.regions.filter(region => region.startTick < release);
      project.structure.phraseBoundaries = [{
        id: "saved-cut", tick: release, source: "inferred", confidence: "probable", stale: false,
        inferenceFingerprint: phraseInferenceFingerprint(project),
      }];
      let replay = inspect(project);
      expect(replay.analysis.phraseSegments[0].endBoundary?.source).toBe("inferred");
      expect(Boolean(replay.reading)).toBe(inferred);
      project.structure.phraseBoundaries = [{ id: "confirmed-cut", tick: release, source: "manual", confidence: "certain" }];
      replay = inspect(project);
      expect(Boolean(replay.reading)).toBe(manual);
    }
  });

  it("同一调号事件内取证，重申调号处确有新奏属七则从该处开始", () => {
    const heldDominant = major.replaceAll("r/2.", "r/2")
      .replace("E5/4", "E5/2").replace("C#4/4", "C#4/2").replace("G3/4 |", "G3/2 |")
      .replace("A2/4", "A2/2").replace("V7/4", "V7/2");
    const { project: redeclaredMidChord } = compileScoreText(heldDominant);
    declareSameKey(redeclaredMidChord, 3 * PPQ);
    expect(inspect(redeclaredMidChord).reading).toBeUndefined();

    const withApproach = major.replace("S: | r/2.", "S: | r/2 E5/4")
      .replace("A: | r/2.", "A: | r/2 C#4/4").replace("T: | r/2.", "T: | r/2 A3/4")
      .replace("B: | r/2.", "B: | r/2 A2/4").replace("H: | r/2.", "H: | r/2 V/4");
    const { project: redeclaredAtAttack } = compileScoreText(withApproach);
    expect(inspect(redeclaredAtAttack).reading?.fromTick).toBe(2 * PPQ);
    declareSameKey(redeclaredAtAttack, 3 * PPQ);
    expect(inspect(redeclaredAtAttack).reading?.fromTick).toBe(3 * PPQ);
  });

  it("低于落主的第三拍可作重配，另一小节同强度首拍不足以证明同一次收束", () => {
    expect(analyze(major).reading?.toTick).toBe(12 * PPQ);
    const onNextDownbeat = major.replace("D4/4 C4/4 B3/4 Bb3/4 | A3/1", "D4/2. C4/4 | B3/4 Bb3/4 A3/2")
      .replace("F#3/4 A3/4 G3/4 E3/4 | F#3/1", "F#3/2. A3/4 | G3/4 E3/4 F#3/2")
      .replace("I/4 r/4 IV64/4 r/4 | I/1", "I/2. r/4 | IV64/4 r/4 I/2");
    expect(analyze(onNextDownbeat).reading).toBeUndefined();
  });
});
