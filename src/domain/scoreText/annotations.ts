import { chordDraftFromIdentity, resolveChordIdentity, semanticsFromChordDraft } from "../chordModel";
import { addCadenceAnnotation, addChordRegion, addPhraseBoundary, updateNote } from "../editing";
import { analyzePhrases } from "../harmony/phrase";
import { cloneProject, validateProject, type CadenceAnnotation, type NonChordToneRole, type ProjectDocument } from "../project";
import { buildMeasures, keyAtTick, type MeasureInfo } from "../time";
import { chordDraft } from "./chords";
import { SCORE_VOICES, fail, type ScoreAnnotation, type ScoreAnnotationSet, type ScoreVoice, type SourceLocation } from "./types";
import { durationTicks, positionTick, rangeTicks, readKey } from "./values";

const noteRoles: NonChordToneRole[] = ["passing", "neighbor", "suspension", "retardation", "appoggiatura", "anticipation", "escape", "pedal", "other"];
const allowedFields = {
  chord: ["at", "duration", "range", "symbol", "role", "localKey", "confidence", "locked", "draft"],
  note: ["role", "velocity", "locked"],
  phrase: ["range"],
  cadence: ["range", "phrase", "kind", "form", "completion", "confidence", "locked", "observedLanding"],
};

function required(spec: ScoreAnnotation, key: string) {
  const value = spec.fields[key];
  if (!value) fail(`${spec.kind} ${spec.name} 缺少 ${key}`, spec.location);
  return value;
}

function booleanField(value: string | undefined, location?: SourceLocation) {
  if (value !== undefined && value !== "true" && value !== "false") fail(`布尔值必须为 true 或 false：${value}`, location);
  return value === "true";
}

function bounds(spec: ScoreAnnotation, measures: MeasureInfo[]): [number, number] {
  if (spec.fields.range) {
    if (spec.fields.at || spec.fields.duration) fail("range 与 at/duration 不能同时使用", spec.location);
    return rangeTicks(spec.fields.range, measures, spec.location);
  }
  const start = positionTick(required(spec, "at"), measures, spec.location);
  const end = start + durationTicks(required(spec, "duration"), spec.location);
  if (end > measures.at(-1)!.endTick) fail("标注范围超出工程", spec.location);
  return [start, end];
}

