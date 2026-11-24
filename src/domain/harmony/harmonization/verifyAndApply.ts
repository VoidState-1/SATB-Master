import { spelledPitchEquals } from "../../pitch";
import { cadenceChordCoverage } from "../../project/cadenceCoverage";
import { createId } from "../../project/defaults";
import type { CadenceAnnotation, ChordRegion, NoteEvent, PhraseBoundary, ProjectDocument, VoiceId } from "../../project/types";
import { validateProject } from "../../project/validation";
import { VOICE_ORDER } from "../../project/voice";
import { detectCadences } from "../cadence";
import { annotationFromCadenceCandidate } from "../cadence/model";
import { cadenceInputs } from "../cadence/projectEvidence";
import { phraseInferenceFingerprint } from "../phrase";
import { checkHarmony } from "../registry";
import type { MelodyGrid } from "./melodyGrid";
import { isDeceptive } from "./transitionCost";
import type { HarmonizationPath } from "./solver";
import type { AutoHarmonizationApplyOptions, HarmonizationRange, HarmonizationSolution } from "./types";

type Timed = { id: string; startTick: number; durationTicks: number };
const endOf = (item: Timed) => item.startTick + item.durationTicks;
const intersects = (left: HarmonizationRange, right: HarmonizationRange) =>
  left.fromTick < right.toTick && right.fromTick < left.toTick;
const itemRange = (item: Timed) => ({ fromTick: item.startTick, toTick: endOf(item) });

export function clip<T extends Timed>(item: T, fromTick: number, toTick: number, id = item.id): T {
  return { ...item, id, startTick: fromTick, durationTicks: toTick - fromTick };
}

function withoutRange<T extends Timed>(item: T, range: HarmonizationRange): T[] {
  if (!intersects(itemRange(item), range)) return [item];
  const pieces: T[] = [];
  if (item.startTick < range.fromTick) pieces.push(clip(item, item.startTick, range.fromTick));
  if (endOf(item) > range.toTick) {
    pieces.push(clip(item, range.toTick, endOf(item), pieces.length ? `${item.id}-after-${range.toTick}` : item.id));
  }
  return pieces;
}

export function replaceRange<T extends Timed & { locked: boolean }>(
  original: readonly T[], additions: readonly T[], range: HarmonizationRange, respectLocks: boolean,
) {
  const anchors = respectLocks ? original.filter(item => item.locked && intersects(itemRange(item), range)) : [];
  const inserted = additions.flatMap(item => {
    if (!intersects(itemRange(item), range)) return [];
    let pieces = [clip(item, Math.max(item.startTick, range.fromTick), Math.min(endOf(item), range.toTick))];
    for (const anchor of anchors) pieces = pieces.flatMap(piece => withoutRange(piece, itemRange(anchor)));
    return pieces;
  });
  return [
    ...original.flatMap(item => respectLocks && item.locked ? [item] : withoutRange(item, range)),
    ...inserted,
  ].sort((a, b) => a.startTick - b.startTick);
}

function mergeBoundaries(
  project: ProjectDocument, additions: readonly PhraseBoundary[], range: HarmonizationRange, respectLocks: boolean,
) {
  const boundaries = new Map<number, PhraseBoundary>();
  const inside = (tick: number) => range.fromTick < tick && tick < range.toTick && tick < project.lengthTicks;
  for (const boundary of project.structure.phraseBoundaries) {
    if (!inside(boundary.tick) || boundary.source === "manual" || (respectLocks && boundary.locked)) {
      boundaries.set(boundary.tick, boundary);
    }
  }
  const fingerprint = phraseInferenceFingerprint(project);
  for (const boundary of additions) {
    if (!inside(boundary.tick) || boundaries.has(boundary.tick)) continue;
    boundaries.set(boundary.tick, boundary.source === "inferred"
      ? { ...boundary, inferenceFingerprint: fingerprint, stale: false }
      : boundary);
  }
  return [...boundaries.values()].sort((a, b) => a.tick - b.tick);
}

export function reconcileCadences(project: ProjectDocument, annotations: readonly CadenceAnnotation[]) {
  return annotations.map(annotation => {
    if (annotation.stale || annotation.observedLandingTick !== undefined ||
      cadenceChordCoverage(annotation, project.chordTrack.regions, project.structure.phraseBoundaries).aligned) {
      return annotation;
    }
    return { ...annotation, stale: true };
  }).sort((a, b) => a.fromTick - b.fromTick);
}

function setCadences(
  project: ProjectDocument, annotations: readonly CadenceAnnotation[], additions: readonly CadenceAnnotation[],
) {
  const retained = [...annotations];
  for (const annotation of additions) {
    if (!retained.some(item => intersects(item, annotation))) retained.push(annotation);
  }
  project.chordTrack.cadenceAnnotations = reconcileCadences(project, retained);
}

