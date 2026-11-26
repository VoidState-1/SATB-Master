import { describe, expect, it } from "vitest";
import { validateProject } from "../../../../project";
import type { ProjectDocument, VoiceId } from "../../../../project/types";
import { compileScoreText } from "../../../../scoreText";
import { applyHarmonyInference, inferHarmony, inferChords } from "../../../index";
import { checkHarmony } from "../../../registry";

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

function score(parts: readonly string[], harmony?: string, key = "D major") {
  return compileScoreText(`satb 1
key ${key}
meter 3/4
bars 1..1 {
${[..."SATB"].map((voice, index) => ` ${voice}: | ${parts[index]} |`).join("\n")}
${harmony ? ` H: | ${harmony} |` : ""}
}`).project;
}

const soprano = "B4/8 B4/8 A4/2";
const alto = "G#4/4 E4/2";
const tenor = "D4/4 C#4/2";
const bass = "E3/4 A2/2";
const cadence = [soprano, alto, tenor, bass];
const applied = "V7/V/4 V/2";
const warnings = (project: ProjectDocument) =>
  checkHarmony(project).diagnostics.filter(diagnostic => diagnostic.ruleId === "resolution.leading-tone");

describe("an inner leading tone falling to the fifth of a written root-position tonic", () => {
  it.each([undefined, applied])("accepts E7–A with harmony %s when the fifth and seventh step down", harmony => {
    expect(warnings(score(cadence, harmony))).toHaveLength(0);
    const displacedSeventh = score([soprano, alto, "D4/4 C#3/2", bass], harmony);
    expect(warnings(displacedSeventh)).toMatchObject([{
      tick: displacedSeventh.ppq, voiceIds: ["alto"], params: { targetTonic: "A" },
    }]);
  });

  it("requires the fifth's step for the new applied-chord proof and retains the labelled V7–I result", () => {
    const displacedFifth = ["B4/8 B4/8 A5/2", alto, tenor, bass];
    const project = score(displacedFifth, applied);
    expect(warnings(project)).toMatchObject([{ tick: project.ppq, voiceIds: ["alto"], params: { targetTonic: "A" } }]);
    expect(warnings(score(displacedFifth, "V7/4 I/2", "A major"))).toHaveLength(0);
  });

  it("does not use the written resolution across a manual phrase boundary", () => {
    const project = score(cadence, applied);
    project.structure.phraseBoundaries.push({
      id: "cut", tick: project.ppq, source: "manual", confidence: "certain",
    });
    expect(warnings(project)).toMatchObject([{ tick: project.ppq, voiceIds: ["alto"] }]);
  });

  it.each([undefined, "V42/V/4 V6/2"])("keeps E.1 over E7/D–A/C# with harmony %s", harmony => {
    const project = score([soprano, alto, "E3/2.", "D3/4 C#3/2"], harmony);
    expect(warnings(project)).toMatchObject([{ tick: project.ppq, voiceIds: ["alto"], params: { targetTonic: "A" } }]);
  });
});

const revoicedLeadingToneScore = `satb 1
key C major
meter 2/4
bars 1..2 {
 S: | B4/8 A#4/8 B4/4 | C5/2 |
 A: | D4/2 | G4/2 |
 T: | G3/2 | C4/2 |
 B: | G2/4 F2/4 | E2/2 |
 H: | D/8 r/8 D2/4 | T6/2 |
}`;

function read(text = revoicedLeadingToneScore, blind = false) {
  const input = compileScoreText(blind ? text.replace(/^ H:.*$/m, "") : text).project;
  return blind ? applyHarmonyInference(input, { chordInference: inferChords(input) },
    { mode: "replace-unlocked", writeNonChordToneRoles: true }).project : input;
}

function revoicedLeadingToneWarnings(project: ProjectDocument, voice: VoiceId = "soprano") {
  return checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === "resolution.leading-tone" && d.severity === "warning" && d.voiceIds.includes(voice));
}

