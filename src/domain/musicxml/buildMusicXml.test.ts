import { describe, expect, it } from "vitest";
import { createChordRegion } from "../chords";
import { createEmptyProject, type NoteEvent, type SpelledPitch } from "../project";
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

  it("sanitizes Windows reserved characters in filename", () => {
    const project = createEmptyProject();
    project.title = "Bach: Chorale / Part 1? *<Final>|";

    const grandFileName = musicXmlFileName(project, "grand-staff");
    expect(grandFileName).toBe("Bach- Chorale - Part 1- --Final--（大谱表）");
    expect(grandFileName).not.toMatch(/[\\/:*?"<>|]/);
  });
});
