import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument } from "../../../project";
import { checkHarmony } from "../../registry";

interface Example {
  key?: string;
  event?: string;
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  preparation?: string;
  source?: string;
  landing?: string;
  dominant?: string;
  noteRole?: string;
}

function make({
  key = "F major", event = "",
  soprano = "G4/4 G#4/4 A4/4 G4/4",
  alto = "D4/4 F4/4 F4/4 E4/4",
  tenor = "D3/4 D3/4 C3/4 C3/4",
  bass = "Bb2/4 B2/4 C3/2",
  preparation = "ii6", source = "DDVII7", landing = "K46", dominant = "V",
  noteRole = "",
}: Example = {}) {
  return compileScoreText(`satb 1
key ${key}
meter 4/4
${event}
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
}
annotations {
 chord prep range=[1:1,1:2) symbol=${preparation}
 ${source ? `chord dd range=[1:2,1:3) symbol=${source}` : ""}
 chord landing range=[1:3,1:4) symbol=${landing}
 ${dominant ? `chord target range=[1:4,2:1) symbol=${dominant}` : ""}
 ${noteRole}
}`).project;
}

function diagnostics(project: ProjectDocument) {
  return checkHarmony(project).diagnostics;
}

function memberWarnings(project: ProjectDocument) {
  return diagnostics(project).filter(d => d.tick === project.ppq &&
    ["chord.incomplete-members", "chord.unclassified-nonchord-tone"].includes(d.ruleId))
    .map(({ ruleId, noteIds }) => ({ ruleId, noteIds }));
}

function expectBoth(project: ProjectDocument) {
  expect(memberWarnings(project).map(item => item.ruleId).sort()).toEqual([
    "chord.incomplete-members", "chord.unclassified-nonchord-tone",
  ]);
}

const firstInversion: Example = {
  soprano: "D5/4 G#5/4 A5/4 Bb5/4",
  alto: "F4/4 F4/4 F4/4 E4/4",
  tenor: "Bb3/4 B3/4 C4/4 C4/4",
  bass: "Bb2/4 D3/4 C3/4 C2/4",
  preparation: "IV", source: "DDVII65", dominant: "V7",
};