function addPath(
  project: ProjectDocument, grid: MelodyGrid, path: HarmonizationPath, id: string, respectLocks: boolean,
) {
  const notes = new Map<VoiceId, NoteEvent[]>(VOICE_ORDER.map(voice => [voice, []]));
  const ornaments = new Map<string, NoteEvent["nonChordToneRole"]>();
  const chords: ChordRegion[] = [];
  for (const [index, slice] of grid.slices.entries()) {
    const { chord, voicing, ornament } = path.choices[index];
    if (ornament && slice.melody.startTick === slice.tick &&
      slice.durationTicks === slice.melody.durationTicks) ornaments.set(slice.melody.id, ornament);
    for (const [voiceIndex, voice] of VOICE_ORDER.entries()) {
      if (voice === grid.givenVoice) continue;
      const pitches = notes.get(voice)!;
      const pitch = voicing.notes[voiceIndex].pitch;
      const prior = pitches.at(-1);
      if (prior && endOf(prior) === slice.tick && !slice.phraseStart && spelledPitchEquals(prior.pitch, pitch)) {
        prior.durationTicks += slice.durationTicks;
      } else {
        pitches.push({
          id: `${id}-${voice}-${slice.tick}`, startTick: slice.tick, durationTicks: slice.durationTicks,
          pitch, velocity: 78, locked: false, spellingSource: "manual",
        });
      }
    }
    if (chord.locked) continue;
    const prior = chords.at(-1);
    const priorChord = path.choices[index - 1]?.chord;
    if (prior && endOf(prior) === slice.tick && !slice.phraseStart &&
      priorChord?.signature === chord.signature && grid.slices[index - 1].key === slice.key) {
      prior.durationTicks += slice.durationTicks;
    } else {
      chords.push({
        id: `${id}-chord-${slice.tick}`, startTick: slice.tick, durationTicks: slice.durationTicks,
        identity: chord.identity, semantics: chord.semantics, locked: false,
      });
    }
  }

  const output: ProjectDocument = {
    ...project,
    satbTracks: project.satbTracks.map(track => ({
      ...track,
      notes: track.id === grid.givenVoice
        ? track.notes.map(note => ornaments.has(note.id) && !(respectLocks && note.locked)
          ? { ...note, nonChordToneRole: note.nonChordToneRole ?? ornaments.get(note.id) } : note)
        : replaceRange(track.notes, notes.get(track.id)!, grid.range, respectLocks),
    })),
    structure: { ...project.structure },
    chordTrack: { ...project.chordTrack, regions: replaceRange(project.chordTrack.regions, chords, grid.range, respectLocks) },
  };
  output.structure.phraseBoundaries = mergeBoundaries(output, grid.phraseBoundaries, grid.range, respectLocks);
  const retained = project.chordTrack.cadenceAnnotations.filter(annotation =>
    !intersects(annotation, grid.range) || (respectLocks && annotation.locked));
  output.chordTrack.cadenceAnnotations = retained;
  const candidates = detectCadences(cadenceInputs(output));
  const cadences = candidates.flatMap(candidate => {
    if (candidate.confidence === "ambiguous" ||
      candidate.fromTick < grid.range.fromTick || candidate.toTick > grid.range.toTick) return [];
    const annotation = annotationFromCadenceCandidate(candidate, `${id}-cadence-${candidate.fromTick}`);
    const observed = annotation.observedLandingTick;
    if (observed !== undefined && observed > annotation.fromTick && observed < annotation.toTick) return [annotation];
    delete annotation.observedLandingTick;
    return cadenceChordCoverage(annotation, output.chordTrack.regions, output.structure.phraseBoundaries).aligned
      ? [annotation] : [];
  });
  setCadences(output, retained, cadences);
  return output;
}

function describePath(grid: MelodyGrid, path: HarmonizationPath, project: ProjectDocument) {
  const highlights = new Map<string, string>();
  const add = (label: string, index: number, detail: string) => {
    if (!highlights.has(label)) highlights.set(label, `第${grid.slices[index].measureNumber}小节${detail}`);
  };
  for (const [index, { chord, ornament }] of path.choices.entries()) {
    if (chord.targetDegree === 5) add("重属推进", index, "以重属和弦引向属功能");
    else if (chord.targetDegree) add("副属离调", index, `以副属和弦短暂引向第${chord.targetDegree}级`);
    if (!chord.applied && chord.identity.structure.kind === "tertian" &&
      chord.identity.structure.quality === "diminished7") add("减七色彩", index, "使用导音减七和弦");
    if (index && grid.slices[index - 1].endTick === grid.slices[index].tick &&
      grid.slices[index - 1].key === grid.slices[index].key && isDeceptive(path.choices[index - 1].chord, chord))
      add("阻碍进行", index, "由属和弦转入六级");
    if (chord.inversion > 0 && chord.tones.length === 4 && !chord.applied)
      add("七和弦转位", index, chord.degree === 5 ? "使用属七和弦转位" : "使用七和弦转位");
    if (chord.role === "cadential64") add("终止四六", index, "用终止四六准备属和弦");
    if (chord.role === "passing64" || chord.role === "pedal64")
      add("四六延展", index, chord.role === "passing64" ? "用经过四六连接低音" : "在持续低音上使用辅助四六");
    if (ornament) add("弱拍装饰", index, ornament === "passing" ? "在原和弦上保留经过音" : "在原和弦上保留辅助音");
  }
  const labels = ["重属推进", "副属离调", "阻碍进行", "减七色彩", "七和弦转位", "弱拍装饰", "四六延展", "终止四六"];
  const present = labels.filter(label => highlights.has(label));
  if (present.length) return {
    label: present[0],
    description: present.slice(0, 2).map(label => highlights.get(label)).join("，") + "。",
  };
  return project.chordTrack.cadenceAnnotations.some(cadence => cadence.kind === "full" && cadence.form === "authentic")
    ? { label: "正格收束", description: "以属功能到主和弦的正格进行收束乐句。" }
    : { label: "平稳连接", description: "各声部以共同音和就近进行连接和弦。" };
}

