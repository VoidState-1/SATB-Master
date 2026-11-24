import { describe, expect, it, vi } from "vitest";
import { parseSpelledPitch, writtenInterval } from "../../../pitch";
import {
  createEmptyProject, getSatbTrack, PPQ, validateProject, VOICE_ORDER,
  type ChordRegion, type NoteEvent, type ProjectDocument, type VoiceId,
} from "../../../project";
import {
  applyProgressionCandidate, checkHarmony, findNextOpenSlot, searchProgressionCandidates,
  type ProgressionCandidate, type ProgressionShortLength,
} from "../../index";
import { buildVocabulary } from "../vocabulary";
import * as registry from "../../registry";

const beat = PPQ;
const tonic = ["E4", "C4", "G3", "C3"] as const;
const dominantSeventh = ["B4", "F4", "D4", "G2"] as const;
const cadential64 = ["E4", "C4", "G3", "G2"] as const;
const landing = ["C5", "E4", "G3", "C3"] as const;

const pitchOf = (name: string) => parseSpelledPitch(name.replace(/^([A-G])(\d)$/, "$1:0:$2"))!;

function fixture(bars = 8): ProjectDocument {
  const project = createEmptyProject();
  project.lengthTicks = bars * 4 * beat;
  return project;
}

function addNote(project: ProjectDocument, voice: VoiceId, at: number, pitch: string, duration = beat): NoteEvent {
  const track = getSatbTrack(project, voice);
  const note: NoteEvent = {
    id: `${voice}-${at}`, startTick: at, durationTicks: duration,
    pitch: pitchOf(pitch), velocity: 91, locked: false, spellingSource: "manual",
  };
  track.notes.push(note);
  return note;
}

function chordAt(project: ProjectDocument, label: "I" | "V7" | "K46", at: number, duration = beat): ChordRegion {
  const chord = buildVocabulary(project.keyEvents[0], "classic-basic").find(item => {
    if (label === "K46") return item.role === "cadential64";
    if (label === "V7") return item.degree === 5 && item.inversion === 0 && item.tones.length === 4;
    return item.degree === 1 && item.inversion === 0;
  })!;
  const region = { id: `${label}-${at}`, startTick: at, durationTicks: duration,
    identity: chord.identity, semantics: chord.semantics, locked: false };
  project.chordTrack.regions.push(region);
  return region;
}

function addSatb(project: ProjectDocument, at: number, voicing: readonly string[], duration = beat) {
  VOICE_ORDER.forEach((voice, index) => addNote(project, voice, at, voicing[index], duration));
}

function errors(project: ProjectDocument) {
  return checkHarmony(project).diagnostics.filter(item => item.severity === "error");
}

function expectValidPreview(candidate: ProgressionCandidate) {
  expect(candidate.diagnosticSummary.errorCount).toBe(0);
  expect(candidate.variants[0].steps).toEqual(candidate.steps);
  expect(validateProject(candidate.previewProject)).toBe(true);
  expect(errors(candidate.previewProject)).toEqual([]);
}