describe("D.1/D.2: dominant preparation with a written raised second", () => {
  it("accepts the explicit DDVII functional label", () => {
    expect(memberWarnings(make())).toEqual([]);
  });

  it("also accepts the explicit vii°7/V spelling of DDVII", () => {
    expect(memberWarnings(make({ source: "viio7/V" }))).toEqual([]);
  });

  it("accepts a first inversion with the actual lowest voice moving down to V", () => {
    expect(memberWarnings(make(firstInversion))).toEqual([]);
  });

  it("accepts a four-voice root-position dominant seventh with an omitted fifth and doubled root", () => {
    expect(memberWarnings(make(firstInversion))).toEqual([]);
    expect(memberWarnings(make({ ...firstInversion, tenor: "Bb3/4 B3/4 C4/4 G3/4" }))).toEqual([]);
    expect(memberWarnings(make({ ...firstInversion, tenor: "Bb3/4 B3/4 C4/4 E3/4" })))
      .toHaveLength(2);
  });

  it("accepts an explicitly consistent local major key", () => {
    expect(memberWarnings(make({
      key: "D minor",
      preparation: 'ii6 localKey="F major"', source: 'DDVII7 localKey="F major"',
      landing: 'K46 localKey="F major"', dominant: 'V localKey="F major"',
    }))).toEqual([]);
  });

  it.each<[string,Example]>([
    ["wrong written pitch at source", {soprano:"G4/4 A4/4 A4/4 G4/4"}],
    ["conventional member in a wrong enharmonic spelling elsewhere", {bass:"Bb2/4 Cb3/4 C3/2"}],
    ["incomplete source", {alto:"D4/4 D4/4 F4/4 E4/4"}],
    ["source voice missing", {alto:"D4/4 r/4 F4/4 E4/4"}],
    ["unresolved raised second despite a complete K46", {
      soprano:"G4/4 G#4/4 F4/4 G4/4", alto:"D4/4 F4/4 A4/4 E4/4",
    }],
    ["substitute reaches its third an octave away", {soprano:"G4/4 G#4/4 A5/4 G4/4"}],
    ["DD leading note moves to V in the wrong octave", {bass:"Bb2/4 B2/4 C2/2"}],
    ["nominal bass is above a real voice", {...firstInversion, tenor:"Bb3/4 B2/4 C4/4 C4/4"}],
    ["common note transferred to another voice", {
      soprano:"G4/4 G#4/4 A4/4 G4/4", alto:"D4/4 F4/4 C4/4 E4/4", tenor:"D3/4 D3/4 F3/4 C3/4",
    }],
    ["unresolved functional interpretation", {source:"DDVII7 confidence=ambiguous"}],
    ["different functional target", {source:"viio7/II"}],
    ["contradicted inversion", {source:"DDVII65"}],
    ["plain tonic six-four", {landing:"I64 role=pedal64"}],
    ["unvoiced cadential third", {soprano:"G4/4 G#4/4 C5/4 G4/4"}],
    ["missing dominant label", {dominant:""}],
    ["missing sounding dominant", {alto:"D4/4 F4/4 F4/4 F4/4"}],
    ["conflicting predominant", {preparation:"I6"}],
    ["change of actual key inside the resolution", {
      event:"at 1:4 key C major", dominant:'V localKey="F major"',
    }],
  ])("keeps an applicable D.1/D.2 warning with %s", (_name, example) => {
    const project = make(example);
    const warnings = memberWarnings(project);
    expect(warnings.map(item => item.ruleId)).toContain("chord.unclassified-nonchord-tone");
    if (_name !== "source voice missing") expectBoth(project);
  });

  it.each([960, 1440, 1920, 2400, 2880])("keeps both reports across a manual boundary at %i", tick => {
    const project = make();
    project.structure.phraseBoundaries.push({ id:"cut",tick,source:"manual",confidence:"certain" });
    expectBoth(project);
  });

  it("retains the missing member if the written raised second is already marked non-chord", () => {
    expect(memberWarnings(make({ noteRole:"note S@1:2 role=passing" })).map(item => item.ruleId))
      .toEqual(["chord.incomplete-members"]);
  });

  it("does not treat a configured competing interpretation as permission", () => {
    const project = make();
    const chord = project.chordTrack.regions.find(region=>region.startTick === project.ppq)!;
    const semantics = chord.semantics!;
    const other = { ...semantics.interpretations[0], id:"other", localKey:{tonic:{step:"C",alter:0},mode:"major"} } as const;
    chord.semantics = { ...semantics, alternatives: [other] };
    expectBoth(project);
    chord.semantics = { ...semantics, interpretations: [...semantics.interpretations,other] };
    expectBoth(project);
  });

  it("also preserves the traditional seventh obligation", () => {
    const correct = make({
      soprano:"G4/4 Ab4/4 G4/4 G4/4",
      alto:"D4/4 F4/4 E4/4 E4/4",
      preparation:"ii6", landing:"V", bass:"Bb2/4 B2/4 C3/2",
    });
    const wrong = make({
      soprano:"G4/4 Ab4/4 A4/4 G4/4",
    });
    const seventhWarnings = (project: ProjectDocument) => diagnostics(project).filter(d =>
      d.ruleId === "resolution.chord-seventh" && d.noteIds.includes("note-S-960"));
    expect(seventhWarnings(correct)).toEqual([]);
    expect(seventhWarnings(wrong).map(d=>[d.tick,d.severity])).toEqual([[1920,"warning"]]);
  });
});


describe("D.1/D.2: boundaries of the written member exemption", () => {
  it.each([
    ["extra preparation tone", { alto: "E4/4 F4/4 F4/4 E4/4" }],
    ["dominant seventh doubles the third", { ...firstInversion, tenor: "Bb3/4 B3/4 C4/4 E3/4" }],
    ["reattack inside K46", { alto: "D4/4 F4/4 F4/8 F4/8 E4/4" }],
  ] satisfies [string, Example][])("keeps both reports with %s", (_name, example) => {
    expectBoth(make(example));
  });
});