export function verifyPath(
  source: ProjectDocument,
  grid: MelodyGrid,
  path: HarmonizationPath,
  respectLocks: boolean,
): HarmonizationSolution | undefined {
  const id = createId("harmonization");
  const project = addPath(source, grid, path, id, respectLocks);
  if (!validateProject(project)) return undefined;
  const { diagnostics } = checkHarmony(project);
  const diagnosticSummary = { errorCount: 0, warningCount: 0, suggestionCount: 0, diagnostics };
  for (const item of diagnostics) {
    if (item.severity === "error") diagnosticSummary.errorCount++;
    else if (item.severity === "warning") diagnosticSummary.warningCount++;
    else if (item.severity === "suggestion") diagnosticSummary.suggestionCount++;
  }
  const warnings: string[] = [];
  if (path.relaxedLevel === 1) warnings.push("已放宽部分配声限制，并保留给定旋律的原音高。");
  if (path.relaxedLevel === 2) warnings.push("已使用应急配和声，部分连接或固定音高需要复核。");
  if (diagnosticSummary.errorCount) warnings.push(`和声检查发现 ${diagnosticSummary.errorCount} 条错误。`);
  return {
    id, ...describePath(grid, path, project), score: path.score, relaxedLevel: path.relaxedLevel, project, diagnosticSummary,
    givenVoice: grid.givenVoice, range: grid.range,
    chords: project.chordTrack.regions,
    phraseBoundaries: project.structure.phraseBoundaries,
    cadences: project.chordTrack.cadenceAnnotations,
    warnings,
  };
}

export function applyAutoHarmonization(
  project: ProjectDocument,
  solution: HarmonizationSolution,
  options: AutoHarmonizationApplyOptions = {},
): ProjectDocument {
  const respectLocks = options.respectLockedConstraints ?? true;
  const writeChords = options.writeChords ?? true;
  const writeStructure = options.writePhrasesAndCadences ?? true;
  const range = { ...solution.range, toTick: Math.min(project.lengthTicks, solution.range.toTick) };
  if (range.toTick <= range.fromTick) return project;
  const output: ProjectDocument = {
    ...project,
    updatedAt: new Date().toISOString(),
    satbTracks: project.satbTracks.map(track => {
      const incoming = solution.project.satbTracks.find(item => item.id === track.id)?.notes ?? [];
      if (track.id !== solution.givenVoice) {
        return { ...track, notes: replaceRange(track.notes, incoming, range, respectLocks) };
      }
      const roles = new Map(incoming.filter(note => note.nonChordToneRole).map(note => [note.id, note]));
      return { ...track, notes: track.notes.map(note => {
        const match = roles.get(note.id);
        if (!match || !intersects(itemRange(note), range) || (respectLocks && note.locked) ||
          note.startTick !== match.startTick || note.durationTicks !== match.durationTicks ||
          !spelledPitchEquals(note.pitch, match.pitch)) return note;
        return { ...note, nonChordToneRole: note.nonChordToneRole ?? match.nonChordToneRole };
      }) };
    }),
    structure: { ...project.structure },
    chordTrack: {
      ...project.chordTrack,
      regions: writeChords ? replaceRange(project.chordTrack.regions, solution.chords, range, respectLocks) : project.chordTrack.regions,
    },
  };
  if (writeStructure) {
    output.structure.phraseBoundaries = mergeBoundaries(output, solution.phraseBoundaries, range, respectLocks);
    const retained = project.chordTrack.cadenceAnnotations.filter(annotation =>
      !intersects(annotation, range) || (respectLocks && annotation.locked));
    const additions = solution.cadences.filter(annotation =>
      annotation.fromTick >= range.fromTick && annotation.toTick <= range.toTick &&
      (annotation.observedLandingTick !== undefined
        ? writeChords
        : cadenceChordCoverage(annotation, output.chordTrack.regions, output.structure.phraseBoundaries).aligned));
    setCadences(output, retained, additions);
  } else if (writeChords) {
    output.chordTrack.cadenceAnnotations = reconcileCadences(output, project.chordTrack.cadenceAnnotations);
  }
  return structuredClone(output);
}
