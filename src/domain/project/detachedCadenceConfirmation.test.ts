
import { describe, expect, it } from "vitest";
import { addCadenceAnnotation, addChordRegion, addPhraseBoundary, deleteCadenceAnnotation, deleteChordRegions, updateCadenceAnnotation, updateNote } from "../editing";
import { applyHarmonyInference, buildHarmonyAnalysis, checkHarmony, inferChords } from "../harmony";
import { annotationFromCadenceCandidate } from "../harmony/cadence/confirmation";
import { createHarmonyRuleContext } from "../harmony/rules/context/createRuleContext";
import { buildMidi } from "../midi";
import { buildMusicXml } from "../musicxml";
import { migrateProject, normalizeProject, validateProject, type CadenceAnnotation, type ProjectDocument } from "../project";
import { compileScoreText, renderScoreText } from "../scoreText";

const fixture = `satb 1
title "Detached cadence round trip"
key Eb major
meter 4/4
bars 1..2 {
  S: | Eb5/4 r/4 D5/4 r/4 | Eb5/4 r/2. |
  A: | C5/4 r/4 Ab4/4 r/4 | G4/4 r/2. |
  T: | Ab3/4 r/4 F4/4 r/4 | r/1 |
  B: | Ab2/4 r/4 Bb2/4 r/4 | Eb3/4 r/2. |
}`;
const chordLine = "  H: | IV/4 r/4 V7/4 r/4 | I/4 r/2. |";
const given = () => compileScoreText(fixture.replace("}", chordLine + "\n}")).project;
const blind = () => {
  const raw = compileScoreText(fixture).project;
  return applyHarmonyInference(raw, { chordInference: inferChords(raw) }, { mode: "replace-unlocked" }).project;
};

function payload(project: ProjectDocument): CadenceAnnotation {
  const candidate = buildHarmonyAnalysis(project).cadenceCandidates[0];
  expect(candidate.observedLandingTick).toBe(3840);
  return annotationFromCadenceCandidate(candidate, "accepted");
}

function withConfirmed(project: ProjectDocument) {
  const result = addCadenceAnnotation(project, payload(project));
  expect(result.error).toBeUndefined();
  return result.project;
}

function roundTrip(project: ProjectDocument) {
  const saved = normalizeProject(project);
  expect(validateProject(saved)).toBe(true);
  const reopened = migrateProject(JSON.parse(JSON.stringify(saved)));
  expect(reopened).toBeDefined();
  return reopened!;
}

function annotationView(project: ProjectDocument) {
  return createHarmonyRuleContext(buildHarmonyAnalysis(project)).cadences({ id: "accepted" }).toArray()[0];
}

