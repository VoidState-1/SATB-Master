import { describe, expect, it } from "vitest";
import { PPQ, type ProjectDocument } from "../../../../project";
import { compileScoreText } from "../../../../scoreText";
import { applyChordInference, applyHarmonyInference, inferChords, inferHarmony } from "../../../inference";
import { checkHarmony } from "../../../registry";

describe("阻碍进行的六级三音重复配置", () => {
  type Parts = readonly [string, string, string, string];
  const toVi: Parts = ["B4/2 | C5/2", "F4/2 | E4/2", "D4/2 | C4/2", "G2/2 | A2/2"];
  const toMinorVI: Parts = ["B4/2 | C5/2", "F4/2 | Eb4/2", "D4/2 | C4/2", "G2/2 | Ab2/2"];
  const suggestion = "chord.triad-root-position-doubling";
  const leading = "resolution.leading-tone";
  const seventh = "resolution.chord-seventh";
  const arrival = 2 * PPQ;

  function run(
    parts = toVi, key = "C major", harmony: string | undefined = "V7/2 | vi/2",
    boundary = false,
  ) {
    const source = `satb 1
key ${key}
meter 2/4
bars 1..2 {
 S: | ${parts[0]} |
 A: | ${parts[1]} |
 T: | ${parts[2]} |
 B: | ${parts[3]} |
 H: | ${harmony} |
}`;
    const { project } = compileScoreText(source);
    if (boundary) project.structure.phraseBoundaries.push({
      id: "manual", tick: arrival, confidence: "certain", source: "manual",
    });
    return checkHarmony(project).diagnostics;
  }

  function d5At(tick = arrival, endTick = 4 * PPQ) {
    return expect.objectContaining({ ruleId: suggestion, severity: "suggestion", tick, endTick,
      params: { counts: "1/2/1", inversion: 0 } });
  }

  describe("原位属七实际解决到六级时的三音重复", () => {
    it.each([
      ["大调完整属七", toVi, "C major", "V7/2 | vi/2"],
      ["小调完整属七", toMinorVI, "C minor", "V7/2 | VI/2"],
      ["上声部属根上四度补主音", [toVi[0], toVi[1], "G3/2 | C4/2", toVi[3]], "C major", "V7/2 | vi/2"],
      ["上声部属根下五度补主音", [toMinorVI[0], "G4/2 | C4/2", "F3/2 | Eb3/2", toMinorVI[3]], "C minor", "V7/2 | VI/2"],
    ] satisfies Array<[string, Parts, string, string]>)("%s 的实写重复不建议改成重根", (_label, parts, key, chords) => {
      expect(run(parts, key, chords)).not.toContainEqual(d5At());
    });

    it("无预给标签时也由正常推导和规则入口取得同一结果", () => {
      const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
 S: | G5/2 | B4/2 | C5/2 |
 A: | G4/2 | F4/2 | E4/2 |
 T: | E4/2 | D4/2 | C4/2 |
 B: | C3/2 | G2/2 | A2/2 |
}`);
      const analyzed = applyHarmonyInference(project, inferHarmony(project), { mode: "replace-unlocked" }).project;
      expect(analyzed.chordTrack.regions.at(-1)?.semantics?.interpretations[0]).toMatchObject({ degree: 6 });
      expect(checkHarmony(analyzed).diagnostics).not.toContainEqual(d5At(4 * PPQ, 6 * PPQ));
    });

    it.each([
      ["主到六级", ["C5/2 | C5/2", "G4/2 | E4/2", "E4/2 | C4/2", "C3/2 | A2/2"], "I/2 | vi/2"],
      ["给错属七标签，实奏为另一和弦", ["C5/2 | C5/2", "G4/2 | E4/2", "E4/2 | C4/2", "C3/2 | A2/2"], "V7/2 | vi/2"],
      ["同级但低音换音区", [toVi[0], toVi[1], toVi[2], "G2/2 | A3/2"], "V7/2 | vi/2"],
      ["导音换八度", ["B4/2 | C6/2", toVi[1], toVi[2], toVi[3]], "V7/2 | vi/2"],
      ["属七五音异名", [toVi[0], toVi[1], "C##4/2 | C4/2", toVi[3]], "V7/2 | vi/2"],
      ["和弦配置虽相同，VI 第二拍另外重奏", ["B4/2 | C5/4 C5/4", "F4/2 | E4/4 E4/4", "D4/2 | C4/4 C4/4", "G2/2 | A2/4 A2/4"], "V7/2 | vi/2"],
    ] satisfies Array<[string, Parts, string]>)("%s 不获得例外", (_label, parts, chords) => {
      expect(run(parts, "C major", chords)).toContainEqual(d5At(parts[0].includes("C5/4 C5/4") ? 3 * PPQ : arrival));
    });

    it("明确句界后保留配置建议", () => {
      expect(run(toVi, "C major", "V7/2 | vi/2", true)).toContainEqual(d5At());
    });

    it("六级有重三但原声部七音未下行，配置建议与七音 warning 都存在", () => {
      const bad: Parts = ["B4/2 | C5/2", "D4/2 | E4/2", "F3/2 | C4/2", "G2/2 | A2/2"];
      const findings = run(bad);
      expect(findings).toContainEqual(d5At());
      expect(findings).toContainEqual(expect.objectContaining({ ruleId: seventh, severity: "warning", tick: arrival,
        voiceIds: ["tenor"] }));
    });

    it("小调坏例的导音下行增二度仍报旋律和解决警告", () => {
      const wrong: Parts = ["D5/2 | C5/2", "B3/2 | Ab3/2", "F3/2 | Eb3/2", "G2/2 | Ab2/2"];
      const findings = run(wrong, "C minor", "V7/2 | VI/2");
      expect(findings).toContainEqual(expect.objectContaining({ ruleId: leading, severity: "warning", tick: arrival,
        voiceIds: ["alto"] }));
      expect(findings).toContainEqual(expect.objectContaining({
        ruleId: "melody.augmented-interval", severity: "warning", tick: arrival, voiceIds: ["alto"],
      }));
    });
  });
});

describe("经过主四六的三音重复配置", () => {
  // Huang ch. 22, written exercise 7, reproducing the resolution in Spasobin 22-303.
  const score = `satb 1
key G minor
meter 3/4
bars 1..2 {
  S: | D5/4 C5/4 Bb4/4 | C5/2. |
  A: | G4/4 F#4/4 G4/4 | Eb4/2. |
  T: | Bb3/4 A3/4 Bb3/4 | A3/2. |
  B: | G2/4 Eb3/4 D3/4 | C3/2. |
}
`;

  function blind() {
    const project = compileScoreText(score).project;
    return applyChordInference(project, inferChords(project), { mode: "replace-unlocked" }).project;
  }

  function warnings(project: ProjectDocument) {
    return checkHarmony(project).diagnostics.filter(d => d.tick === 2 * project.ppq &&
      d.ruleId === "chord.second-inversion-voicing");
  }

  describe("导七二和弦解决到经过主四六的三音重复", () => {
    it("盲推和只给定和弦拼写时都认可原声部的规范解决", () => {
      const project = blind();
      const middle = project.chordTrack.regions.find(c => c.startTick === 2 * project.ppq);
      expect(middle?.identity).toMatchObject({ root: { step: "G", alter: 0 }, bass: { step: "D", alter: 0 } });
      expect(warnings(project)).toHaveLength(0);
      project.chordTrack.regions.forEach(chord => { delete chord.semantics; });
      expect(warnings(project)).toHaveLength(0);
    });

    it("实奏音级集合、重复数与给定和弦相同，但导七五音落错八度时仍报", () => {
      const project = blind();
      project.satbTracks[0].notes[2].pitch.octave++;
      expect(warnings(project)).toHaveLength(1);
    });

    it("缺少经过落点或句界分隔时仍报", () => {
      const noStep = blind();
      noStep.satbTracks[3].notes[3].pitch.octave--;
      expect(warnings(noStep)).toHaveLength(1);
      const cut = blind();
      cut.structure.phraseBoundaries.push({
        id: "cut", source: "manual", tick: 3 * cut.ppq, confidence: "certain",
      });
      expect(warnings(cut)).toHaveLength(1);
    });
  });
});

describe("主音持续低音上的下属四六配置", () => {
  const ruleId = "chord.second-inversion-voicing";

  function score(minor = true) {
    return compileScoreText(minor ? `satb 1
key C minor
meter 4/4
bars 1..1 {
  S: | C5/1 |
  A: | Eb4/8 E4/8 F4/4 Eb4/2 |
  T: | C4/8 Bb3/8 Ab3/4 G3/2 |
  B: | C3/1 |
  H: | i/8 r/8 iv64/4 i/2 |
}` : `satb 1
key F major
meter 4/4
bars 1..1 {
  S: | F4/8 F4/8 F4/4 F4/2 |
  A: | C4/8 Eb4/8 Db4/4 C4/2 |
  T: | A3/8 A3/8 Bb3/4 A3/2 |
  B: | F2/1 |
  H: | I/8 r/8 iv64/4 I/2 |
}`).project;
  }

  function warnings(project: ProjectDocument, tick: number = project.ppq) {
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === ruleId && d.tick === tick);
  }

  describe("subdominant six-four within a written tonic pedal", () => {
    it.each([true, false])("recognizes the tonic pedal with minor=%s", minor => {
      expect(warnings(score(minor))).toHaveLength(0);
    });

    it("allows blank flanking labels when the local key and all the pitches agree", () => {
      const project = score();
      project.chordTrack.regions = project.chordTrack.regions.filter(c => c.startTick === project.ppq);
      expect(warnings(project)).toHaveLength(0);
    });

    const breaks: [string, (p: ProjectDocument) => void][] = [
      ["missing prepared tonic third", p => { p.satbTracks[1].notes[0].pitch = { step: "G", alter: 0, octave: 4 }; }],
      ["wrong preceding applied chord", p => { p.satbTracks[1].notes[1].pitch.alter = -1; }],
      ["enharmonic spelling of the preceding leading note", p => {
        p.satbTracks[1].notes[1].pitch = { step: "F", alter: -1, octave: 4 };
      }],
      ["unresolved seventh in its original voice", p => {
        p.satbTracks[2].notes[2].pitch.octave--;
      }],
      ["broken upper pedal octave", p => {
        const soprano = p.satbTracks[0].notes[0];
        const duration = soprano.durationTicks;
        soprano.durationTicks = p.ppq;
        p.satbTracks[0].notes.push({
          ...soprano, id: "registral-change", startTick: p.ppq, durationTicks: duration - p.ppq,
          pitch: { ...soprano.pitch, octave: soprano.pitch.octave + 1 },
        });
      }],
      ["rearticulated bass", p => {
        const bass = p.satbTracks[3].notes[0];
        const split = p.ppq;
        p.satbTracks[3].notes.push({ ...bass, id: "bass-return", startTick: split, durationTicks: bass.durationTicks - split });
        bass.durationTicks = split;
      }],
      ["immediate tonic replaced by a different mode", p => {
        p.chordTrack.regions.pop();
        p.satbTracks[1].notes[3].pitch.alter = 0;
      }],
      ["separate complete alternative before the written tonic returns", p => {
        const split = 2 * p.ppq;
        const eighth = p.ppq / 2;
        const [, alto, tenor] = p.satbTracks;
        p.chordTrack.regions.pop();
        for (const [track, step] of [[alto, "E"], [tenor, "A"]] as const) {
          const tonic = track.notes[3];
          tonic.startTick += eighth;
          tonic.durationTicks -= eighth;
          track.notes.splice(3, 0, {
            ...tonic, id: "intervening-" + step, startTick: split, durationTicks: eighth,
            pitch: { ...tonic.pitch, step, alter: -1 },
          });
        }
      }],
      ["new written key at the return", p => {
        p.keyEvents.push({ ...p.keyEvents[0], id: "new-key", tick: p.ppq * 2, mode: "major" });
      }],
      ["contradictory local key in an existing label", p => {
        const tonic = p.chordTrack.regions[2];
        tonic.semantics = { ...tonic.semantics!, interpretations: tonic.semantics!.interpretations.map(reading =>
          ({ ...reading, localKey: { tonic: { step: "F", alter: 0 }, mode: "minor" } })) };
      }],
      ["return fully voiced but approached by leaps", p => {
        const [, alto, tenor] = p.satbTracks;
        [alto.notes[3].pitch, tenor.notes[3].pitch] = [tenor.notes[3].pitch, alto.notes[3].pitch];
      }],
    ];
    it.each(breaks)("retains the configuration warning with %s", (_name, change) => {
      const project = score();
      change(project);
      expect(warnings(project)).toHaveLength(1);
    });

    it.each([0.5, 1, 2])("respects a phrase edge at quarter position %s", beat => {
      const project = score();
      project.structure.phraseBoundaries.push({
        id: "manual-edge", tick: project.ppq * beat, confidence: "certain", source: "manual",
      });
      expect(warnings(project)).toHaveLength(1);
    });

    it("retains the warning on a secondary accent with otherwise identical motion", () => {
      const project = score();
      const ppq = project.ppq;
      const events = [...project.satbTracks.flatMap(track => track.notes), ...project.chordTrack.regions];
      for (const event of events) {
        if (event.startTick + event.durationTicks === ppq * 4) event.durationTicks -= ppq;
        event.startTick += ppq;
      }
      expect(warnings(project, ppq * 2)).toHaveLength(1);
    });

    it("still checks the required bass doubling in a genuine K46–D–T", () => {
      const project = compileScoreText(`satb 1
key G major
meter 4/4
bars 1..1 {
  S: | B4/4 A4/4 G4/2 |
  A: | G4/4 F#4/4 G4/2 |
  T: | D4/4 D4/4 B3/2 |
  B: | D3/2 G2/2 |
  H: | K46/4 D/4 T/2 |
}`).project;
      expect(warnings(project, 0)).toHaveLength(0);
      project.satbTracks[2].notes[0].pitch = { step: "G", alter: 0, octave: 3 };
      expect(warnings(project, 0)).toHaveLength(1);
    });
  });
});
