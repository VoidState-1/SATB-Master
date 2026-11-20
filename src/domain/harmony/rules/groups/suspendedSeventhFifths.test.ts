import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument } from "../../../project/types";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";

const rule = "voice-leading.parallel-fifths";
const parts = {
  S: "r/4 D5/4~ | D5/4 C5/4", A: "r/4 E4/4 | F4/2",
  T: "r/4 Bb3/4 | A3/2", B: "r/4 G3/4 | F3/2",
  H: "r/4 viiø6/5/4 | vi6/4 I/4",
};

function score(edits: Partial<typeof parts> = {}) {
  const lines = Object.entries({ ...parts, ...edits }).filter(([, v]) => v)
    .map(([part, notes]) => part + ": | " + notes + " |");
  return compileScoreText(["satb 1", "key F major", "meter 2/4", "bars 1..2 {", ...lines, "}"].join("\n")).project;
}

function routes(edits: Partial<typeof parts> = {}) {
  const raw = score({ ...edits, H: "" });
  const blind = applyHarmonyInference(raw, {chordInference: inferChords(raw)},
    {mode: "replace-unlocked", writeNonChordToneRoles: true}).project;
  return [raw, blind, score(edits)];
}

function fifths(p: ProjectDocument, upper = "soprano") {
  return checkHarmony(p).diagnostics.filter(d => d.ruleId === rule && d.tick === 3 * p.ppq &&
    d.voiceIds.includes("bass") && d.voiceIds.some(v => v === upper));
}

describe("a delayed outer fifth over a sounding submediant sixth chord", () => {
  it("reports the same four notes after the inner tritone resolves in place, in all three routes", () => {
    const [raw, blind, declared] = routes();
    for (const p of [raw, blind, declared]) {
      const snapshot = structuredClone(p);
      expect(fifths(p)).toEqual([expect.objectContaining({severity: "error",
        noteIds: expect.arrayContaining(["note-S-960","note-B-960","note-S-2880","note-B-1920"]),
        params: {suspensionEntryTick: 1920}})]);
      expect(p).toEqual(snapshot);
    }
    for (const p of [blind, declared]) {
      const middle = p.chordTrack.regions.find(c => c.startTick === 1920);
      expect(middle?.identity).toMatchObject({root: {step:"D", alter:0}, bass:{step:"F",alter:0},
        structure:{kind:"tertian",quality:"minor"}});
    }
  });

  it("works from three literal identities or an explicitly written, locked vi6", () => {
    const p = score();
    p.chordTrack.regions.forEach(c => { c.locked = true; });
    expect(fifths(p)).toHaveLength(1);
    p.chordTrack.regions.forEach(c => { delete c.semantics; });
    expect(fifths(p)).toHaveLength(1);
  });

  it.each<[string, Partial<typeof parts>]>([
    ["independently attacked D minor", {S:"r/4 D5/4 | D5/4 C5/4"}],
    ["independent interior motion in D minor", {A:"r/4 E4/4 | F4/8 A4/4."}],
    ["a fresh bass attack at the arrival", {B:"r/4 G3/4 | F3/4 F3/4"}],
    ["a return to the preparation", {S:"r/4 D5/4~ | D5/4 D5/4"}],
    ["the soprano moves in the opposite direction", {S:"r/4 D5/4~ | D5/4 E5/4"}],
    ["the lower partner goes up while the fifth descends", {B:"r/4 G2/4 | F3/2"}],
    ["the soprano reaches a different octave", {S:"r/4 D5/4~ | D5/4 C4/4"}],
    ["an audible break before resolution", {S:"r/4 D5/4~ | D5/8 r/8 C5/4"}],
  ])("%s supplies no delayed fifth in any route", (_label, edits) => {
    for (const p of routes(edits)) expect(fifths(p)).toHaveLength(0);
  });

  it("keeps a written independent sixth chord when the inner voices exchange the tonic and third", () => {
    const p = score({A:"r/4 E4/4 | A4/2", T:"r/4 Bb3/4 | F4/2"});
    expect(fifths(p)).toHaveLength(0);
  });

  it("a different preparation or a different harmony at entry cannot borrow the printed resolution", () => {
    expect(fifths(score({A:"r/4 F4/4 | F4/2",H:"r/4 ii7/4 | vi6/4 I/4"}))).toHaveLength(0);
    expect(fifths(score({H:"r/4 viiø6/5/4 | IV64/4 I/4"}))).toHaveLength(0);
    expect(fifths(score({A:"r/4 E4/4 | F3/2"}))).toHaveLength(0);
  });

  it("does not extend the alternate-identity reading to a delayed inner fifth", () => {
    const p = score({S:"r/4 Bb4/4 | A4/2", T:"r/4 D4/4~ | D4/4 C4/4"});
    expect(fifths(p, "tenor")).toHaveLength(0);
  });

  it("respects a phrase cut, key event and explicit competing reading", () => {
    for (const tick of [1440,1920,2400,2880]) {
      const p = score();
      p.structure.phraseBoundaries.push({id:"cut",tick,source:"manual",confidence:"certain"});
      expect(fifths(p)).toHaveLength(0);
    }
    const keyed = score();
    keyed.keyEvents.push({...keyed.keyEvents[0],tick:2400,id:"next"});
    expect(fifths(keyed)).toHaveLength(0);
    const marked = score();
    marked.chordTrack.regions[1].semantics!.cadenceRole = "deceptive";
    expect(fifths(marked)).toHaveLength(0);
    const applied = score();
    applied.chordTrack.regions[1].semantics!.interpretations[0].appliedTarget = {degree:2,primaryFunction:"subdominant"};
    expect(fifths(applied)).toHaveLength(0);
  });

  it("cannot use a sliced-off preparation in another phrase", () => {
    const p = score();
    const first = p.chordTrack.regions[0];
    first.durationTicks = p.ppq / 2;
    p.chordTrack.regions.splice(1, 0, { ...first, id: "later-half", startTick: 1.5*p.ppq });
    expect(fifths(p)).toHaveLength(1);
    p.structure.phraseBoundaries.push({id:"break",tick:1.5*p.ppq,source:"manual",confidence:"certain"});
    expect(fifths(p)).toHaveLength(0);
  });

  it("a fresh inner harmony only just before the strong beat cannot certify the held note's attack", () => {
    const p = score({A:"r/4 F4/8 E4/8 | F4/2", H:"r/4 ii7/8 viiø6/5/8 | vi6/4 I/4"});
    expect(fifths(p)).toHaveLength(0);
  });

  it("ignores unrelated earlier harmony and blocks a contradictory note role at the preparation", () => {
    const p = score({H:"V7/4 viiø6/5/4 | vi6/4 I/4"});
    expect(fifths(p)).toHaveLength(1);
    p.satbTracks[0].notes[0].nonChordToneRole = "passing";
    expect(fifths(p)).toHaveLength(0);
  });
});
