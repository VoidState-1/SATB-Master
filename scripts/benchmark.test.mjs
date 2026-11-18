import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { aggregateCases, blindSpec, scoreCadences, scoreChords, scoreRuleAssertions, validateRuleAssertions } from "./benchmark-metrics.mjs";
import { compileScore, parseScoreText } from "../src/domain/scoreText/index.ts";
import { inferChords } from "../src/domain/harmony/index.ts";
import * as chords from "../src/domain/chordModel.ts";

const text = `satb 1
key C major
bars 1..2 {
 S: | B4/1 | C5/1 |
 A: | G4/1 | G4/1 |
 T: | D4/1 | E4/1 |
 B: | G2/1 | C3/1 |
 H: | D/1 | T/1 |
}
annotations {
 note S@1:1 role=passing
}
reference {
 chord first range=[1:1,2:1) symbol=S
 phrase p1 range=[1:1,3:1)
 cadence k1 phrase=p1 range=[1:1,3:1) kind=full
}`;

describe("教材批量评测", () => {
  it("更改答案、给定和弦和附加调性解释不会改变盲推", () => {
    const spec = parseScoreText(text);
    spec.events = [{ at: "2:1", key: "G major" }];
    const other = parseScoreText(text.replace("symbol=S", "symbol=T").replace("H: | D/1 | T/1 |", "H: | T/1 | D/1 |"));
    const bare = compileScore(blindSpec(spec)).project;
    expect(bare.chordTrack.regions).toEqual([]);
    expect(bare.structure.phraseBoundaries).toEqual([]);
    expect(bare.satbTracks.flatMap(track => track.notes).every(note => !note.nonChordToneRole)).toBe(true);
    expect(bare.keyEvents).toHaveLength(1);
    expect(compileScore(blindSpec(spec, ["2:1"])).project.keyEvents).toHaveLength(2);
    expect(inferChords(bare)).toEqual(inferChords(compileScore(blindSpec(other)).project));
  });

  it("按时值评分，有备选的弃权也计入分母", () => {
    const { reference, project } = compileScore(parseScoreText(text));
    const expected = reference.chords[0];
    const split = expected.durationTicks / 4;
    const predictions = [
      { fromTick: 0, toTick: split, selected: expected, alternatives: [], status: "resolved" },
      { fromTick: split, toTick: expected.durationTicks, selected: expected, alternatives: [], status: "ambiguous" },
    ];
    const { totals } = scoreChords(chords, reference, predictions, project.keyEvents, project.keyEvents);
    expect(totals.fields.identity).toEqual({ hits: split, total: expected.durationTicks });
    expect(totals.fields.function.hits).toBe(split);
    expect(totals.resolvedTicks).toBe(split);
    expect(totals.alternativeOnlyTicks).toBe(split * 3);
  });

  it("按音乐字段匹配小调 #viio7 与盲推 DVII，同时区分真正不同的副属目标", () => {
    const spec = parseScoreText(`satb 1
key E minor
meter 1/4
bars 1..1 {
 S: | F#5/4 |
 A: | A4/4 |
 T: | C4/4 |
 B: | D#3/4 |
}
reference {
 chord c at=1:1 duration=1/4 symbol=#viio7 localKey="E minor"
}`);
    const { project, reference } = compileScore(spec);
    const regions = inferChords(compileScore(blindSpec(spec)).project).regions;
    expect(regions[0]).toMatchObject({ status:"resolved", selected:{functionalBaseId:"DVII"} });
    const compare = () => scoreChords(chords, reference, regions, project.keyEvents, project.keyEvents).segments[0].fields;
    expect(compare()).toMatchObject({ identity:true, function:true, strict:true });
    const expected = chords.primaryHarmonyInterpretation(reference.chords[0].semantics);
    const actual = chords.primaryHarmonyInterpretation(regions[0].selected.semantics);
    expected.appliedTarget = { degree:5, primaryFunction:"dominant" };
    actual.appliedTarget = { ...expected.appliedTarget, secondaryFunction:undefined };
    expect(compare().function).toBe(true);
    actual.appliedTarget = { ...actual.appliedTarget, degree:2 };
    expect(compare()).toMatchObject({ identity:true, function:false, strict:false });
  });

  it("终止采用一对一匹配，部分参考不会把未标区间算成误报", () => {
    const expected = { id:"e", kind:"half", fromTick:1, toTick:2 };
    const predictions = [
      { ...expected, id:"short", fromTick:0, confidence:"probable" },
      { ...expected, id:"exact", confidence:"certain" },
      { ...expected, id:"undecided", confidence:"ambiguous" },
    ];
    const incomplete = scoreCadences({ complete:[], cadences:[expected] }, predictions);
    const complete = scoreCadences({ complete:["cadence"], cadences:[expected] }, predictions);
    expect(complete.matches[0].predictedId).toBe("exact");
    expect(complete.unmatchedPredictions).toEqual(["short"]);
    const rows = [complete, incomplete].map((score, i) => ({ parentQuestion:i, execution:{}, cadences:{blind:score} }));
    const summary = aggregateCases(rows);
    expect(summary.cadences.blind).toMatchObject({ completeCases:1, predicted:2, labeled:1, allKnownLabels:2,
      precision:.5, recall:1, f1:2/3, partialCases:1, ambiguous:2 });
    expect(summary.rules.blind.recall).toBeNull();
  });

  it("命令行保留确认状态、两路原始规则结果和不可覆写的评测输出", () => {
    const directory = mkdtempSync(join(tmpdir(), "satb-benchmark-"));
    try {
      const sourceFile = join(directory, "sample.satbt"), analysisFile = join(directory, "meta.json");
      const manifest = join(directory, "manifest.json"), out = join(directory, "run");
      writeFileSync(sourceFile, text.replace(" H: | D/1 | T/1 |\n", ""));
      writeFileSync(analysisFile, JSON.stringify({ transcriptionStatus:"confirmed" }));
      writeFileSync(manifest, JSON.stringify({ cases:[{ id:"unit", parentQuestion:["upper", 1], sourceFile, analysisFile }] }));
      const args = [resolve("scripts/benchmark.mjs"), "--manifest", manifest, "--out", out];
      const run = () => spawnSync(process.execPath, args, { encoding:"utf8", timeout:20000, windowsHide:true });
      const result = run();
      expect(result.status, result.stderr).toBe(0);
      const row = JSON.parse(readFileSync(join(out,"cases/unit/result.json"), "utf8"));
      expect(row.execution).toMatchObject({ harmony:"completed", blindRules:"completed", conditionedRules:"completed-limited" });
      expect(row.omittedRuleCadences).toHaveLength(1);
      for (const mode of ["blind","conditioned"]) {
        const diagnoses = JSON.parse(readFileSync(join(out,"cases/unit/rules-" + mode + ".json"), "utf8"));
        expect(Array.isArray(diagnoses.diagnostics)).toBe(true);
      }
      expect(run().status).toBe(1);
    } finally {
      if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith("satb-benchmark-")) throw new Error("临时目录超出测试范围");
      rmSync(directory, { recursive:true, force:true });
    }
  }, 30000);

  it("只评已核验的精确拍位、声部和严重度，跳过或未标注的诊断单列", () => {
    const scope = { mode: "conditioned", ruleId:"r", tick:480, voiceIds:["bass","soprano"], severity:"warning", expected:"absent" };
    const assertions = [scope, { ...scope, tick:0, expected:"present" }, { ...scope, ruleId:"s" }];
    validateRuleAssertions(assertions);
    expect(() => validateRuleAssertions([scope,{ ...scope, voiceIds:["soprano","bass"] }])).toThrow("只允许一个预期");
    const output = { diagnostics:[
      { ...scope, voiceIds:["soprano","bass"] }, { ...scope, severity:"error" }, { ...scope, voiceIds:["tenor","soprano"] }
    ], skippedRules:[{ ruleId:"s", reason:"missing-semantics" }] };
    const readings = scoreRuleAssertions(assertions, output, 960);
    expect(readings.map(entry => entry.verdict)).toEqual(["fp","fn","unscored"]);
    const row = { parentQuestion:1, execution:{}, ruleAssertions:{ conditioned:readings },
      rules:{ conditioned:{counts:{warning:2,error:1,suggestion:0},skippedRuleRecords:1} } };
    const result = aggregateCases([row]).rules.conditioned;
    expect(result.precision).toBeNull();
    expect(result.assertions).toMatchObject({ fp:1, fn:1, evaluated:2, unscored:1, coveredDiagnostics:1, unverifiedDiagnostics:2,
      bySeverity: { warning:{ coveredDiagnostics:1, unverifiedDiagnostics:1 }, error:{ unverifiedDiagnostics:1 } } });
  });
});
