import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { applyChordInference, inferHarmony } from "../../domain/harmony/inference";
import { compileScoreText } from "../../domain/scoreText";
import { ChordInferencePreview } from "./ChordInferencePreview";

const tied = `satb 1
key C minor
meter 2/4
bars 1..2 {
 S: | Ab4/2~ | Ab4/4 G4/4 |
 A: | F4/2~ | F4/2 |
 T: | C4/2 | B3/2 |
 B: | F2/2 | G2/2 |
}`;

describe("和弦推导中的候选读法", () => {
  it("并列显示 V9 与有准备证据的 9–8，已占用区段遵守填空模式", () => {
    const { project } = compileScoreText(tied);
    const { regions } = inferHarmony(project).chordInference;
    const draw = (current = project, range = regions) => renderToStaticMarkup(
      <ChordInferencePreview project={current} regions={range} mode="fill-gaps"
        onChoose={() => {}} onApplyRegion={() => {}} />,
    );
    const html = draw();
    expect(html).toContain("V9");
    expect(html).toContain("D7 · 9–8 延留");
    expect(html).toContain("仅应用此段");
    expect(draw(project, regions.filter(region => !region.reviewCandidateIds))).toBe("");
    const saved = applyChordInference(project, inferHarmony(project).chordInference, { mode: "fill-gaps" }).project;
    expect(draw(saved)).toContain("此段已有和弦");
    expect(draw(saved)).toMatch(/<fieldset[^>]*disabled/);
  });

  it("孤立而拼写准确的小九可单独确认，未确认时批量应用略过", () => {
    const { project } = compileScoreText(`satb 1
key C minor
meter 2/4
bars 1..1 {
 S: | Ab4/2 |
 A: | F4/2 |
 T: | B3/2 |
 B: | G2/2 |
}`);
    const result = inferHarmony(project, { minConfidence: "low" }).chordInference;
    const [region] = result.regions;
    const view = renderToStaticMarkup(<ChordInferencePreview project={project} regions={result.regions}
      mode="fill-gaps" onChoose={() => {}} onApplyRegion={() => {}} />);
    expect(view).toContain("需单独确认写入");
    expect(view).toContain("仅应用此段");
    expect(view).not.toContain('type="radio"');
    expect(applyChordInference(project, result, { mode: "fill-gaps" }).appliedRegionCount).toBe(0);
    const saved = applyChordInference(project, result, { mode: "fill-gaps",
      selection: new Set([region.id]), candidateChoices: new Map([[region.id, region.selected!.id]]) });
    expect(saved.project.chordTrack.regions[0].identity).toEqual(region.selected!.identity);
  });

  it("单段替换保留原和弦两侧及所有音符", () => {
    const { project } = compileScoreText(tied);
    const result = inferHarmony(project).chordInference;
    const region = result.regions.find(item => item.reviewCandidateIds?.length)!;
    const candidateId = region.reviewCandidateIds!.find(id => id !== region.selected!.id)!;
    const saved = applyChordInference(project, result, { mode: "fill-gaps" }).project;
    const current = saved.chordTrack.regions.find(item => item.startTick === region.fromTick)!;
    const wide = { ...current, startTick: project.ppq, durationTicks: 3 * project.ppq };
    const fixture = { ...project, chordTrack: { ...project.chordTrack, regions: [wide] } };
    const { project: applied, appliedRegionCount } = applyChordInference(fixture, result, {
      mode: "replace-unlocked", selection: new Set([region.id]), candidateChoices: new Map([[region.id, candidateId]]),
    });
    const [before, changed, after] = applied.chordTrack.regions;
    expect(appliedRegionCount).toBe(1);
    expect(before).toEqual({ ...wide, durationTicks: project.ppq });
    expect(changed.identity).toEqual(region.alternatives.find(option => option.id === candidateId)!.identity);
    expect(after).toMatchObject({
      startTick: 3 * project.ppq, durationTicks: project.ppq, identity: wide.identity, semantics: wide.semantics,
    });
    expect(new Set([before.id, changed.id, after.id]).size).toBe(3);
    expect(applied.satbTracks).toEqual(fixture.satbTracks);
    expect(applied.structure).toEqual(fixture.structure);
  });
});