describe("progression search", () => {
  it.each([0, beat])("returns distinct, error-free single chords at tick %i", fromTick => {
    const project = fixture();
    if (fromTick) {
      addSatb(project, 0, tonic);
      chordAt(project, "I", 0);
    }
    const snapshot = structuredClone(project);
    const result = searchProgressionCandidates(project, { fromTick, mode: "single" });
    expect(result.slot).toMatchObject({ kind: "empty", fromTick, toTick: fromTick + beat, fixedVoices: {} });
    expect(result.candidates).toHaveLength(8);
    expect(new Set(result.candidates.map(item => item.headline)).size).toBe(8);
    if (!fromTick) expect(result.candidates[0].headline).toBe("I");
    else expect(result.slot?.leftAnchor?.chordLabel).toBe("I");
    for (const candidate of result.candidates) {
      expectValidPreview(candidate);
      expect(candidate.steps[0].generatedVoices).toEqual(VOICE_ORDER);
    }
    expect(project).toEqual(snapshot);
  });

  it("recognizes the last complete slice and its K46 obligation at a secondary accent", () => {
    const project = fixture();
    addSatb(project, 2 * beat, cadential64);
    chordAt(project, "K46", 2 * beat);
    const result = searchProgressionCandidates(project, { fromTick: 3 * beat, mode: "single" });
    expect(result.slot?.leftAnchor).toMatchObject({
      chordLabel: "K46", fromTick: 2 * beat, toTick: 3 * beat,
      obligations: { heldMetricLevel: 2, sopranoHeldTicks: beat, cadential64: true },
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(["V", "V7"]).toContain(candidate.headline);
      expectValidPreview(candidate);
    }
  });

  it.each([false, true])("resolves the written V7 seventh with an explicit chord: %s", explicit => {
    const project = fixture();
    addSatb(project, 0, dominantSeventh);
    if (explicit) chordAt(project, "V7", 0);
    const result = searchProgressionCandidates(project, { fromTick: beat, mode: "single" });
    expect(result.slot?.leftAnchor?.chordLabel).toBe("V7");
    expect(result.slot?.leftAnchor?.obligations).toMatchObject({ seventhVoices: ["alto"], leadingToneVoices: ["soprano"] });
    expect(result.slot?.leftAnchor?.voicing?.[1].tone).toBe(3);
    const best = result.candidates[0];
    expectValidPreview(best);
    expect(writtenInterval(pitchOf("F4"), best.steps[0].notes.alto)).toEqual({
      diatonicSteps: -1, semitones: -1,
    });
    expect(checkHarmony(best.previewProject).diagnostics.map(item => item.ruleId)).not.toContain("resolution.chord-seventh");
  });

  it.each([
    ["soprano", ["E4", "F4", "D4", "C4"]],
    ["bass", ["C3", "F3", "G2", "C3"]],
  ] as const)("fills four beats with %s fixed and advances after each application", (voice, melody) => {
    let project = fixture();
    const original = melody.map((pitch, i) => addNote(project, voice, i * beat, pitch));
    original[1].locked = true;
    let cursor = 0;
    for (const note of original) {
      const slot = findNextOpenSlot(project, cursor, beat / 2);
      expect(slot).toMatchObject({
        kind: "partial", fromTick: cursor, toTick: cursor + beat, fixedVoices: { [voice]: note.pitch },
      });
      const result = searchProgressionCandidates(project, { fromTick: cursor, mode: "single" });
      const candidate = result.candidates[0];
      expect(candidate?.steps[0].generatedVoices).not.toContain(voice);
      expect(candidate?.diagnosticSummary.errorCount).toBe(0);
      const applied = applyProgressionCandidate(project, candidate);
      expect(applied).toMatchObject({ nextCursorTick: cursor + beat, addedNoteCount: 3, addedChordCount: 1 });
      project = applied.project;
      cursor = applied.nextCursorTick;
      expect(getSatbTrack(project, voice).notes).toEqual(original);
      expect(validateProject(project)).toBe(true);
    }
    expect(findNextOpenSlot(project, 0)?.fromTick).toBe(4 * beat);
    expect(errors(project)).toEqual([]);
  });

  it.each([2, 3, 4] as const)("builds %i distinct, checked steps per short candidate", shortLength => {
    const project = fixture();
    addSatb(project, 0, tonic);
    chordAt(project, "I", 0);
    const fromTick = shortLength === 3 ? 2 * beat : beat;
    const { slot, candidates } = searchProgressionCandidates(project, { mode: "short", fromTick, shortLength });
    expect(slot?.spanEndTick).toBe(fromTick + shortLength * beat);
    expect(candidates.length).toBeGreaterThan(2);
    expect(new Set(candidates.map(item => item.headline)).size).toBe(candidates.length);
    expect(new Set(candidates.map(item => item.tag)).size).toBeGreaterThan(1);
    for (const candidate of candidates) {
      expect(candidate.steps).toHaveLength(shortLength);
      expect(candidate.tag).toBeTruthy();
      expectValidPreview(candidate);
      const applied = applyProgressionCandidate(project, candidate);
      expect(validateProject(applied.project)).toBe(true);
      expect(errors(applied.project)).toEqual([]);
    }
    expect(candidates.some(item => item.tag === "正格收束")).toBe(true);
    if (shortLength === 3) {
      expect(candidates.some(item => item.headline === "K46 → V7 → I" && item.tag === "正格收束")).toBe(true);
      expect(candidates.some(item => item.tag === "经过四六")).toBe(true);
    }
  });

  it("follows the source note changes through a sustained soprano and a later bass entrance", () => {
    const project = fixture();
    const soprano = addNote(project, "soprano", 0, "E4", 2 * beat);
    addNote(project, "soprano", 2 * beat, "F4", beat / 2);
    const bass = addNote(project, "bass", beat, "C3");
    const { candidates, slot } = searchProgressionCandidates(project, { mode: "short", fromTick: 0 });
    expect(slot?.spanEndTick).toBe(2.5 * beat);
    const best = candidates[0];
    expectValidPreview(best);
    expect(best.steps.map(step => [step.fromTick, step.toTick, step.generatedVoices.length])).toEqual([
      [0, beat, 3], [beat, 2 * beat, 2], [2 * beat, 2.5 * beat, 3],
    ]);
    const result = applyProgressionCandidate(project, best);
    expect(getSatbTrack(result.project, "soprano").notes[0]).toEqual(soprano);
    expect(getSatbTrack(result.project, "bass").notes.find(note => note.id === bass.id)).toEqual(bass);
  });

  it("bridges exactly to a right-hand voicing and verifies the right seam", () => {
    const project = fixture();
    addSatb(project, 0, tonic);
    chordAt(project, "I", 0);
    addSatb(project, 3 * beat, landing, 2 * beat);
    chordAt(project, "I", 3 * beat, 2 * beat);
    const result = searchProgressionCandidates(project, { fromTick: beat, mode: "short", shortLength: "bridge" });
    expect(result.slot).toMatchObject({
      fromTick: beat, toTick: 2 * beat, spanEndTick: 3 * beat,
      rightAnchor: { fromTick: 3 * beat, chordLabel: "I", distanceSteps: 2 },
    });
    expect(result.candidates.length).toBeGreaterThan(1);
    for (const item of result.candidates) {
      expect(item.tag).toBe("双向桥接");
      expect(item.steps).toHaveLength(2);
      expect(item.previewRange).toEqual({ fromTick: 0, toTick: 4 * beat });
      expectValidPreview(item);
      const applied = applyProgressionCandidate(project, item);
      expect(applied.nextCursorTick).toBe(3 * beat);
      expect(errors(applied.project)).toEqual([]);
      expect(checkHarmony(applied.project).diagnostics.filter(diagnostic =>
        /parallel.*(fifth|octave)/.test(diagnostic.ruleId))).toEqual([]);
    }
    const fixedLength = searchProgressionCandidates(project, { fromTick: beat, mode: "short", shortLength: 2 });
    expect(fixedLength.slot?.spanEndTick).toBe(3 * beat);
    expect(fixedLength.slot?.rightAnchor?.fromTick).toBe(3 * beat);
    expect(fixedLength.candidates.length).toBeGreaterThan(0);
    for (const candidate of fixedLength.candidates) {
      expect(errors(applyProgressionCandidate(project, candidate).project)).toEqual([]);
    }
  });

  it("uses the emergency tier for an out-of-range fixed voice with distinct identities", () => {
    const project = fixture();
    const soprano = addNote(project, "soprano", 0, "C3");
    const result = searchProgressionCandidates(project, { mode: "single", fromTick: 0, maxCandidates: 4 });
    expect(result.candidates).toHaveLength(4);
    expect(new Set(result.candidates.map(item => item.headline)).size).toBe(4);
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.relaxedLevel).toBe(2);
      expect(candidate.steps[0].notes.soprano).toEqual(soprano.pitch);
      expect(validateProject(applyProgressionCandidate(project, candidate).project)).toBe(true);
    }
  });

  it("switches between distinct checked arrangements for one chord", () => {
    const project = fixture();
    const result = searchProgressionCandidates(project, { mode: "single", fromTick: 0 });
    const candidate = result.candidates.find(item => item.variants.length >= 2)!;
    expect(candidate).toBeDefined();
    expect(candidate.variants.length).toBeLessThanOrEqual(3);
    const first = applyProgressionCandidate(project, candidate);
    const alternate = applyProgressionCandidate(project, candidate, { variantIndex: 1 });
    expect(candidate.variants[1].steps[0].notes).not.toEqual(candidate.steps[0].notes);
    for (const track of alternate.project.satbTracks) {
      expect(track.notes[0].pitch).toEqual(candidate.variants[1].steps[0].notes[track.id]);
    }
    expect(first.project.chordTrack.regions[0].identity).toEqual(alternate.project.chordTrack.regions[0].identity);
    expect(errors(alternate.project)).toEqual([]);
  });

  it("clips an unlocked chord on both sides, leaves locked regions intact, and supports notes-only writes", () => {
    const project = fixture();
    const original = chordAt(project, "I", 0, 3 * beat);
    const locked = chordAt(project, "V7", 3 * beat);
    locked.locked = true;
    const result = searchProgressionCandidates(project, { mode: "single", fromTick: beat });
    const candidate = result.candidates.find(item => item.headline !== "I")!;
    const applied = applyProgressionCandidate(project, candidate);
    expect(applied.project.chordTrack.regions).toMatchObject([
      { ...original, durationTicks: beat },
      { startTick: beat, durationTicks: beat, identity: candidate.steps[0].chord.identity },
      { startTick: 2 * beat, durationTicks: beat, identity: original.identity },
      locked,
    ]);
    expect(validateProject(applied.project)).toBe(true);
    const notesOnly = applyProgressionCandidate(project, candidate, { writeChords: false });
    expect(notesOnly.addedChordCount).toBe(0);
    expect(notesOnly.project.chordTrack).toEqual(project.chordTrack);
    const constrained = searchProgressionCandidates(project, { mode: "single", fromTick: 3 * beat });
    expect(constrained.candidates.map(item => item.headline)).toEqual(["V7"]);
    const accepted = applyProgressionCandidate(project, constrained.candidates[0]);
    expect(accepted.addedChordCount).toBe(0);
    expect(accepted.project.chordTrack.regions).toEqual(project.chordTrack.regions);
    expect(searchProgressionCandidates(project, {
      mode: "single", fromTick: 3 * beat, respectLockedChords: false,
    }).candidates.some(item => item.headline !== "V7")).toBe(true);
  });

  it("stops at a key boundary and keeps the original key of a clipped chord tail", () => {
    const project = fixture();
    const original = chordAt(project, "I", 0, 3 * beat);
    project.keyEvents.push({
      id: "new-key", tick: 2 * beat, tonic: { step: "G", alter: 0 }, mode: "major",
    });
    const result = searchProgressionCandidates(project, { mode: "single", fromTick: beat, stepTicks: 2 * beat });
    expect(result.slot?.toTick).toBe(2 * beat);
    const applied = applyProgressionCandidate(project, result.candidates[0]);
    expect(validateProject(applied.project)).toBe(true);
    expect(applied.project.chordTrack.regions.at(-1)).toMatchObject({
      startTick: 2 * beat, durationTicks: beat, identity: original.identity,
      semantics: { interpretations: [{ localKey: { tonic: { step: "C", alter: 0 }, mode: "major" } }] },
    });
  });

  it("rebases preview events while keeping the preceding beat and source metric phase", () => {
    const project = fixture();
    addSatb(project, 2 * beat, tonic); // Unrelated measure before the audible context.
    addSatb(project, 17 * beat, tonic);
    chordAt(project, "I", 17 * beat);
    addSatb(project, 18 * beat, cadential64);
    chordAt(project, "K46", 18 * beat);
    const best = searchProgressionCandidates(project, { mode: "single", fromTick: 19 * beat }).candidates[0];
    expect(best.fromTick).toBe(19 * beat);
    expect(best.previewRange).toEqual({ fromTick: 2 * beat, toTick: 4 * beat });
    expect(best.previewProject.lengthTicks).toBe(4 * beat);
    expect(best.previewProject.satbTracks[0].notes.map(note => note.startTick)).toEqual([beat, 2 * beat, 3 * beat]);
    expectValidPreview(best);
  });

  it("uses the target meter for a two-beat empty step and preserves the grid override", () => {
    const project = fixture();
    project.meterEvents.push({ id: "meter-6-8", tick: 4 * beat, numerator: 6, denominator: 8 });
    addSatb(project, 0, tonic, 4 * beat);
    const options = { mode: "single", fromTick: 0, stepBeats: 2 } as const;
    expect(searchProgressionCandidates(project, options).slot)
      .toMatchObject({ fromTick: 4 * beat, toTick: 5 * beat });
    expect(searchProgressionCandidates(project, { ...options, stepTicks: beat / 4 }).slot)
      .toMatchObject({ fromTick: 4 * beat, toTick: 4.25 * beat });
  });

  it("auditions each checked voicing with one preceding beat even when the anchor is sustained", () => {
    const project = fixture();
    addSatb(project, 0, tonic, 4 * beat);
    chordAt(project, "I", 0, 4 * beat);
    const { candidates } = searchProgressionCandidates(project, { mode: "single", fromTick: 4 * beat });
    const candidate = candidates.find(item => item.variants.length > 1)!;
    expect(candidate.previewRange).toEqual({ fromTick: 3 * beat, toTick: 5 * beat });
    const auditions = candidate.variants.map(variant => variant.previewProject.satbTracks.map(track => {
      const note = track.notes.find(item => item.startTick === 4 * beat)!;
      expect(note.pitch).toEqual(variant.steps[0].notes[track.id]);
      expect(track.notes[0].durationTicks).toBe(4 * beat);
      return note.pitch;
    }));
    expect(auditions[0]).not.toEqual(auditions[1]);
  });

  it("keeps locked voices, ranges and the chord track intact when accepting a candidate", () => {
    const project = fixture();
    const options = { fromTick: 0, mode: "single" } as const;
    const candidate = searchProgressionCandidates(project, options).candidates[0];
    getSatbTrack(project, "alto").locked = true;
    expect(searchProgressionCandidates(project, options).candidates).toEqual([]);
    expect(() => applyProgressionCandidate(project, candidate)).toThrow(/已锁定/);
    getSatbTrack(project, "alto").locked = false;
    project.exercise.editableRanges.push({ id: "tenor-locked", voiceIds: ["tenor"], editable: false, fromTick: 0, toTick: beat });
    expect(() => applyProgressionCandidate(project, candidate)).toThrow(/已锁定/);
    project.exercise.editableRanges = [];
    project.chordTrack.locked = true;
    const applied = applyProgressionCandidate(project, candidate);
    expect(applied.addedNoteCount).toBe(4);
    expect(applied.addedChordCount).toBe(0);
    expect(applied.project.chordTrack).toEqual(project.chordTrack);
  });

  it("rejects stale notes, changed fixed pitches and invalid variants atomically", () => {
    const project = fixture();
    addNote(project, "soprano", 0, "E4");
    const candidate = searchProgressionCandidates(project, { mode: "single", fromTick: 0 }).candidates[0];
    const snapshot = structuredClone(project);
    expect(() => applyProgressionCandidate(project, candidate, { variantIndex: -1 })).toThrow();
    expect(project).toEqual(snapshot);
    const stale = structuredClone(project);
    addNote(stale, "tenor", beat / 2, "A3", beat);
    const occupied = structuredClone(stale);
    expect(() => applyProgressionCandidate(stale, candidate)).toThrow(/槽位已有新音符/);
    expect(stale).toEqual(occupied);
    getSatbTrack(project, "soprano").notes[0].pitch = pitchOf("F4");
    expect(() => applyProgressionCandidate(project, candidate)).toThrow(/固定声部已变更/);
    expect(getSatbTrack(project, "tenor").notes).toEqual([]);
  });

  it("returns no slot for a full score or a cursor at the project end", () => {
    const project = fixture(1);
    addSatb(project, 0, tonic, 4 * beat);
    const options = { mode: "single" as const, fromTick: 0 };
    expect(searchProgressionCandidates(project, options)).toMatchObject({ slot: undefined, candidates: [] });
    expect(findNextOpenSlot(project, 2 * beat)).toBeUndefined();
    expect(searchProgressionCandidates(fixture(1), { ...options, fromTick: 4 * beat }))
      .toMatchObject({ slot: undefined, candidates: [] });
  });

  it("clips empty slots to the next SATB attack, honors the meter, and never extends the tail", () => {
    const project = fixture(1);
    project.meterEvents[0].denominator = 8;
    addNote(project, "alto", beat / 2 + 60, "C4");
    expect(findNextOpenSlot(project, -100)).toMatchObject({ fromTick: 0, toTick: beat / 2 });
    expect(findNextOpenSlot(project, beat / 2, beat)).toMatchObject({
      fromTick: beat / 2, toTick: beat / 2 + 60, kind: "empty",
    });
    expect(findNextOpenSlot(project, beat / 2 + 61, 60)).toMatchObject({
      toTick: 1.5 * beat + 60, kind: "partial", fixedVoices: { alto: pitchOf("C4") },
    });
    expect(findNextOpenSlot(project, 4 * beat - 1, beat)).toMatchObject({ toTick: 4 * beat });
  });

  it.each([["single", undefined], ["short", 3]] as const)(
    "searches a typical eight-bar project within the interactive budget (%s)",
    (mode, shortLength: ProgressionShortLength | undefined) => {
      const project = fixture();
      for (let bar = 0; bar < 5; bar++) {
        addSatb(project, 4 * bar * beat, tonic, 4 * beat);
        chordAt(project, "I", 4 * bar * beat, 4 * beat);
      }
      const options = { fromTick: 20 * beat, mode, shortLength };
      searchProgressionCandidates(project, options);
      const original = registry.checkHarmony;
      let checkMs = 0;
      const check = vi.spyOn(registry, "checkHarmony").mockImplementation((...args) => {
        const start = performance.now();
        try {
          return original(...args);
        } finally {
          checkMs += performance.now() - start;
        }
      });
      const checks: number[] = [];
      const calls: number[] = [];
      let times: number[];
      try {
        times = Array.from({ length: 5 }, () => {
          checkMs = 0;
          check.mockClear();
          const result = searchProgressionCandidates(project, options);
          expect(result.candidates.length).toBeGreaterThan(0);
          expect(check.mock.calls.every(([local]) => local.lengthTicks <= 3 * 4 * beat)).toBe(true);
          calls.push(check.mock.calls.length);
          checks.push(checkMs);
          return result.elapsedMs;
        }).sort((a, b) => a - b);
        expect(check).toHaveBeenCalled();
      } finally {
        check.mockRestore();
      }
      checks.sort((a, b) => a - b);
      console.info(`progression ${mode}: ${times[2].toFixed(2)} ms median, ${times[4].toFixed(2)} ms max, ` +
        `local checkHarmony ${checks[2].toFixed(2)} ms median, ${checks[4].toFixed(2)} ms max (${Math.max(...calls)} calls)`);
      // Keep generous parallel-load ceilings so full Vitest runs do not flake;
      // isolated median timings are ~21 ms (single) and ~37 ms (3-step short).
      expect(times[2]).toBeLessThan(500);
      expect(checks[2]).toBeLessThan(200);
    },
  );
});
