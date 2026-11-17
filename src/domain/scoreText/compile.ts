import { spelledPitchEquals } from "../pitch";
import { createEmptyProject, getSatbTrack, validateProject, type NoteEvent, type ProjectDocument } from "../project";
import { buildMeasures, type MeasureInfo } from "../time";
import { parseScoreText } from "./parse";
import { resolveAnnotations } from "./annotations";
import { SCORE_VOICES, fail, type CompiledScore, type ScoreAnnotation, type ScoreBlock, type ScoreSpec, type ScoreVoice, type SourceLocation } from "./types";
import { durationTicks, positionText, positionTick, readKey, readMeter, readPitch } from "./values";

function createTimeline(spec: ScoreSpec): ProjectDocument {
  if (spec.version !== 1) fail("只支持 satb 1");
  if (!Array.isArray(spec.blocks) || !spec.blocks.length) fail("至少需要一个 bars 块");
  let expectedStart = 1;
  for (const block of spec.blocks) {
    if (!Number.isSafeInteger(block.from) || !Number.isSafeInteger(block.to) || block.from !== expectedStart || block.to < block.from || block.to > 10000)
      fail(`小节块必须从 ${expectedStart} 开始连续排列，范围最多为 1..10000`, block.location);
    expectedStart = block.to + 1;
    for (const voice of Object.keys(SCORE_VOICES) as ScoreVoice[]) {
      if (typeof block.voices?.[voice] !== "string") fail(`小节块缺少 ${voice} 声部；有意留空请写 ${voice}: empty`, block.location);
    }
    if (Object.keys(block.voices).some((voice) => !Object.hasOwn(SCORE_VOICES, voice))) fail("只支持 S、A、T、B 四个声部", block.location);
  }
  const project = createEmptyProject(spec.title ?? "脚本练习");
  const initialMeter = readMeter(spec.meter ?? "4/4");
  project.meterEvents = [{ id: "meter-1", tick: 0, ...initialMeter }];
  project.keyEvents = [{ id: "key-1", tick: 0, ...readKey(spec.key ?? "C major") }];
  project.tempoEvents = [{ id: "tempo-1", tick: 0, bpm: spec.tempo ?? 80 }];
  const meterChanges = new Map<number, ReturnType<typeof readMeter>>();
  for (const event of spec.events ?? []) {
    const kinds = [event.key, event.meter, event.tempo].filter((value) => value !== undefined);
    if (kinds.length !== 1) fail("每个 at 声明必须恰好修改一种时间事件", event.location);
    if (event.meter !== undefined) {
      const position = /^(\d+):1$/.exec(event.at);
      const number = Number(position?.[1]);
      if (!position || number < 2 || number >= expectedStart || meterChanges.has(number)) fail("变拍号必须位于工程内部且不重复的小节起点；起始拍号请用 meter", event.location);
      meterChanges.set(number, readMeter(event.meter, event.location));
    }
  }
  let tick = 0;
  let meter = initialMeter;
  for (let number = 1; number < expectedStart; number++) {
    const change = meterChanges.get(number);
    if (change) {
      meter = change;
      project.meterEvents.push({ id: `meter-${number}`, tick, ...meter });
    }
    tick += project.ppq * 4 / meter.denominator * meter.numerator;
  }
  project.lengthTicks = tick;
  project.loop.endTick = Math.min(project.loop.endTick, tick);
  const measures = buildMeasures(project);
  for (const event of spec.events ?? []) {
    const at = positionTick(event.at, measures, event.location);
    if (at >= tick) fail("时间事件必须位于工程内部", event.location);
    if (event.key !== undefined) {
      if (project.keyEvents.some((item) => item.tick === at)) fail("同一位置不能重复设置调号", event.location);
      project.keyEvents.push({ id: `key-${at}`, tick: at, ...readKey(event.key, event.location) });
    }
    if (event.tempo !== undefined) {
      if (project.tempoEvents.some((item) => item.tick === at)) fail("同一位置不能重复设置速度", event.location);
      project.tempoEvents.push({ id: `tempo-${at}`, tick: at, bpm: event.tempo });
    }
  }
  if (project.tempoEvents.some((event) => !Number.isFinite(event.bpm) || event.bpm < 1 || event.bpm > 1000)) fail("速度必须为 1–1000 BPM");
  project.keyEvents.sort((a, b) => a.tick - b.tick);
  project.tempoEvents.sort((a, b) => a.tick - b.tick);
  return project;
}

function tokenLocation(text: string, index: number, start: SourceLocation, measure: number, voice: ScoreVoice | "H"): SourceLocation {
  const prefix = text.slice(0, index);
  const newline = prefix.lastIndexOf("\n");
  return {
    line: start.line + (prefix.match(/\n/g)?.length ?? 0),
    column: newline < 0 ? start.column + index : index - newline,
    measure, voice,
  };
}