/** Reference resolution uses a disposable clone; no reference fact is applied to the input. */
export function resolveAnnotations(
  input: ProjectDocument,
  declarations: readonly ScoreAnnotation[],
  aliases: Record<string, string>,
  options: { reference?: boolean; phrases?: ScoreAnnotationSet["phrases"] } = {},
) {
  let project = cloneProject(input);
  const measures = buildMeasures(project);
  const result: ScoreAnnotationSet = { chords: [], notes: [], phrases: [], cadences: [] };
  const specs: ScoreAnnotation[] = [];
  for (const declaration of declarations) {
    const previous = specs.find((item) => item.name === declaration.name);
    const isModifier = declaration.kind === "chord" && !declaration.fields.at && !declaration.fields.range && !declaration.fields.duration;
    if (previous?.kind === "chord" && isModifier) {
      for (const key of Object.keys(declaration.fields)) {
        if (Object.hasOwn(previous.fields, key)) fail(`和弦 ${declaration.name} 重复声明属性 ${key}`, declaration.location);
      }
      Object.assign(previous.fields, declaration.fields);
    } else specs.push({ ...declaration, fields: { ...declaration.fields } });
  }
  const names = new Set<string>();
  for (const spec of specs) {
    if (!Object.hasOwn(allowedFields, spec.kind)) fail(`未知标注类型 ${spec.kind}`, spec.location);
    if (names.has(spec.name)) fail(`重复标注名称 ${spec.name}`, spec.location);
    names.add(spec.name);
    for (const key of Object.keys(spec.fields)) {
      if (!(allowedFields[spec.kind] as readonly string[]).includes(key)) fail(`${spec.kind} 不支持属性 ${key}`, spec.location);
    }
  }
  // Expected chords may describe a different interpretation of already annotated music.
  if (options.reference && specs.some((spec) => spec.kind === "chord")) {
    project.chordTrack.regions = [];
    project.chordTrack.cadenceAnnotations = [];
  }
  for (const spec of specs.filter((item) => item.kind === "chord")) {
    const isModifier = !spec.fields.at && !spec.fields.range && !spec.fields.duration;
    const target = isModifier ? input.chordTrack.regions.find((chord) => chord.id === aliases[spec.name]) : undefined;
    if (isModifier && !target) fail(`找不到待标注的和弦 ${spec.name}；请声明范围与 symbol`, spec.location);
    const [startTick, endTick] = target ? [target.startTick, target.startTick + target.durationTicks] : bounds(spec, measures);
    const key = keyAtTick(project.keyEvents, startTick);
    const localKey = spec.fields.localKey ? readKey(spec.fields.localKey, spec.location) : undefined;
    if (spec.fields.draft && spec.fields.symbol) fail("draft 与 symbol 不能同时使用", spec.location);
    let draft;
    if (spec.fields.draft) {
      try { draft = JSON.parse(spec.fields.draft); } catch { fail("draft 必须是有效 JSON 和弦草稿", spec.location); }
      if (!draft || typeof draft !== "object" || Array.isArray(draft)) fail("draft 必须为和弦草稿对象", spec.location);
      draft = { source: "manual", confidence: "certain", ...draft };
    } else if (target && !spec.fields.symbol && target.semantics) draft = chordDraftFromIdentity(target.identity, target.semantics);
    else draft = chordDraft(required(spec, "symbol"), (localKey ?? key).mode, spec.location);
    draft.interpretationId = `interpretation-${spec.name}`;
    if (spec.fields.role !== undefined) {
      if (!["passing64", "pedal64", "cadential64", "deceptive"].includes(spec.fields.role)) fail(`未知和弦用途 ${spec.fields.role}`, spec.location);
      draft.cadenceRole = spec.fields.role;
    }
    if (localKey) draft.localKey = localKey;
    if (spec.fields.confidence) {
      if (!["certain", "probable", "ambiguous", "unknown"].includes(spec.fields.confidence)) fail("无效和弦置信度", spec.location);
      draft.confidence = spec.fields.confidence;
    }
    try {
      const region = {
        id: target?.id ?? `chord-${spec.name}`, startTick, durationTicks: endTick - startTick,
        identity: resolveChordIdentity(draft, key), semantics: semanticsFromChordDraft(draft),
        locked: booleanField(spec.fields.locked, spec.location),
      };
      if (target) project.chordTrack.regions = project.chordTrack.regions.filter((chord) => chord.id !== target.id);
      const edited = addChordRegion(project, region);
      if (edited.error) fail(edited.error, spec.location);
      project = edited.project;
      result.chords.push(project.chordTrack.regions.find((item) => item.id === region.id)!);
      if (Object.hasOwn(aliases, spec.name) && !options.reference && !target) fail(`名称 ${spec.name} 已被使用`, spec.location);
      aliases[spec.name] = region.id;
    } catch (error) {
      if (error instanceof Error && error.name === "ScoreTextError") throw error;
      fail(`和弦 ${spec.name} 的草稿无效：${error instanceof Error ? error.message : String(error)}`, spec.location);
    }
  }
  for (const spec of specs.filter((item) => item.kind === "note")) {
    const target = /^([SATB])@(.+)$/.exec(spec.name);
    const voice = target ? SCORE_VOICES[target[1] as ScoreVoice] : undefined;
    const tick = target ? positionTick(target[2], measures, spec.location) : undefined;
    const matches = project.satbTracks.flatMap((track) => track.notes
      .filter((note) => target ? track.voice === voice && note.startTick === tick : note.id === aliases[spec.name])
      .map((note) => ({ track, note })));
    if (matches.length !== 1) fail(`音符引用 ${spec.name} 必须唯一指向一个起奏音符`, spec.location);
    const { track, note } = matches[0];
    const role = spec.fields.role as NonChordToneRole | undefined;
    if (role !== undefined && !noteRoles.includes(role)) fail(`未知和弦外音角色 ${role}`, spec.location);
    if (!Object.keys(spec.fields).length) fail("音符标注至少需要一个属性", spec.location);
    const velocity = spec.fields.velocity === undefined ? undefined : Number(spec.fields.velocity);
    if (velocity !== undefined && (!Number.isInteger(velocity) || velocity < 1 || velocity > 127)) fail("力度必须为 1–127 的整数", spec.location);
    const patch = {
      ...(role ? { nonChordToneRole: role } : {}),
      ...(velocity !== undefined ? { velocity } : {}),
      ...(spec.fields.locked !== undefined ? { locked: booleanField(spec.fields.locked, spec.location) } : {}),
    };
    if (options.reference) Object.assign(note, patch);
    else {
      const edited = updateNote(project, track.voice, note.id, patch);
      if (edited.error) fail(edited.error, spec.location);
      project = edited.project;
    }
    result.notes.push({ voice: track.voice, noteId: note.id, startTick: note.startTick, ...(role ? { role } : {}), ...(velocity !== undefined ? { velocity } : {}), ...(spec.fields.locked !== undefined ? { locked: patch.locked } : {}) });
  }
  for (const spec of specs.filter((item) => item.kind === "phrase")) {
    const [fromTick, toTick] = rangeTicks(required(spec, "range"), measures, spec.location);
    if (result.phrases.some((phrase) => phrase.fromTick < toTick && fromTick < phrase.toTick)) fail("同一标注集中的乐句范围不能重叠", spec.location);
    if (!options.reference) {
      for (const tick of [fromTick, toTick]) {
        if (tick === 0 || tick === project.lengthTicks || project.structure.phraseBoundaries.some((item) => item.tick === tick)) continue;
        const edited = addPhraseBoundary(project, tick);
        if (edited.error) fail(edited.error, spec.location);
        project = edited.project;
      }
    }
    if (Object.hasOwn(aliases, spec.name) && !options.reference) fail(`名称 ${spec.name} 已被使用`, spec.location);
    const phraseId = `phrase-${fromTick}-${toTick}`;
    aliases[spec.name] = phraseId;
    result.phrases.push({ name: spec.name, phraseId, fromTick, toTick });
  }
  if (!options.reference) {
    const segments = analyzePhrases(project, { generateCandidates: false }).segments;
    for (const phrase of result.phrases) {
      if (!segments.some((segment) => segment.id === phrase.phraseId)) fail(`乐句 ${phrase.name} 内含其他已知乐句边界，无法表达为单个乐句`);
    }
  }
  for (const spec of specs.filter((item) => item.kind === "cadence")) {
    const [fromTick, toTick] = rangeTicks(required(spec, "range"), measures, spec.location);
    const phraseName = required(spec, "phrase");
    const phrase = [...result.phrases, ...(options.phrases ?? [])].find((item) => item.name === phraseName);
    if (!phrase) fail(`终止式引用了未声明的乐句 ${phraseName}`, spec.location);
    if (fromTick < phrase.fromTick || toTick > phrase.toTick) fail("终止式范围必须位于所属乐句内", spec.location);
    const kind = required(spec, "kind") as CadenceAnnotation["kind"];
    const form = spec.fields.form as CadenceAnnotation["form"];
    const completion = spec.fields.completion as CadenceAnnotation["completion"];
    const confidence = (spec.fields.confidence ?? "certain") as CadenceAnnotation["confidence"];
    if (!["full", "half", "supplementary", "deceptive"].includes(kind) ||
      (form !== undefined && !["authentic", "plagal"].includes(form)) ||
      (completion !== undefined && !["perfect", "imperfect"].includes(completion)) ||
      !["certain", "probable"].includes(confidence)) fail("终止式类型或置信度无效", spec.location);
    if ((kind !== "full" && completion !== undefined) ||
      (form === "plagal" && kind === "deceptive") ||
      (kind === "supplementary" && form !== "plagal")) fail("终止式类型与限定不一致", spec.location);
    const landing = spec.fields.observedLanding;
    if (landing !== undefined && options.reference) fail("参考标注不可声明已确认候选的实际落点", spec.location);
    const observedLandingTick = landing === undefined ? undefined : positionTick(landing, measures, spec.location);
    const cadence: CadenceAnnotation = {
      id: `cadence-${spec.name}`, phraseId: phrase.phraseId, fromTick, toTick, kind,
      ...(form ? { form } : {}), ...(completion ? { completion } : {}),
      confidence, source: landing === undefined ? "manual" : "accepted-candidate",
      ...(observedLandingTick !== undefined && { observedLandingTick }),
      locked: booleanField(spec.fields.locked, spec.location),
    };
    if (result.cadences.some((item) => item.fromTick < toTick && fromTick < item.toTick)) fail("终止式范围不能重叠", spec.location);
    if (!options.reference) {
      const edited = addCadenceAnnotation(project, cadence);
      if (edited.error) fail(edited.error, spec.location);
      project = edited.project;
    }
    if (Object.hasOwn(aliases, spec.name) && !options.reference) fail(`名称 ${spec.name} 已被使用`, spec.location);
    aliases[spec.name] = cadence.id;
    result.cadences.push(cadence);
  }
  if (!validateProject(project)) fail("标注生成了无效工程数据", specs.at(-1)?.location);
  return { project, annotations: result };
}
