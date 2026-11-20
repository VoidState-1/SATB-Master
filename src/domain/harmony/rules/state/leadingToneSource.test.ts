import { describe, expect, it } from "vitest";
import { validateProject, type ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, checkHarmony, inferHarmony } from "../../index";

const leading = "resolution.leading-tone";
const seventh = "resolution.chord-seventh";

function score(
  key: string,
  parts: readonly string[],
  { labels, meter = "2/4", annotations }: { labels?: string; meter?: string; annotations?: string } = {},
) {
  const project = compileScoreText(`satb 1
key ${key}
meter ${meter}
bars 1..1 {
${[..."SATB"].map((voice, index) => ` ${voice}: ${parts[index] ? `| ${parts[index]} |` : "empty"}`).join("\n")}
${labels ? ` H: | ${labels} |` : ""}
}
${annotations ? `annotations {\n${annotations}\n}` : ""}`).project;
  expect(validateProject(project)).toBe(true);
  return project;
}

function blindWriteback(input: ProjectDocument) {
  expect(input.chordTrack.regions).toEqual([]);
  const { project } = applyHarmonyInference(input, inferHarmony(input), {
    mode: "replace-unlocked",
    writeNonChordToneRoles: true,
  });
  expect(validateProject(project)).toBe(true);
  return project;
}

function resolutions(project: ProjectDocument, ruleId: typeof leading | typeof seventh) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === ruleId);
}

function expectSeventhWarnings(project: ProjectDocument, semitones?: number) {
  expect(resolutions(project, seventh)).toMatchObject(semitones === undefined ? [] : [{
    tick: project.ppq,
    voiceIds: ["soprano"],
    noteIds: ["note-S-0", `note-S-${project.ppq}`],
    params: { resolutionSemitones: semitones },
  }]);
}

function expectLeadingWarning(project: ProjectDocument, fromBeat: number, toBeat: number, targetTonic: string) {
  const warnings = resolutions(project, leading);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatchObject({
    tick: toBeat * project.ppq,
    voiceIds: ["soprano"],
    severity: "warning",
    params: { targetTonic },
    trace: expect.arrayContaining([
      { tick: fromBeat * project.ppq, outcome: "continue", reason: "obligation-opened" },
      { tick: toBeat * project.ppq, outcome: "violate", reason: "leading-tone-moved-elsewhere" },
    ]),
  });
}

