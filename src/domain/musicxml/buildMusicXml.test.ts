// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createChordRegion } from "../chords";
import { addAuxiliaryTrack } from "../editing";
import { createEmptyProject, PPQ, type NoteEvent, type SpelledPitch } from "../project";
import { buildMusicXml } from "./buildMusicXml";
import { musicXmlFileName } from "./types";

function createTestNote(
  id: string,
  startTick: number,
  durationTicks: number,
  pitch: SpelledPitch,
): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch,
    velocity: 80,
    locked: false,
    spellingSource: "manual",
  };
}

function parseMusicXml(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  return doc;
}

function childNames(element: Element) {
  return Array.from(element.children, (child) => child.tagName);
}

describe("MusicXML Export", () => {
  it("generates valid grand-staff MusicXML with 4 voices and correct backup tags", () => {
    const project = createEmptyProject();
    project.title = "Test Chorale";
    project.author = "Bach";

    // Add notes to S, A, T, B
    project.satbTracks[0].notes.push(
      createTestNote("s1", 0, 480, { step: "C", alter: 0, octave: 5 }),
    );
    project.satbTracks[1].notes.push(
      createTestNote("a1", 0, 480, { step: "G", alter: 0, octave: 4 }),
    );
    project.satbTracks[2].notes.push(
      createTestNote("t1", 0, 480, { step: "E", alter: 0, octave: 4 }),
    );
    project.satbTracks[3].notes.push(
      createTestNote("b1", 0, 480, { step: "C", alter: 0, octave: 3 }),
    );

    const xml = buildMusicXml(project, { layout: "grand-staff" });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<work-title>Test Chorale</work-title>");
    expect(xml).toContain('<creator type="composer">Bach</creator>');
    expect(xml).toContain("<staves>2</staves>");
    expect(xml).toContain("<sign>G</sign>");
    expect(xml).toContain("<sign>F</sign>");

    // Voice 1 Soprano stem up staff 1
    expect(xml).toContain("<step>C</step>");
    expect(xml).toContain("<octave>5</octave>");
    expect(xml).toContain("<voice>1</voice>");
    expect(xml).toContain("<stem>up</stem>");
    expect(xml).toContain("<staff>1</staff>");

    // Voice 2 Alto stem down staff 1
    expect(xml).toContain("<step>G</step>");
    expect(xml).toContain("<octave>4</octave>");
    expect(xml).toContain("<voice>2</voice>");
    expect(xml).toContain("<stem>down</stem>");

    // Voice 3 Tenor stem up staff 2
    expect(xml).toContain("<step>E</step>");
    expect(xml).toContain("<voice>3</voice>");
    expect(xml).toContain("<stem>up</stem>");
    expect(xml).toContain("<staff>2</staff>");

    // Voice 4 Bass stem down staff 2
    expect(xml).toContain("<step>C</step>");
    expect(xml).toContain("<octave>3</octave>");
    expect(xml).toContain("<voice>4</voice>");
    expect(xml).toContain("<stem>down</stem>");

    // Check backup elements
    expect(xml).toContain("<backup>");
    expect(xml).toContain("<duration>3840</duration>");
  });

  it("handles single-staff mode", () => {
    const project = createEmptyProject();
    project.title = "Single Staff SATB";

    project.satbTracks[0].notes.push(
      createTestNote("s1", 0, 480, { step: "C", alter: 0, octave: 5 }),
    );
    project.satbTracks[3].notes.push(
      createTestNote("b1", 0, 480, { step: "C", alter: 0, octave: 3 }),
    );

    const xml = buildMusicXml(project, { layout: "single-staff" });

    expect(xml).toContain('<part id="P1">');
    expect(xml).not.toContain("<staves>2</staves>");
    expect(xml).toContain("<sign>G</sign>");
    expect(xml).toContain("<voice>1</voice>");
    expect(xml).toContain("<voice>4</voice>");
  });

  it("handles accidentals, ties, and rests correctly", () => {
    const project = createEmptyProject();
    // Add tied note across half notes in soprano
    project.satbTracks[0].notes.push(
      createTestNote("s1", 0, 960, { step: "F", alter: 1, octave: 4 }),
    );

    const xml = buildMusicXml(project, { layout: "grand-staff" });

    expect(xml).toContain("<step>F</step>");
    expect(xml).toContain("<alter>1</alter>");
    expect(xml).toContain("<rest/>");
  });

  it("exports dynamic key, meter, and tempo changes in subsequent measures", () => {
    const project = createEmptyProject();
    // Measure 2 (tick 3840): change key to G major (1 sharp)
    project.keyEvents.push({
      id: "key-2",
      tick: 3840,
      tonic: { step: "G", alter: 0 },
      mode: "major",
    });
    // Measure 2: change meter to 3/4
    project.meterEvents.push({
      id: "meter-2",
      tick: 3840,
      numerator: 3,
      denominator: 4,
    });
    // Measure 2: change tempo to 144 bpm
    project.tempoEvents.push({
      id: "tempo-2",
      tick: 3840,
      bpm: 144,
    });

    const xml = buildMusicXml(project, { layout: "grand-staff" });

    // Should contain G major fifths in subsequent measure
    expect(xml).toContain("<fifths>1</fifths>");
    expect(xml).toContain("<beats>3</beats>");
    expect(xml).toContain("<beat-type>4</beat-type>");
    expect(xml).toContain("<per-minute>144</per-minute>");
    expect(xml).toContain('<sound tempo="144"/>');
  });

  it("exports functional markings when displayMode is functional", () => {
    const project = createEmptyProject();
    project.chordTrack.displayMode = "functional";
    project.chordTrack.regions.push(
      createChordRegion(
        project,
        0,
        1920,
        {
          degree: 1,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          source: "manual",
          confidence: "certain",
        },
        "chord-1",
      ),
    );

    const xml = buildMusicXml(project, {
      layout: "grand-staff",
      includeChords: true,
      includeRomanNumerals: true,
    });

    expect(xml).toContain("T");
  });

  it("exports chords with offset even when starting in the middle of sustained notes", () => {
    const project = createEmptyProject();
    // Soprano has a whole note (0..3840)
    project.satbTracks[0].notes.push(
      createTestNote("s1", 0, 3840, { step: "C", alter: 0, octave: 5 }),
    );
    // Chord 1 at 0 (C: degree 1)
    project.chordTrack.regions.push(
      createChordRegion(
        project,
        0,
        1920,
        {
          degree: 1,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          source: "manual",
          confidence: "certain",
        },
        "chord-1",
      ),
    );
    // Chord 2 at beat 3 (tick 1920) (G: degree 5)
    project.chordTrack.regions.push(
      createChordRegion(
        project,
        1920,
        1920,
        {
          degree: 5,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          source: "manual",
          confidence: "certain",
        },
        "chord-2",
      ),
    );

    const xml = buildMusicXml(project, {
      layout: "grand-staff",
      includeChords: true,
      includeRomanNumerals: true,
    });

    // Chord 1 at measure start
    expect(xml).toContain("C");
    // Chord 2 at offset 1920
    expect(xml).toContain("<offset>1920</offset>");
    expect(xml).toContain("G");
  });

  it("throws clear error when project contains unrepresentable rhythm to prevent data loss", () => {
    const project = createEmptyProject();
    // Non-binary tick duration (e.g. 77 ticks)
    project.satbTracks[0].notes.push(
      createTestNote("s1", 0, 77, { step: "C", alter: 0, octave: 5 }),
    );

    expect(() => buildMusicXml(project)).toThrow(
      /无法导出 MusicXML.*非标准节奏音符/,
    );
  });

  it("generates SATB separate 4-part choir layout with correct group-name before group-symbol", () => {
    const project = createEmptyProject();
    project.title = "Four Part Choir";

    const xml = buildMusicXml(project, { layout: "satb-separate" });

    expect(xml).toContain('<part id="P1">');
    expect(xml).toContain('<part id="P2">');
    expect(xml).toContain('<part id="P3">');
    expect(xml).toContain('<part id="P4">');
    // Group-name before group-symbol
    const groupNamePos = xml.indexOf("<group-name>Choir</group-name>");
    const groupSymbolPos = xml.indexOf("<group-symbol>bracket</group-symbol>");
    expect(groupNamePos).toBeGreaterThan(-1);
    expect(groupSymbolPos).toBeGreaterThan(groupNamePos);
  });

  it.each([
    ["single-staff", "P2", "P3"],
    ["grand-staff", "P2", "P3"],
    ["satb-separate", "P5", "P6"],
  ] as const)("%s 在 SATB 分谱后按工程顺序导出额外声部", (layout, firstId, secondId) => {
    const first = addAuxiliaryTrack(createEmptyProject(), {
      name: '高音 & <Flute> "I"',
      shortName: "F&<",
      program: 127,
    });
    const { project } = addAuxiliaryTrack(first.project, { name: "低音", program: 32 });
    const [high, low] = project.auxiliaryTracks;
    high.notes.push(createTestNote("high", 0, PPQ, { step: "C", alter: 0, octave: 5 }));
    low.notes.push(createTestNote("low", 0, PPQ, { step: "C", alter: 0, octave: 3 }));

    const xml = buildMusicXml(project, {
      layout,
      auxiliaryTrackIds: [low.id, "unknown-track", high.id, low.id],
    });
    const firstMeta = xml.split(`<score-part id="${firstId}">`)[1].split("</score-part>")[0];
    expect(firstMeta).toContain("<part-name>高音 &amp; &lt;Flute&gt; &quot;I&quot;</part-name>");
    expect(firstMeta).toContain("<part-abbreviation>F&amp;&lt;</part-abbreviation>");
    expect(firstMeta).toContain(`<score-instrument id="${firstId}-I1">`);
    expect(firstMeta).toContain(`<midi-instrument id="${firstId}-I1">`);
    expect(firstMeta).toContain("<midi-program>128</midi-program>");
    expect(xml).toContain(`<score-part id="${secondId}">`);
    expect(xml).toContain("<midi-program>33</midi-program>");

    const doc = parseMusicXml(xml);
    const [treble, bass] = Array.from(doc.querySelectorAll("part")).slice(-2);
    expect(treble.id).toBe(firstId);
    expect(bass.id).toBe(secondId);
    expect(treble.querySelector("clef sign")?.textContent).toBe("G");
    expect(treble.querySelector("clef line")?.textContent).toBe("2");
    expect(bass.querySelector("clef sign")?.textContent).toBe("F");
    expect(bass.querySelector("clef line")?.textContent).toBe("4");
    expect(bass.querySelector("stem")).toBeNull();
    expect(buildMusicXml(project, { layout })).toBe(xml);
    const withoutAuxiliaryTracks = buildMusicXml({ ...project, auxiliaryTracks: [] }, { layout });
    expect(buildMusicXml(project, { layout, includeAuxiliaryTracks: false, auxiliaryTrackIds: [high.id] }))
      .toBe(withoutAuxiliaryTracks);
    expect(buildMusicXml(project, { layout, auxiliaryTrackIds: [] })).toBe(withoutAuxiliaryTracks);
  });

  it("写入同起止和弦、错位复音、连音线和小节属性变更", () => {
    const { project } = addAuxiliaryTrack(createEmptyProject(), { name: "复音" });
    const [track] = project.auxiliaryTracks;
    track.notes.push(
      createTestNote("c", 0, PPQ * 5, { step: "C", alter: 0, octave: 4 }),
      createTestNote("e", 0, PPQ * 5, { step: "E", alter: 0, octave: 4 }),
      createTestNote("g", PPQ, PPQ * 1.5, { step: "G", alter: 1, octave: 4 }),
    );
    project.keyEvents.push({ id: "g-major", tick: PPQ * 4, tonic: { step: "G", alter: 0 }, mode: "major" });
    project.meterEvents.push({ id: "three-four", tick: PPQ * 4, numerator: 3, denominator: 4 });

    const doc = parseMusicXml(buildMusicXml(project));
    const [first, second] = Array.from(doc.querySelectorAll('part[id="P2"] > measure'));
    expect(childNames(first.querySelector("attributes")!)).toEqual(["divisions", "key", "time", "clef"]);
    const events = Array.from(first.children).slice(1);
    expect(events.slice(0, 4).map((element) => element.tagName)).toEqual(["note", "note", "backup", "note"]);
    const [root, chord, backup, rest, dotted] = events;
    expect(root.firstElementChild?.tagName).toBe("pitch");
    expect(root.querySelector("step")?.textContent).toBe("C");
    expect(childNames(chord)).toEqual([
      "chord", "pitch", "duration", "tie", "voice", "type", "stem", "notations",
    ]);
    expect(chord.querySelector("step")?.textContent).toBe("E");
    expect(chord.querySelector("tie")?.getAttribute("type")).toBe("start");
    expect(chord.querySelector("tied")?.getAttribute("type")).toBe("start");
    expect(chord.querySelector("stem")?.textContent).toBe("up");
    expect(backup.textContent?.trim()).toBe(String(PPQ * 4));
    expect(childNames(rest)).toEqual(["rest", "duration", "voice", "type"]);
    expect(rest.querySelector("duration")?.textContent).toBe(String(PPQ));
    expect(rest.querySelector("voice")?.textContent).toBe("2");
    expect(childNames(dotted)).toEqual(["pitch", "duration", "voice", "type", "dot", "stem"]);
    expect(dotted.querySelector("alter")?.textContent).toBe("1");
    expect(dotted.querySelector("voice")?.textContent).toBe("2");
    expect(dotted.querySelector("stem")?.textContent).toBe("down");

    expect(childNames(second.querySelector("attributes")!)).toEqual(["key", "time"]);
    expect(second.querySelector("fifths")?.textContent).toBe("1");
    expect(second.querySelector("beats")?.textContent).toBe("3");
    expect(second.querySelector("tie")?.getAttribute("type")).toBe("stop");
    expect(second.querySelector("tied")?.getAttribute("type")).toBe("stop");
  });

  it("非标准节奏只在选中对应额外声部时阻断导出", () => {
    const invalid = addAuxiliaryTrack(createEmptyProject(), {
      name: "非标准节奏参考",
      showInScorePreview: true,
    });
    const { project } = addAuxiliaryTrack(invalid.project, { name: "标准节奏参考" });
    const [irregular, regular] = project.auxiliaryTracks;
    irregular.notes.push(createTestNote("non-grid", 0, 77, { step: "C", alter: 0, octave: 5 }));
    regular.notes.push(createTestNote("on-grid", 0, PPQ, { step: "G", alter: 0, octave: 5 }));

    expect(() => buildMusicXml(project)).toThrow(/额外声部「非标准节奏参考」.*非标准节奏.*取消勾选.*对齐到网格/);
    const xml = buildMusicXml(project, { auxiliaryTrackIds: [regular.id] });
    expect(xml).toContain("<part-name>标准节奏参考</part-name>");
    expect(xml).not.toContain("非标准节奏参考");
    expect(buildMusicXml(project, { includeAuxiliaryTracks: false })).not.toContain("参考");
  });

  it("超出记谱声部上限时提示拆分或取消勾选，避免丢失音符", () => {
    const { project } = addAuxiliaryTrack(createEmptyProject(), { name: "密集复音" });
    const [track] = project.auxiliaryTracks;
    for (let index = 0; index < 5; index++) {
      track.notes.push(createTestNote(`dense-${index}`, index * PPQ / 8, PPQ, {
        step: "C", alter: 0, octave: 4 + index,
      }));
    }
    expect(() => buildMusicXml(project)).toThrow(/密集复音.*超出记谱声部上限.*拆到多条额外声部/);
    expect(buildMusicXml(project, { auxiliaryTrackIds: [] })).not.toContain("密集复音");
  });

  it("为 MIDI 兼容乐器循环分配 1-based 通道并跳过 10", () => {
    let project = createEmptyProject();
    for (let index = 0; index < 16; index++) {
      ({ project } = addAuxiliaryTrack(project));
    }
    const xml = buildMusicXml(project, { layout: "satb-separate" });
    const channels = Array.from(
      parseMusicXml(xml).querySelectorAll("midi-channel"),
      (element) => Number(element.textContent),
    );
    expect(channels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5]);
  });

  it.each(["single-staff", "grand-staff", "satb-separate"] as const)(
    "%s 将小节内速度的 offset 放在 sound 前并应用到播放时间",
    (layout) => {
      const project = createEmptyProject();
      project.tempoEvents.push({ id: "mid-measure", tick: PPQ, bpm: 144 });
      const doc = parseMusicXml(buildMusicXml(project, { layout }));
      const direction = doc.querySelector('sound[tempo="144"]')!.parentElement!;
      expect(childNames(direction)).toEqual(["direction-type", "offset", "sound"]);
      expect(direction.querySelector("offset")?.textContent).toBe(String(PPQ));
      expect(direction.querySelector("offset")?.getAttribute("sound")).toBe("yes");
    },
  );

  it("sanitizes Windows reserved characters in filename", () => {
    const project = createEmptyProject();
    project.title = "Bach: Chorale / Part 1? *<Final>|";

    const grandFileName = musicXmlFileName(project, "grand-staff");
    expect(grandFileName).toBe("Bach- Chorale - Part 1- --Final--（大谱表）");
    expect(grandFileName).not.toMatch(/[\\/:*?"<>|]/);
  });
});