describe("the owner of a decorated dominant third", () => {
  it.each([false, true])("holds the original obligation into D2, blind=%s", blind => {
    expect(revoicedLeadingToneWarnings(read(revoicedLeadingToneScore, blind))).toEqual([]);
    const bad = read(revoicedLeadingToneScore.replace("C5/2", "G4/2"), blind);
    expect(revoicedLeadingToneWarnings(bad)).toEqual([expect.objectContaining({
      tick: 1920, noteIds: ["note-S-0", "note-S-1920"],
    })]);
  });

  it.each([
    ["wrong return register", revoicedLeadingToneScore.replace("A#4/8 B4/4", "A#4/8 B3/4")],
    ["literal minor chord at the middle", revoicedLeadingToneScore.replace("A#4/8", "Bb4/8")],
    ["authored minor reading over the enharmonic neighbor", revoicedLeadingToneScore.replace("r/8", "v/8")],
    ["no return harmony", revoicedLeadingToneScore.replace("D2/4", "r/4")],
    ["no written fifth on return", revoicedLeadingToneScore.replace("D4/2", "D4/4 G4/4")],
    ["wrong destination inversion", revoicedLeadingToneScore.replace("D2/4", "D65/4")],
  ])("keeps the warning at the first departure with %s", (_reason, text) => {
    expect(revoicedLeadingToneWarnings(read(text))).toContainEqual(expect.objectContaining({ tick: 480 }));
  });

  it("respects an explicit boundary between the neighbor and its return", () => {
    const project = read();
    project.structure.phraseBoundaries.push({ id: "break", source: "manual", tick: 960, confidence: "certain" });
    expect(revoicedLeadingToneWarnings(project)).toContainEqual(expect.objectContaining({ tick: 480 }));
  });

  it("checks the authentic leading tone of the applied chord without opening a home-key obligation on its neighbor", () => {
    const applied = revoicedLeadingToneScore.replaceAll("B4", "C#5").replace("A#4", "B4").replace("C5/2", "D5/2")
      .replace("D4/2 | G4/2", "E4/2 | A4/2").replace("G3/2 | C4/2", "A3/2 | D4/2")
      .replace("G2/4 F2/4 | E2/2", "A2/4 G2/4 | F3/2")
      .replace("D/8 r/8 D2/4 | T6/2", "V/II/8 r/8 V2/II/4 | ii6/2");
    expect(revoicedLeadingToneWarnings(read(applied))).toEqual([]);
    expect(revoicedLeadingToneWarnings(read(applied.replace("D5/2", "A4/2")))).toEqual([expect.objectContaining({
      tick: 1920, noteIds: ["note-S-0", "note-S-1920"],
    })]);
  });

  it("tracks a bass neighbor while a doubled root fills in the step down to the seventh", () => {
    const bass = revoicedLeadingToneScore.replace("B4/8 A#4/8 B4/4 | C5/2", "G4/8 F#4/8 F4/4 | E4/2")
      .replace("G3/2 | C4/2", "G3/2 | G3/2").replace("G2/4 F2/4 | E2/2", "B2/8 A#2/8 B2/4 | C3/2")
      .replace("D/8 r/8 D2/4 | T6/2", "D6/8 r/8 D65/4 | T/2");
    expect(revoicedLeadingToneWarnings(read(bass), "bass")).toEqual([]);
    expect(revoicedLeadingToneWarnings(read(bass.replace("F#4/8", "C5/8")), "bass")).toContainEqual(expect.objectContaining({ tick: 480 }));
  });
});
it("retains the inner voice's legal deceptive resolution after its return", () => {
  const deceptive = `satb 1
key C major
meter 2/4
bars 1..2 {
 S: | G4/4 D5/4 | C5/2 |
 A: | D4/4 G4/4 | E4/2 |
 T: | B3/8 A#3/8 B3/4 | A3/2 |
 B: | G2/2 | A2/2 |
 H: | D/8 r/8 D/4 | TSVI/2 |
}`;
  expect(revoicedLeadingToneWarnings(read(deceptive), "tenor")).toEqual([]);
  expect(revoicedLeadingToneWarnings(read(deceptive.replace("A3/2", "G3/2")), "tenor")).toEqual([
    expect.objectContaining({ tick: 1920, noteIds: ["note-T-0", "note-T-1920"] }),
  ]);
});

const tenorThirdLeapScore = `satb 1
key A major
meter 4/4
bars 1..1 {
 S: | A4/4 B4/8 B4/4. A4/4 |
 A: | E4/1 |
 T: | C#4/4 G#3/2 C#4/4 |
 B: | A2/4 E3/2 A3/4 |
}`;

function throughEntry(material: string, mode: "blind" | "given", harmony = "I/4 V/2 I/4") {
  const input = compileScoreText(mode === "given"
    ? material.replace("}", ` H: | ${harmony} |\n}`)
    : material).project;
  if (mode === "given") return input;
  return applyHarmonyInference(input, { chordInference: inferChords(input) }, {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  }).project;
}

function tenorWarnings(project: ReturnType<typeof throughEntry>) {
  return checkHarmony(project).diagnostics.filter(diagnostic =>
    diagnostic.ruleId === "resolution.leading-tone" && diagnostic.voiceIds.includes("tenor"));
}