describe("Confirmed detached cadence project persistence", () => {
  it("allows a stale confirmed cadence to be unlocked and deleted", () => {
    const locked = updateCadenceAnnotation(withConfirmed(blind()), "accepted", { locked: true }).project;
    const edited = roundTrip(addPhraseBoundary(locked, 3360).project);
    expect(edited.chordTrack.cadenceAnnotations[0]).toMatchObject({ locked: true, stale: true });
    const unlocked = updateCadenceAnnotation(edited, "accepted", { locked: false });
    expect(unlocked.error).toBeUndefined();
    expect(unlocked.project.chordTrack.cadenceAnnotations[0]).toMatchObject({ locked: false, stale: true });
    expect(deleteCadenceAnnotation(unlocked.project, "accepted").project.chordTrack.cadenceAnnotations).toEqual([]);
  });

  it("allows a manual reinterpretation over a continuous chord range", () => {
    const changed = updateCadenceAnnotation(withConfirmed(given()), "accepted", {
      fromTick: 1920, toTick: 2880, kind: "half", completion: undefined,
    });
    expect(changed.error).toBeUndefined();
    const annotation = roundTrip(changed.project).chordTrack.cadenceAnnotations[0];
    expect(annotation).toMatchObject({ source: "manual", kind: "half", stale: false });
    expect(annotation.observedLandingTick).toBeUndefined();
  });
  it.each([["unlabelled tonic", blind], ["given tonic", given]] as const)
    ("confirms, saves and reopens the %s with its real landing", (_label, create) => {
      const original = create(), hadLabel = create === given;
      const unlabelled = createHarmonyRuleContext(buildHarmonyAnalysis(original)).cadenceAt(3840);
      expect(unlabelled?.landingSpan?.firstSlice.tick).toBe(hadLabel ? 3840 : undefined);
      expect(unlabelled?.precedingSpan?.firstSlice.tick).toBe(1920);
      const confirmed = withConfirmed(original), reopened = roundTrip(confirmed);
      expect(reopened.chordTrack.cadenceAnnotations[0]).toMatchObject({
        source: "accepted-candidate", fromTick: 1920, observedLandingTick: 3840, toTick: 4800, stale: false,
      });
      const view = annotationView(reopened);
      expect(view.observedLandingTick).toBe(3840);
      expect(view.candidate?.observedLandingTick).toBe(3840);
      expect(view.landingSpan?.firstSlice.tick).toBe(hadLabel ? 3840 : undefined);
      expect(view.precedingSpan?.firstSlice.tick).toBe(1920);
      expect(view.spans.at(-1)?.firstSlice.tick).toBe(hadLabel ? 3840 : 1920);
      expect(view.candidate?.unharmonizedLandingTick).toBe(hadLabel ? undefined : 3840);
      expect(checkHarmony(reopened).diagnostics.filter(d => d.ruleId.startsWith("cadence."))).toEqual([]);
      expect(renderScoreText(reopened)).toMatch(/cadence .*observedLanding=2:1/);
      expect(buildMidi(reopened, true)).toEqual(buildMidi(original, true));
      expect(buildMusicXml(reopened)).toBe(buildMusicXml(original));
    });

  it("does not permit a manually requested gap, forged tick, or arbitrary non-contiguous acceptance", () => {
    const project = blind(), annotation = payload(project);
    expect(addCadenceAnnotation(project, { ...annotation, source: "manual" }).error).toBeDefined();
    expect(addCadenceAnnotation(project, { ...annotation, observedLandingTick: undefined }).error)
      .toMatch(/必须覆盖连续的和弦区域/);
    expect(addCadenceAnnotation(project, { ...annotation, observedLandingTick: 3841 }).error)
      .toMatch(/谱面已不支持/);
    project.chordTrack.cadenceAnnotations = [{ ...annotation, observedLandingTick: 3841 }];
    const reopened = roundTrip(project);
    expect(reopened.chordTrack.cadenceAnnotations[0].stale).toBe(true);
    const query = createHarmonyRuleContext(buildHarmonyAnalysis(reopened));
    expect(query.cadenceAt(3840)?.source).toBe("candidate");
  });

  it.each([blind, given])("rechecks changes to the actual third immediately and at reopen", (create) => {
    const accepted = withConfirmed(create());
    const alto = accepted.satbTracks[1], note = alto.notes.find(item => item.startTick === 3840)!;
    const change = updateNote(accepted, alto.id, note.id, { pitch: { ...note.pitch, alter: -1 } });
    expect(change.error).toBeUndefined();
    const edited = change.project;
    expect(annotationView(edited).annotation?.stale).toBe(true);
    expect(annotationView(edited).candidate).toBeUndefined();
    expect(annotationView(edited).landingSpan).toBeUndefined();
    expect(annotationView(edited).precedingSpan).toBeUndefined();
    expect(renderScoreText(edited)).toMatch(/cadence .*stale=true/);
    const reopened = roundTrip(edited);
    expect(reopened.chordTrack.cadenceAnnotations[0].stale).toBe(true);
    const restored = updateNote(reopened, alto.id, note.id, { pitch: note.pitch }).project;
    expect(annotationView(restored).annotation?.stale).toBe(false);
  });

  it("matches every field of the observed candidate and can edit metadata", () => {
    const project = given();
    const annotation = payload(project);
    for (const field of [{ phraseId: "other" }, { fromTick: 1921 }, { toTick: 4801 },
      { kind: "half" }, { form: "plagal" }, { completion: "imperfect" }] as const) {
      expect(addCadenceAnnotation(project, { ...annotation, ...field }).error).toMatch(/实际落点/);
    }
    const accepted = withConfirmed(project);
    expect(updateCadenceAnnotation(accepted, "accepted", { completion: "imperfect" }).error).toMatch(/实际落点/);
    const locked = updateCadenceAnnotation(accepted, "accepted", { locked: true });
    expect(locked.error).toBeUndefined();
    expect(roundTrip(locked.project).chordTrack.cadenceAnnotations[0]).toMatchObject({ locked: true, stale: false });
  });

  it("uses the existing unharmonized onset when a detector only sets that field", () => {
    const project = blind();
    const analysis = buildHarmonyAnalysis(project);
    const legacy = { ...analysis.cadenceCandidates[0], observedLandingTick: undefined };
    expect(annotationFromCadenceCandidate(legacy, "accepted").observedLandingTick).toBe(3840);
    const view = createHarmonyRuleContext({ ...analysis, cadenceCandidates: [legacy] }).cadenceAt(3840);
    expect(view?.observedLandingTick).toBe(3840);
    expect(view?.landingSpan).toBeUndefined();
    expect(view?.precedingSpan?.firstSlice.tick).toBe(1920);
  });

  it("rechecks a new phrase boundary and keeps irrelevant metadata edits current", () => {
    const accepted = withConfirmed(blind());
    const renamed = { ...accepted, title: "New project title" };
    expect(roundTrip(renamed).chordTrack.cadenceAnnotations[0].stale).toBe(false);
    const cut = addPhraseBoundary(renamed, 3360).project;
    expect(cut.chordTrack.cadenceAnnotations[0].stale).toBe(true);
    expect(annotationView(roundTrip(cut)).candidate).toBeUndefined();
  });

  it("switches the chord endpoint when the same proven landing gains or loses a chord label", () => {
    const confirmed = withConfirmed(blind());
    const tonic = given().chordTrack.regions.at(-1)!;
    const labelled = addChordRegion(confirmed, tonic);
    expect(labelled.error).toBeUndefined();
    const view = annotationView(roundTrip(labelled.project));
    expect(view.landingSpan?.firstSlice.tick).toBe(3840);
    expect(view.annotation?.stale).toBe(false);
    const removed = deleteChordRegions(labelled.project, new Set([tonic.id]));
    expect(removed.error).toBeUndefined();
    const reopened = annotationView(roundTrip(removed.project));
    expect(reopened.landingSpan).toBeUndefined();
    expect(reopened.candidate?.unharmonizedLandingTick).toBe(3840);
    expect(reopened.annotation?.stale).toBe(false);
  });

  it("accepts the explicit text interchange field only when the detached cadence can be replayed", () => {
    const source = fixture.replace("}", chordLine + "\n}") + `
annotations {
  phrase p range=[1:1,3:1)
  cadence q range=[1:3,2:2) phrase=p kind=full form=authentic completion=perfect observedLanding=2:1
}
`;
    const project = roundTrip(compileScoreText(source).project);
    expect(project.chordTrack.cadenceAnnotations[0]).toMatchObject({ observedLandingTick: 3840, stale: false });
    expect(() => compileScoreText(source.replace("observedLanding=2:1", "observedLanding=2:1+1")))
      .toThrow();
  });
});
