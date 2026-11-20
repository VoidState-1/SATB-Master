import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument } from "../../../project/types";
import { applyHarmonyInference, inferChords } from "../../inference";
import { checkHarmony } from "../../registry";

function score(held = false, key = "C major", harmony = "", first = "4", second = "4", meter = "2/4") {
  const voices = key === "D major"
    ? ["D5 F#5", "B4 A4", "E4 D4", "G3 A3"]
    : [held ? "C5 C5" : "C5 E5", held ? "D4 E4" : "D4 C4", "A3 G3", "F3 G3"];
  return compileScoreText(["satb 1", "key " + key, "meter " + meter, "bars 1..1 {",
    ...voices.map((notes, i) => "SATB"[i] + ": | " + notes.split(" ").map((n, j) => n + "/" + [first, second][j]).join(" ") + " |"),
    harmony && "H: | SII65/" + first + " " + harmony + "/" + second + " |", "}"].join("\n")).project;
}

function blind(bare: ProjectDocument) {
  const inference = inferChords(bare);
  expect(inference.regions[1].status).toBe("ambiguous");
  return applyHarmonyInference(bare, { chordInference: inference },
    { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
}

function seventh(project: ProjectDocument, tick: number = project.ppq) {
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === "resolution.chord-seventh" &&
    d.tick === tick && d.voiceIds.includes("soprano"));
}

describe("supertonic seventh entering the written tonic six-four", () => {
  it.each(["C major", "D major"])("detects the upward third while retaining the open function in %s", key => {
    const project = blind(score(false, key));
    expect(project.chordTrack.regions).toHaveLength(1);
    const [d] = seventh(project);
    expect(d).toMatchObject({ severity: "warning", voiceIds: ["soprano"], params: { resolutionSemitones: 4 },
      chordIds: [project.chordTrack.regions[0].id] });
    expect(d.params).not.toHaveProperty("targetChord");
    expect(d.trace?.at(-1)?.reason).toBe("supertonic-seventh-leaps-to-six-four");
  });

  it("accepts the correction with a rearticulated seventh in the original octave", () => {
    expect(seventh(blind(score(true)))).toHaveLength(0);
    expect(seventh(score(true, "C major", "K46"))).toHaveLength(0);
  });

  it("uses the ordinary obligation when the supplied target is K46", () => {
    const project = score(false, "C major", "K46");
    const [d] = seventh(project);
    expect(d.chordIds).toHaveLength(2);
    expect(d.trace?.at(-1)?.reason).toBe("chord-seventh-moved-elsewhere");
  });

  it("requires a confirmed source seventh", () => {
    expect(seventh(score())).toHaveLength(0);
  });

  it.each([
    ["4", "2", "3/4", 1],
    ["8", "4", "3/8", 0.5],
  ] as const)("checks stable unequal chord durations in %s and %s notes", (first, second, meter, beats) => {
    const project = score(false, "C major", "r", first, second, meter);
    expect(seventh(project, beats * project.ppq)).toHaveLength(1);
  });

  const breaks: [string, (p: ProjectDocument) => void][] = [
    ["missing tonic", p => { p.satbTracks[2].notes.pop(); }],
    ["enharmonic third", p => { p.satbTracks[0].notes[1].pitch = {step:"F",alter:-1,octave:5}; }],
    ["displaced bass octave", p => { p.satbTracks[3].notes[1].pitch.octave--; }],
    ["marked inner non-chord tone", p => { p.satbTracks[1].notes[1].nonChordToneRole = "passing"; }],
    ["broken inner motion", p => { p.satbTracks[1].notes[1].pitch.octave--; }],
    ["short decoration", p => { p.satbTracks.forEach(t => { t.notes[1].durationTicks /= 2; }); }],
    ["source rest", p => { p.satbTracks[0].notes[0].durationTicks /= 2; }],
    ["new key", p => { p.keyEvents.push({ ...p.keyEvents[0], id: "other", tick: p.ppq, mode: "minor" }); }],
    ["manual phrase break", p => {
      p.structure.phraseBoundaries.push({ id: "boundary", tick: p.ppq, source: "manual", confidence: "certain" });
    }],
    ["different source function", p => {
      p.chordTrack.regions[0].semantics = undefined;
    }],
  ];
  it.each(breaks)("leaves the unlabelled landing open with a %s", (_name, change) => {
    const project = blind(score());
    change(project);
    expect(seventh(project)).toHaveLength(0);
  });
});