function parseVoice(
  project: ProjectDocument, block: ScoreBlock, voice: ScoreVoice | "H", measures: MeasureInfo[],
  aliases: Record<string, string>, sourceMap: Record<string, SourceLocation>,
  ties: Partial<Record<ScoreVoice, NoteEvent>>, harmony: ScoreAnnotation[],
) {
  const text = voice === "H" ? block.harmony! : block.voices[voice];
  if (text.trim() === "empty") {
    if (voice !== "H" && ties[voice]) fail("延音不能接入空声部", block.voiceLocations?.[voice]);
    return;
  }
  if (!text.trim().startsWith("|") || !text.trim().endsWith("|")) fail(`${voice} 声部必须以 | 开始并以 | 结束`, block.voiceLocations?.[voice] ?? block.location);
  let number = block.from;
  let cursor = measures[number - 1].startTick;
  let opened = false;
  for (const match of text.matchAll(/\||[^\s|]+/g)) {
    const token = match[0];
    const location = tokenLocation(text, match.index, block.voiceLocations?.[voice] ?? block.location ?? { line: 1, column: 1 }, number, voice);
    if (token === "|") {
      if (!opened) { opened = true; continue; }
      if (number > block.to) fail("声部包含超出块范围的小节", location);
      const measure = measures[number - 1];
      if (number > block.to || cursor !== measure.endTick) fail(`小节时值不完整：应为 ${measure.endTick - measure.startTick} tick，实际 ${cursor - measure.startTick} tick`, location);
      number++;
      if (number <= block.to) cursor = measures[number - 1].startTick;
      continue;
    }
    if (number > block.to) fail("声部包含超出块范围的小节", location);
    const parsed = /^(.+?)\/(t\d+|\d+\.{0,3}(?:\*\d+\/\d+)?)(?:@([A-Za-z_][\w.-]*))?(~)?$/.exec(token);
    if (!parsed) fail(`无效事件 ${token}；使用 E#4/4、r/8、C4/2~ 等`, location);
    const [, value, duration, alias, tied] = parsed;
    const ticks = durationTicks(duration, location);
    const measure = measures[number - 1];
    if (cursor + ticks > measure.endTick) fail("事件超出当前小节；跨小节延音请用 ~ 连接", location);
    if (voice === "H") {
      if (tied) fail("H 行不支持延音；连续和弦范围可在 annotations 中声明", location);
      if (value === "r" && alias) fail("空白和弦不能带别名", location);
      if (value !== "r") harmony.push({ kind: "chord", name: alias ?? `H-${number}-${cursor}`, fields: { at: positionText(cursor, measures), duration, symbol: value }, location });
    } else if (value === "r") {
      if (tied || alias || ties[voice]) fail("休止不能带别名或参与延音", location);
    } else {
      const pitch = readPitch(value, location);
      let note = ties[voice];
      if (note) {
        if (!spelledPitchEquals(note.pitch, pitch) || note.startTick + note.durationTicks !== cursor) fail("延音两端必须连续且书写音高相同", location);
        note.durationTicks += ticks;
      } else {
        note = { id: `note-${voice}-${cursor}`, startTick: cursor, durationTicks: ticks, pitch, velocity: 88, locked: false, spellingSource: "manual" };
        // A newly owned document is built in one batch; final project validation
        // checks the same persistence invariants without quadratic cloning.
        getSatbTrack(project, SCORE_VOICES[voice]).notes.push(note);
        sourceMap[note.id] = location;
        aliases[`${voice}@${positionText(cursor, measures)}`] = note.id;
      }
      if (alias) {
        if (Object.hasOwn(aliases, alias)) fail(`重复音符别名 ${alias}`, location);
        aliases[alias] = note.id;
      }
      ties[voice] = tied ? note : undefined;
    }
    cursor += ticks;
  }
  if (number !== block.to + 1) fail(`声部应包含 ${block.to - block.from + 1} 个小节`, block.voiceLocations?.[voice] ?? block.location);
}

