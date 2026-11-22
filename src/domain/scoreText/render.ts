import { chordDraftFromIdentity } from "../chordModel";
import { formatChordIdentity } from "../chords";
import { analyzePhrases } from "../harmony/phrase";
import { detectProjectCadences } from "../harmony/cadence/projectEvidence";
import { reviewObservedCadenceAnnotation } from "../harmony/cadence/model";
import { validateProject, type ProjectDocument } from "../project";
import { buildMeasures, eventAtTick, type MeasureInfo } from "../time";
import { SCORE_VOICES, fail, type ScoreReference, type ScoreVoice } from "./types";
import { durationText, pitchText, positionText } from "./values";

export interface RenderScoreOptions {
  fromBar?: number;
  toBar?: number;
  barsPerBlock?: number;
  maxColumns?: number;
  includeIds?: boolean;
  reference?: ScoreReference;
}

const intersects = (start: number, end: number, from: number, to: number) => start < to && from < end;
const ascii = (text: string) => text.replaceAll("♭", "b").replaceAll("♯", "#").replaceAll("°", "o").replaceAll("−", "-");

function annotationLines(project: ProjectDocument, measures: MeasureInfo[], from: number, to: number, includeIds: boolean) {
  const lines: string[] = [];
  const range = (start: number, end: number) => `[${positionText(start, measures)},${positionText(end, measures)})`;
  project.chordTrack.regions.forEach((chord, index) => {
    if (!intersects(chord.startTick, chord.startTick + chord.durationTicks, from, to)) return;
    const name = formatChordIdentity(chord.identity, chord.semantics);
    const semantics = chord.semantics;
    const interpretation = semantics?.interpretations.find((item) => item.id === semantics.primaryInterpretationId);
    const key = interpretation?.localKey;
    lines.push(`chord c${index + 1} range=${range(chord.startTick, chord.startTick + chord.durationTicks)} symbol=${ascii(name.roman)} absolute=${ascii(name.absolute)}${semantics?.cadenceRole ? ` role=${semantics.cadenceRole}` : ""}${key ? ` localKey="${pitchText(key.tonic)} ${key.mode}"` : ""}${interpretation ? ` confidence=${interpretation.confidence} source=${interpretation.source}` : ""}${chord.locked ? " locked=true" : ""}${includeIds ? ` id=${chord.id}` : ""}`);
    // Rare multi-interpretation/altered cases retain their actual semantic data.
    if (semantics && (semantics.interpretations.length > 1 || semantics.alternatives?.length || semantics.mixture || semantics.pedalContext ||
      (chord.identity.structure.kind === "tertian" && chord.identity.structure.alterations.length)))
      lines.push(`  draft=${JSON.stringify(chordDraftFromIdentity(chord.identity, semantics))}`);
  });
  for (const [short, voice] of Object.entries(SCORE_VOICES)) {
    const track = project.satbTracks.find((item) => item.voice === voice)!;
    if (track.locked) lines.push(`voice ${short} locked=true`);
    for (const note of track.notes) {
      if (!intersects(note.startTick, note.startTick + note.durationTicks, from, to)) continue;
      if (note.nonChordToneRole || note.locked || includeIds)
        lines.push(`note ${short}@${positionText(note.startTick, measures)} pitch=${pitchText(note.pitch)} end=${positionText(note.startTick + note.durationTicks, measures)}${note.nonChordToneRole ? ` role=${note.nonChordToneRole}` : ""}${note.locked ? " locked=true" : ""}${includeIds ? ` id=${note.id}` : ""}`);
    }
  }
  for (const boundary of project.structure.phraseBoundaries) {
    if (from <= boundary.tick && boundary.tick <= to)
      lines.push(`boundary at=${positionText(boundary.tick, measures)} source=${boundary.source} confidence=${boundary.confidence}${boundary.stale ? " stale=true" : ""}`);
  }
  const phrases = analyzePhrases(project, { generateCandidates: false }).segments;
  const candidates = project.chordTrack.cadenceAnnotations.some(item => item.observedLandingTick !== undefined)
    ? detectProjectCadences(project) : [];
  for (const saved of project.chordTrack.cadenceAnnotations) {
    const cadence = reviewObservedCadenceAnnotation(saved, candidates);
    if (!intersects(cadence.fromTick, cadence.toTick, from, to)) continue;
    const phrase = phrases.find((item) => item.id === cadence.phraseId);
    lines.push(`cadence range=${range(cadence.fromTick, cadence.toTick)} phrase=${phrase ? range(phrase.fromTick, phrase.toTick) : "unresolved"} kind=${cadence.kind}${cadence.form ? ` form=${cadence.form}` : ""}${cadence.completion ? ` completion=${cadence.completion}` : ""} source=${cadence.source} confidence=${cadence.confidence}${cadence.observedLandingTick !== undefined ? ` observedLanding=${positionText(cadence.observedLandingTick, measures)}` : ""}${cadence.stale ? " stale=true" : ""}${cadence.locked ? " locked=true" : ""}${includeIds ? ` id=${cadence.id}` : ""}`);
  }
  for (const track of project.auxiliaryTracks)
    lines.push(`auxiliary ${JSON.stringify(track.name)} notes=${track.notes.length} (not shown in SATB grid)`);
  return lines;
}