describe.each(["blind", "given"] as const)("§7.2 tenor third leap through the %s entry", mode => {
  it("allows the upward fourth into close spacing with a held common tone", () => {
    const project = throughEntry(tenorThirdLeapScore, mode);
    expect(project.chordTrack.regions.find(region => region.startTick === project.ppq)?.identity)
      .toMatchObject({ root: { step: "E", alter: 0 }, structure: { quality: "major" } });
    expect(tenorWarnings(project)).toHaveLength(0);
  });

  it("allows same-register reattacks and a descending fifth in the bass", () => {
    const material = tenorThirdLeapScore.replace("E4/1", "E4/4 E4/2 E4/4")
      .replace("G#3/2", "G#3/4 G#3/4").replace("A3/4", "A2/4");
    expect(tenorWarnings(throughEntry(material, mode))).toHaveLength(0);
  });

  it.each([
    ["the tonic third is an octave away", tenorThirdLeapScore.replace("G#3/2 C#4/4", "G#3/2 C#5/4"), "I/4 V/2 I/4"],
    ["the common tone changes register", tenorThirdLeapScore.replace("E4/1", "E4/2. E5/4"), "I/4 V/2 I/4"],
    ["the common tone moves to another voice", tenorThirdLeapScore.replace("B4/4. A4/4", "B4/4. E5/4")
      .replace("E4/1", "E4/2. A4/4"), "I/4 V/2 I/4"],
    ["the soprano rises and the arrival stays open", tenorThirdLeapScore.replace("B4/4. A4/4", "B4/4. A5/4"), "I/4 V/2 I/4"],
    ["the tonic is inverted", tenorThirdLeapScore.replace("E3/2 A3/4", "E3/2 C#3/4"), "I/4 V/2 I6/4"],
    ["the dominant is a seventh chord", tenorThirdLeapScore.replace("E4/1", "E4/4 D4/2 E4/4"), "I/4 V7/2 I/4"],
  ])("keeps the tenor warning when %s", (_description, material, harmony) => {
    const project = throughEntry(material, mode, harmony);
    expect(tenorWarnings(project)).toMatchObject([{
      tick: 3 * project.ppq, severity: "warning", voiceIds: ["tenor"],
    }]);
  });

  it("keeps the warning when a manual phrase boundary separates the chords", () => {
    const project = throughEntry(tenorThirdLeapScore, mode);
    const tick = 3 * project.ppq;
    project.structure.phraseBoundaries.push({ id: "cut", tick, source: "manual", confidence: "certain" });
    expect(tenorWarnings(project)).toMatchObject([{ tick, severity: "warning", voiceIds: ["tenor"] }]);
  });
});

const localScore = `satb 1
key F major
meter 4/4
bars 1..1 {
 S: | A4/4 D5/2 C5/4 |
 A: | F4/4 G4/2. |
 T: | C4/4 B3/2 E4/4 |
 B: | F3/4 G2/2 C3/4 |
}`;

function withLocalChords(material: string) {
  return compileScoreText(`${material}
annotations {
 chord v at=1:2 duration=1/2 symbol=V localKey="C major"
 chord i at=1:4 duration=1/4 symbol=I localKey="C major"
}`).project;
}

describe("§7.2 in an independently established local major key", () => {
  it.each([
    ["blind writeback", (material: string) => throughEntry(material, "blind")],
    ["authored local tonic and dominant", withLocalChords],
    ["authored local major in a minor-key score", (material: string) =>
      withLocalChords(material.replace("key F major", "key F minor").replace("A4/4", "Ab4/4"))],
    ["an established applied dominant before a gap in the labels", (material: string) =>
      throughEntry(material, "given", "r/4 V/V/4 r/2")],
  ] as const)("uses the local C-major obligation with %s", (_description, prepare) => {
    expect(tenorWarnings(prepare(localScore))).toHaveLength(0);

    const wrongOctave = prepare(localScore.replace("B3/2 E4/4", "B3/2 E5/4"));
    expect(tenorWarnings(wrongOctave)).toMatchObject([{
      tick: 3 * wrongOctave.ppq, severity: "warning", params: { key: "C major", targetTonic: "C" },
    }]);
  });

  it.each([
    ["the sounding tonic is declared the dominant of F", 'chord i at=1:4 duration=1/4 symbol=V localKey="F major"'],
    ["the held source is reinterpreted as the tonic of G", 'chord g at=1:3 duration=1/4 symbol=I localKey="G major"'],
  ])("keeps the C-major warning when %s", (_description, competingReading) => {
    const project = compileScoreText(`${localScore}
annotations {
 chord v at=1:2 duration=1/4 symbol=V localKey="C major"
 ${competingReading}
}`).project;
    expect(tenorWarnings(project)).toMatchObject([{
      tick: 3 * project.ppq, severity: "warning", params: { key: "C major", targetTonic: "C" },
    }]);
  });

  it.each(["F major", "C major"])("retains the local C-major obligation across a printed declaration of %s", key => {
    const material = localScore.replace("meter 4/4", `meter 4/4\nat 1:4 key ${key}`);
    expect(tenorWarnings(withLocalChords(material))).toEqual([]);
    const wrongOctave = withLocalChords(material.replace("B3/2 E4/4", "B3/2 E5/4"));
    expect(tenorWarnings(wrongOctave)).toMatchObject([{
      tick: 3 * wrongOctave.ppq, params: { targetTonic: "C" },
    }]);
  });
});
