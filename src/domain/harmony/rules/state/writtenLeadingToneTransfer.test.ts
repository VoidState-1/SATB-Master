import { describe, expect, it } from "vitest";
import { validateProject, type ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, checkHarmony, inferHarmony } from "../../index";

const rule = "resolution.leading-tone";
const exchange = `satb 1
key D minor
meter 3/4
bars 1..1 {
 S: | C#5/4 E5/4 D5/4 |
 A: | G4/2 F4/4 |
 T: | A3/2. |
 B: | E3/4 C#3/4 D3/4 |
}`;

const rotation = `satb 1
key G minor
meter 3/4
bars 1..1 {
 S: | C5/4 F#4/4 G4/4 |
 A: | F#4/4 D4/2 |
 T: | D4/4 C4/4 Bb3/4 |
 B: | A2/2 G2/4 |
}`;
const localRotation = rotation.replace("key G minor", "key Eb major");
const localOpening = `
annotations {
 chord opening range=[1:1,1:2) symbol=D43 localKey="G minor"
}`;

function compile(text: string) {
  const project = compileScoreText(text).project;
  expect(validateProject(project)).toBe(true);
  return project;
}

function expectedAt(project: ProjectDocument, beat: number, voice: string) {
  expect(validateProject(project)).toBe(true);
  return checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === rule && d.tick === project.ppq * beat && d.voiceIds.some(v => v === voice));
}

function withLabels(labels: string, text = exchange) {
  return compile(text.replace("}", " H: | " + labels + " |\n}"));
}

function infer(project: ProjectDocument) {
  return applyHarmonyInference(project, inferHarmony(project), {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  }).project;
}

describe("Written leading-tone exchange across a gap in the chord track", () => {
  it.each(["r/4 r/4 t/4", "D43/4 r/4 t/4", "r/4 D65/4 t/4", "D43/4 D65/4 t/4"])(
    "lets the new voice complete the same dominant with %s", labels => {
      const project = withLabels(labels);
      expect(expectedAt(project, 1, "soprano")).toEqual([]);
      expect(expectedAt(project, 2, "bass")).toEqual([]);
    });

  it.each([0.5, 1])("still recognizes the exchange with the same key restated at beat %s", beat => {
    const project = compile(exchange);
    project.keyEvents.push({ ...project.keyEvents[0], id: "restated", tick: project.ppq * beat });
    expect(expectedAt(project, 1, "soprano")).toEqual([]);
    expect(expectedAt(project, 2, "bass")).toEqual([]);
  });

  it("preserves ordinary blind writeback and checking", () => {
    const project = infer(compile(exchange));
    expect(expectedAt(project, 1, "soprano")).toEqual([]);
    expect(expectedAt(project, 2, "bass")).toEqual([]);
  });

  it("only transfers the responsibility and still reports the receiver's wrong departure", () => {
    const project = compile(exchange.replace("E3/4 C#3/4 D3/4", "E3/4 C#3/4 Bb2/4"));
    expect(expectedAt(project, 1, "soprano")).toEqual([]);
    expect(expectedAt(project, 2, "bass")).toEqual([expect.objectContaining({
      severity: "warning", noteIds: ["note-B-1920", "note-B-960"],
      trace: [
        { tick: 960, outcome: "continue", reason: "obligation-opened" },
        { tick: 1920, outcome: "violate", reason: "leading-tone-moved-elsewhere" },
      ],
    })]);
  });

  it.each([
    ["another member moves without returning the receiver's former tone", exchange
      .replace("C#5/4 E5/4", "C#5/4 A4/4").replace("A3/2.", "A3/4 E4/4 A3/4")],
    ["the original dominant doubles its leading tone", exchange.replace("G4/2 F4/4", "C#4/4 E4/4 F4/4")],
    ["the receiving bass is silent just before the attack", exchange.replace("E3/4 C#3/4", "E3/8 r/8 C#3/4")],
    ["the next harmony writes the third as part of another sonority", exchange.replace("G4/2 F4/4", "G4/4 G#4/4 F4/4")],
    ["the new leading pitch is respelled", exchange.replace("C#3/4", "Db3/4")],
  ])("keeps the original warning if %s", (_name, text) => {
    expect(expectedAt(compile(text), 1, "soprano")).toHaveLength(1);
  });

  it("retains a conflicting declared target", () => {
    expect(expectedAt(withLabels("r/4 t/4 t/4"), 1, "soprano")).toHaveLength(1);
  });

  it("does not join the same absolute dominant across conflicting local modes", () => {
    const project = withLabels("r/4 D65/4 t/4");
    project.chordTrack.regions[0].semantics!.interpretations[0].localKey = {
      tonic: { step: "D", alter: 0 },
      mode: "major",
    };
    expect(expectedAt(project, 1, "soprano")).toHaveLength(1);
  });

  it("rejects a participant marked as ornament", () => {
    const project = compile(exchange);
    project.satbTracks.find(t => t.voice === "bass")!.notes[0].nonChordToneRole = "other";
    expect(expectedAt(project, 1, "soprano")).toHaveLength(1);
  });

  it("preserves the warning at a manually marked phrase boundary", () => {
    const project = compile(exchange);
    project.structure.phraseBoundaries.push({ id: "phrase-break", tick: project.ppq,
      source: "manual", confidence: "certain" });
    expect(expectedAt(project, 1, "soprano")).toHaveLength(1);
  });
});