export function renderScoreText(project: ProjectDocument, options: RenderScoreOptions = {}): string {
  if (!validateProject(project)) fail("无法渲染无效的 SATB 工程");
  const measures = buildMeasures(project);
  const fromBar = options.fromBar ?? 1;
  const toBar = options.toBar ?? measures.length;
  const barsPerBlock = options.barsPerBlock ?? 4;
  const maxColumns = options.maxColumns ?? 16;
  if (![fromBar, toBar, barsPerBlock, maxColumns].every(Number.isSafeInteger) || fromBar < 1 || toBar > measures.length || toBar < fromBar || barsPerBlock < 1 || maxColumns < 1 || maxColumns > 128)
    fail("文本渲染的小节范围、分块大小或列数无效");
  const from = measures[fromBar - 1].startTick;
  const to = measures[toBar - 1].endTick;
  const lines = [`SATB text v1 | ${project.title}`, "pitch/duration = attack; ~pitch = held note; r = silence; /tN = exact ticks", `view bars ${fromBar}..${toBar} | PPQ=${project.ppq}`];
  for (const [kind, events] of [["key", project.keyEvents], ["meter", project.meterEvents], ["tempo", project.tempoEvents]] as const) {
    const active = eventAtTick(events as readonly { tick: number }[], from);
    for (const event of events) {
      if (event !== active && (event.tick < from || event.tick >= to)) continue;
      const value = "tonic" in event ? `${pitchText(event.tonic)} ${event.mode}` : "numerator" in event ? `${event.numerator}/${event.denominator}` : `${event.bpm}`;
      lines.push(`${kind} @${positionText(event.tick, measures)} ${value}`);
    }
  }
  for (let firstBar = fromBar; firstBar <= toBar; firstBar += barsPerBlock) {
    const lastBar = Math.min(toBar, firstBar + barsPerBlock - 1);
    const startTick = measures[firstBar - 1].startTick;
    const endTick = measures[lastBar - 1].endTick;
    const ticks = new Set<number>();
    for (const measure of measures.slice(firstBar - 1, lastBar)) {
      ticks.add(measure.startTick);
      measure.beatTicks.forEach((tick) => ticks.add(tick));
    }
    for (const track of project.satbTracks) for (const note of track.notes) {
      for (const tick of [note.startTick, note.startTick + note.durationTicks]) if (startTick <= tick && tick < endTick) ticks.add(tick);
    }
    for (const chord of project.chordTrack.regions)
      for (const tick of [chord.startTick, chord.startTick + chord.durationTicks]) if (startTick <= tick && tick < endTick) ticks.add(tick);
    const columns = [...ticks].sort((a, b) => a - b);
    lines.push("", `bars ${firstBar}..${lastBar}`);
    for (let offset = 0; offset < columns.length; offset += maxColumns) {
      const page = columns.slice(offset, offset + maxColumns);
      const rows: [string, string[]][] = [["pos", page.map((tick) => positionText(tick, measures))]];
      for (const [short, voice] of Object.entries(SCORE_VOICES) as [ScoreVoice, typeof SCORE_VOICES[ScoreVoice]][]) {
        const notes = project.satbTracks.find((track) => track.voice === voice)!.notes;
        rows.push([short, page.map((tick) => {
          const note = notes.find((item) => item.startTick <= tick && tick < item.startTick + item.durationTicks);
          return !note ? "r" : note.startTick === tick ? `${pitchText(note.pitch)}/${durationText(note.durationTicks)}` : `~${pitchText(note.pitch)}`;
        })]);
      }
      rows.push(["H", page.map((tick) => {
        const chord = project.chordTrack.regions.find((item) => item.startTick <= tick && tick < item.startTick + item.durationTicks);
        return !chord ? "?" : `${chord.startTick === tick ? "" : "~"}${ascii(formatChordIdentity(chord.identity, chord.semantics).roman)}`;
      })]);
      const widths = page.map((_, index) => Math.max(...rows.map(([, cells]) => cells[index].length)));
      for (const [name, cells] of rows) lines.push(`${name.padEnd(3)} | ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`);
      lines.push(`end @${positionText(columns[offset + page.length] ?? endTick, measures)}`);
    }
  }
  lines.push("", "ANNOTATIONS (input)", ...annotationLines(project, measures, from, to, options.includeIds ?? false));
  if (options.reference !== undefined) {
    const reference = options.reference;
    if (!reference || reference.format !== "satb-score-reference" || reference.formatVersion !== 1 || reference.projectId !== project.id || reference.ppq !== project.ppq || reference.lengthTicks !== project.lengthTicks ||
      ![reference.complete, reference.chords, reference.notes, reference.phrases, reference.cadences].every(Array.isArray))
      fail("参考标注格式或时间范围与工程不一致");
    lines.push("", "REFERENCE (not input)", `complete=${reference.complete.join(",") || "unspecified"}`);
    const range = (a: number, b: number) => `[${positionText(a, measures)},${positionText(b, measures)})`;
    reference.chords.filter((chord) => intersects(chord.startTick, chord.startTick + chord.durationTicks, from, to)).forEach((chord) => {
      lines.push(`chord range=${range(chord.startTick, chord.startTick + chord.durationTicks)} symbol=${ascii(formatChordIdentity(chord.identity, chord.semantics).roman)}${chord.semantics?.cadenceRole ? ` role=${chord.semantics.cadenceRole}` : ""}`);
    });
    reference.notes.filter((note) => from <= note.startTick && note.startTick < to).forEach((note) => lines.push(`note ${note.voice}@${positionText(note.startTick, measures)}${note.role ? ` role=${note.role}` : ""}`));
    reference.phrases.filter((phrase) => intersects(phrase.fromTick, phrase.toTick, from, to)).forEach((phrase) => lines.push(`phrase ${phrase.name} range=${range(phrase.fromTick, phrase.toTick)}`));
    reference.cadences.filter((cadence) => intersects(cadence.fromTick, cadence.toTick, from, to)).forEach((cadence) => lines.push(`cadence range=${range(cadence.fromTick, cadence.toTick)} kind=${cadence.kind}${cadence.form ? ` form=${cadence.form}` : ""}${cadence.completion ? ` completion=${cadence.completion}` : ""}`));
  }
  return lines.join("\n") + "\n";
}