describe("E.1 leading-tone source", () => {
  it.each([
    ["A4", undefined],
    ["C5", 1],
  ] as const)("the seventh of a labelled major tonic seventh moves to %s", (landing, semitones) => {
    // Score text uses I7 for the major tonic seventh.
    const project = score("C major", [
      `B4/4 ${landing}/4`, "G4/4 F4/4", "E4/4 C4/4", "C3/4 F3/4",
    ], { labels: "I7/4 IV/4" });

    expect(resolutions(project, leading)).toEqual([]);
    expectSeventhWarnings(project, semitones);
  });

  it("blind writeback preserves the passing tonic seventh without opening E.1", () => {
    const project = blindWriteback(score("D major", [
      "D5/2 D5/4", "A4/2 B4/4", "F#4/2 F#4/4", "D3/4 C#3/4 B2/4",
    ], { meter: "3/4" }));

    expect(project.chordTrack.regions.find(chord => chord.startTick === project.ppq)).toMatchObject({
      identity: { root: { step: "D", alter: 0 }, bass: { step: "C", alter: 1 }, structure: { quality: "major7" } },
    });
    expect(resolutions(project, leading)).toEqual([]);
    expect(resolutions(project, seventh)).toEqual([]);
  });

  it.each(["given", "blind writeback"] as const)("III's fifth and V's third differ with %s chords", entry => {
    for (const dominant of [false, true]) {
      const input = score("C major", [
        "B4/4 E5/4", "G4/2", dominant ? "D4/4 C4/4" : "E4/4 C4/4",
        dominant ? "G2/4 C3/4" : "E3/4 C3/4",
      ], { labels: entry === "given" ? (dominant ? "V/4 I/4" : "DTIII/4 I/4") : undefined });
      const project = entry === "given" ? input : blindWriteback(input);
      expect(project.chordTrack.regions[0]).toMatchObject({
        startTick: 0,
        identity: {
          root: { step: dominant ? "G" : "E", alter: 0 },
          structure: { quality: dominant ? "major" : "minor" },
        },
        ...(!dominant && entry === "given" && {
          semantics: { interpretations: [{ designation: { primaryFunction: "dominant", secondaryFunction: "tonic" } }] },
        }),
      });
      if (dominant) {
        expectLeadingWarning(project, 0, 1, "C");
      } else {
        expect(resolutions(project, leading)).toEqual([]);
      }
    }
  });

  it.each([
    ["Bb4", undefined],
    ["D5", 2],
  ] as const)("the local minor tonic's natural VII moves to %s", (landing, semitones) => {
    const project = score("Bb major", [
      `C5/4 ${landing}/4`, "F4/4 G4/4", "A3/4 D4/4", "D3/4 Bb2/4",
    ], { annotations: `
      chord source at=1:1 duration=1/4 symbol=i7 localKey="D minor"
      chord destination at=1:2 duration=1/4 symbol=s6 localKey="D minor"` });
    expect(project.chordTrack.regions[0]).toMatchObject({
      identity: { structure: { quality: "minor7" } },
      semantics: { interpretations: [{ degree: 1, localKey: { mode: "minor", tonic: { step: "D", alter: 0 } } }] },
    });

    expect(resolutions(project, leading)).toEqual([]);
    expectSeventhWarnings(project, semitones);
  });

  it.each([
    ["complete V", "G4/4 A4/4", "C3/4 F3/4", true],
    ["incomplete four-part writing", "C5/4 A4/4", "C3/4 F3/4", false],
    ["complete iii", "A4/4 A4/4", "A3/4 F3/4", false],
  ] as const)("unlabelled %s with the same E5 departure", (_source, alto, bass, owesResolution) => {
    const input = score("F major", [
      "E5/4 C5/4", alto, "C4/2", bass,
    ]);
    expect(input.chordTrack.regions).toEqual([]);

    if (owesResolution) {
      expectLeadingWarning(input, 0, 1, "F");
      expectLeadingWarning(blindWriteback(input), 0, 1, "F");
      const resolved = score("F major", ["E5/4 F5/4", alto, "C4/2", bass]);
      expect(resolutions(resolved, leading)).toEqual([]);
      expect(resolutions(blindWriteback(resolved), leading)).toEqual([]);
    } else {
      expect(resolutions(input, leading)).toEqual([]);
      expect(resolutions(blindWriteback(input), leading)).toEqual([]);
    }
  });

  it.each(["C5", "F5"] as const)("the written leading-tone triad still tests its root when it moves to %s", landing => {
    const project = score("F major", [
      `E5/4 ${landing}/4`, "Bb4/4 A4/4", "G4/4 C4/4", "G3/4 F3/4",
    ], { labels: "DVII6/4 I/4" });

    if (landing === "F5") {
      expect(resolutions(project, leading)).toEqual([]);
    } else {
      expectLeadingWarning(project, 0, 1, "F");
    }
  });

  it.each(["B4", "E5"] as const)("a given V7/III still tests its own third when it moves to %s", landing => {
    const project = score("C major", [
      `D#5/4 ${landing}/4`, "A4/4 G4/4", "F#4/4 B3/4", "B2/4 E3/4",
    ], { labels: "V7/III/4 iii/4" });
    expect(project.chordTrack.regions[0].semantics?.interpretations[0].appliedTarget).toMatchObject({
      degree: 3, primaryFunction: "dominant", secondaryFunction: "tonic",
    });

    if (landing === "E5") {
      expect(resolutions(project, leading)).toEqual([]);
    } else {
      expectLeadingWarning(project, 0, 1, "E");
    }
    expect(resolutions(project, seventh)).toEqual([]);
  });

  it.each([
    ["DTIII", "given"],
    ["I7", "given"],
    ["DTIII", "blind writeback"],
  ] as const)("a sustained pitch from %s acquires its obligation upon entering V with %s chords", (first, entry) => {
    for (const landing of ["E5", "C5"]) {
      const input = score("C major", [
        `B4/2 ${landing}/4`, "G4/2 E4/4", "E4/4 D4/4 G3/4",
        first === "DTIII" ? "E3/4 G2/4 C3/4" : "C3/4 G2/4 C3/4",
      ], { labels: entry === "given" ? `${first}/4 V/4 I/4` : undefined, meter: "3/4" });
      const project = entry === "given" ? input : blindWriteback(input);
      expect(project.chordTrack.regions.find(chord => chord.startTick === project.ppq)).toMatchObject({
        identity: { root: { step: "G", alter: 0 }, structure: { quality: "major" } },
      });

      if (landing === "C5") {
        expect(resolutions(project, leading)).toEqual([]);
      } else {
        expectLeadingWarning(project, 1, 2, "C");
      }
    }
  });

  it.each(["G4", "Eb4"] as const)("keeps the key-based single-melody teaching check on D4 to %s", landing => {
    const project = blindWriteback(score("Eb major", [`D4/4 ${landing}/4`]));
    expect(project.chordTrack.regions).toEqual([]);

    if (landing === "Eb4") {
      expect(resolutions(project, leading)).toEqual([]);
    } else {
      expectLeadingWarning(project, 0, 1, "E♭");
    }
  });
});