describe("Written leading-tone handoff in a rotation of the upper voices", () => {
  it("passes the third to the soprano through a written three-voice rotation over held bass", () => {
    const project = withLabels("D43/4 r/4 t/4", rotation);
    expect(expectedAt(project, 1, "alto")).toEqual([]);
    expect(expectedAt(project, 2, "soprano")).toEqual([]);
  });

  it("evaluates the soprano's own departure from the same dominant", () => {
    const project = withLabels("D43/4 r/4 t/4", rotation.replace("G4/4", "A4/4"));
    expect(expectedAt(project, 1, "alto")).toEqual([]);
    expect(expectedAt(project, 2, "soprano")).toMatchObject([{
      params: { key: "G minor", leadingTone: "F♯", targetTonic: "G" },
      trace: [
        { tick: 960, outcome: "continue", reason: "obligation-opened" },
        { tick: 1920, outcome: "violate", reason: "leading-tone-moved-elsewhere" },
      ],
    }]);
  });

  it.each([
    ["the received pitch changes register", rotation.replace("F#4/4 G4/4", "F#5/4 G5/4")],
    ["a different voicing intervenes before the rotation", rotation.replace("C5/4", "C5/16 Eb5/16 C5/8")],
    ["a new bass attack replaces the held bass", rotation.replace("A2/2", "A2/4 A2/4")],
    ["one of the other voices abandons its chord member", rotation.replace("C4/4 Bb3/4", "Eb4/4 Bb3/4")],
  ])("keeps the original warning when %s", (_reason, text) => {
    const project = withLabels("D43/4 r/4 t/4", text);
    expect(expectedAt(project, 1, "alto")).toHaveLength(1);
  });

  it("keeps the original warning if a conflicting chord is declared at the rotation", () => {
    const project = withLabels("D43/4 s/4 t/4", rotation);
    expect(expectedAt(project, 1, "alto")).toHaveLength(1);
  });

  it("retains the confirmed local target when only the opening dominant is labelled", () => {
    const project = compile(localRotation.replace("G4/4", "A4/4") + localOpening);
    expect(expectedAt(project, 1, "alto")).toEqual([]);
    expect(expectedAt(project, 2, "soprano")).toMatchObject([{
      params: { key: "G minor", leadingTone: "F♯", targetTonic: "G" },
      trace: [
        { tick: 960, outcome: "continue", reason: "obligation-opened" },
        { tick: 1920, outcome: "violate", reason: "leading-tone-moved-elsewhere" },
      ],
    }]);
  });

  it("opens no obligation when the rotation lacks evidence for a local target", () => {
    const project = compile(localRotation.replace("G4/4", "A4/4"));
    expect(expectedAt(project, 1, "alto")).toEqual([]);
    expect(expectedAt(project, 2, "soprano")).toEqual([]);
  });

  it("keeps the original obligation when the new voicing independently points to a different mode", () => {
    const project = compile(localRotation.replace("Bb3/4", "B3/4") + localOpening);
    expect(expectedAt(project, 1, "alto")).toMatchObject([{ params: { key: "G minor" } }]);
    expect(expectedAt(project, 2, "soprano")).toEqual([]);
  });
});

describe("Textbook failures 20-273a and 20-274", () => {
  it.each([
    ["tenor", ["B4/4 A4/4", "E4/4 C4/4", "G#3/4 F3/4", "E2/4 F2/4"], "D/4 VI/4"],
    ["bass", ["B4/4 C5/4", "E4/4 A4/4", "B3/4 A3/4", "G#3/4 F3/4"], "D6/4 VI/4"],
  ])("keeps the historical bad %s resolution in both entry points", (voice, parts, labels) => {
    const text = `satb 1
key A minor
meter 2/4
bars 1..1 {
${parts.map((line, index) => ["S", "A", "T", "B"][index] + ": | " + line + " |").join("\n")}
}`;
    expect(expectedAt(compile(text), 1, voice)).toHaveLength(1);
    expect(expectedAt(infer(compile(text)), 1, voice)).toHaveLength(1);
    expect(expectedAt(withLabels(labels, text), 1, voice)).toHaveLength(1);
  });
});