export function compileScore(spec: ScoreSpec): CompiledScore {
  let project = createTimeline(spec);
  const measures = buildMeasures(project);
  const aliases: Record<string, string> = Object.create(null);
  const sourceMap: Record<string, SourceLocation> = Object.create(null);
  const ties: Partial<Record<ScoreVoice, NoteEvent>> = {};
  const harmony: ScoreAnnotation[] = [];
  for (const block of spec.blocks) {
    for (const voice of Object.keys(SCORE_VOICES) as ScoreVoice[])
      parseVoice(project, block, voice, measures, aliases, sourceMap, ties, harmony);
    if (block.harmony !== undefined) parseVoice(project, block, "H", measures, aliases, sourceMap, ties, harmony);
  }
  for (const voice of Object.keys(SCORE_VOICES) as ScoreVoice[]) {
    if (ties[voice]) fail(`${voice} 声部结尾存在未闭合延音`, sourceMap[ties[voice]!.id]);
  }
  const given = resolveAnnotations(project, [...harmony, ...(spec.annotations ?? [])], aliases);
  project = given.project;
  for (const annotation of [...harmony, ...(spec.annotations ?? [])]) {
    const id = aliases[annotation.name];
    if (id && annotation.location && !sourceMap[id]) sourceMap[id] = annotation.location;
  }
  if (!validateProject(project)) fail("编译后的工程未通过结构校验，请检查音符、和弦或时间参数");
  const reference = resolveAnnotations(project, spec.reference ?? [], Object.assign(Object.create(null), aliases), { reference: true, phrases: given.annotations.phrases }).annotations;
  const complete = spec.referenceComplete ?? [];
  if (new Set(complete).size !== complete.length || complete.some((kind) => !["chord", "note", "phrase", "cadence"].includes(kind))) fail("referenceComplete 包含未知或重复类型");
  return {
    project, annotations: given.annotations, aliases, sourceMap,
    reference: { format: "satb-score-reference", formatVersion: 1, projectId: project.id, ppq: project.ppq, lengthTicks: project.lengthTicks, complete: [...complete], metadata: { ...spec.metadata }, ...reference },
  };
}

export function compileScoreText(source: string) {
  return compileScore(parseScoreText(source));
}

/** Replaces only the declared music block, preserving unrelated project state. */
export function replaceScoreBlock(input: ProjectDocument, block: ScoreBlock): Pick<CompiledScore, "project" | "aliases" | "sourceMap"> {
  if (!validateProject(input)) fail("原工程无效");
  const project = structuredClone(input);
  const measures = buildMeasures(project);
  if (!Number.isSafeInteger(block.from) || !Number.isSafeInteger(block.to) || block.from < 1 || block.to < block.from || block.to > measures.length) fail("替换小节范围无效", block.location);
  const from = measures[block.from - 1].startTick;
  const to = measures[block.to - 1].endTick;
  const overlaps = (start: number, end: number) => start < to && from < end;
  for (const [short, voice] of Object.entries(SCORE_VOICES) as [ScoreVoice, typeof SCORE_VOICES[ScoreVoice]][]) {
    if (typeof block.voices[short] !== "string") fail(`替换块缺少 ${short}`, block.location);
    const track = getSatbTrack(project, voice);
    if (track.locked || project.exercise.editableRanges.some((range) => !range.editable && range.voiceIds.includes(voice) && overlaps(range.fromTick, range.toTick))) fail(`${short} 声部或替换范围已锁定`, block.location);
    for (const note of track.notes.filter((item) => overlaps(item.startTick, item.startTick + item.durationTicks))) {
      if (note.locked) fail(`替换范围包含锁定音符 ${note.id}`, block.location);
      if (note.startTick < from || note.startTick + note.durationTicks > to) fail("音符跨越替换块边界，请扩大替换范围以包含完整延音", block.location);
    }
    track.notes = track.notes.filter((note) => !overlaps(note.startTick, note.startTick + note.durationTicks));
  }
  if (block.harmony !== undefined) {
    if (project.chordTrack.locked) fail("和弦轨已锁定", block.location);
    for (const chord of project.chordTrack.regions.filter((item) => overlaps(item.startTick, item.startTick + item.durationTicks))) {
      if (chord.locked || chord.startTick < from || chord.startTick + chord.durationTicks > to) fail("锁定和弦或跨块和弦不能被替换", block.location);
    }
    project.chordTrack.regions = project.chordTrack.regions.filter((chord) => !overlaps(chord.startTick, chord.startTick + chord.durationTicks));
    project.chordTrack.cadenceAnnotations = project.chordTrack.cadenceAnnotations.map((cadence) => overlaps(cadence.fromTick, cadence.toTick) ? { ...cadence, stale: true } : cadence);
  }
  const aliases: Record<string, string> = Object.create(null);
  const sourceMap: Record<string, SourceLocation> = Object.create(null);
  const ties: Partial<Record<ScoreVoice, NoteEvent>> = {};
  const harmony: ScoreAnnotation[] = [];
  for (const short of Object.keys(SCORE_VOICES) as ScoreVoice[]) parseVoice(project, block, short, measures, aliases, sourceMap, ties, harmony);
  if (Object.values(ties).some(Boolean)) fail("替换块末尾的延音未结束，请扩大范围", block.location);
  for (const track of project.satbTracks) track.notes.sort((a, b) => a.startTick - b.startTick);
  if (block.harmony !== undefined) parseVoice(project, block, "H", measures, aliases, sourceMap, ties, harmony);
  const resolved = resolveAnnotations(project, harmony, aliases).project;
  resolved.updatedAt = new Date().toISOString();
  if (!validateProject(resolved)) fail("替换后的工程未通过结构校验", block.location);
  return { project: resolved, aliases, sourceMap };
}
