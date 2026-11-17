import { fail, type ScoreAnnotation, type ScoreAnnotationKind, type ScoreBlock, type ScoreSpec, type SourceLocation } from "./types";

function stripComment(text: string) {
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    if (escaped) { escaped = false; continue; }
    if (text[i] === "\\" && quoted) { escaped = true; continue; }
    if (text[i] === '"') quoted = !quoted;
    if (!quoted && text.slice(i, i + 2) === "//") return text.slice(0, i);
  }
  return text;
}

function unquote(text: string, location: SourceLocation) {
  if (!text.startsWith('"')) return text;
  try { const value: unknown = JSON.parse(text); if (typeof value === "string") return value; } catch { /* reported below */ }
  return fail("字符串必须使用有效的双引号转义", location);
}

function fields(text: string, location: SourceLocation): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  let rest = text.trim();
  while (rest) {
    const match = /^([A-Za-z][\w-]*)=("(?:\\.|[^"\\])*"|[^\s]+)/.exec(rest);
    if (!match) fail(`无法解析标注属性：${rest}`, location);
    if (Object.hasOwn(result, match[1])) fail(`重复属性 ${match[1]}`, location);
    result[match[1]] = unquote(match[2], location);
    rest = rest.slice(match[0].length).trimStart();
  }
  return result;
}

export function parseAnnotation(text: string, location: SourceLocation = { line: 1, column: 1 }): ScoreAnnotation {
  const match = /^(chord|note|phrase|cadence)\s+(\S+)(?:\s+(.*))?$/.exec(text.trim());
  if (!match) fail("标注必须以 chord、note、phrase 或 cadence 开始", location);
  return { kind: match[1] as ScoreAnnotationKind, name: match[2], fields: fields(match[3] ?? "", location), location };
}

export function parseScoreText(source: string): ScoreSpec {
  const spec: ScoreSpec = { version: 1, blocks: [], annotations: [], reference: [], events: [], metadata: {} };
  let section: "bars" | "annotations" | "reference" | undefined;
  let block: ScoreBlock | undefined;
  let currentVoice: keyof ScoreBlock["voices"] | "H" | undefined;
  let pendingAnnotation: ScoreAnnotation | undefined;
  const seenHeaders = new Set<string>();
  let versionSeen = false;
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = stripComment(raw).trim();
    const location: SourceLocation = { line: index + 1, column: Math.max(1, raw.search(/\S/) + 1) };
    if (!line) {
      if (section === "bars" && currentVoice) {
        if (currentVoice === "H") block!.harmony += "\n";
        else block!.voices[currentVoice] += "\n";
      }
      return;
    }
    if (!versionSeen) {
      if (line !== "satb 1") fail("首个声明必须是 satb 1", location);
      versionSeen = true;
      return;
    }
    if (line === "}") {
      if (!section) fail("多余的右花括号", location);
      section = undefined; block = undefined; currentVoice = undefined; pendingAnnotation = undefined;
      return;
    }
    if (section === "bars") {
      const voiceMatch = /^([SATBH]):\s*(.*)$/.exec(line);
      if (voiceMatch) {
        currentVoice = voiceMatch[1] as typeof currentVoice;
        if (block!.voiceLocations![currentVoice!]) fail(`重复声部 ${currentVoice}`, location);
        block!.voiceLocations![currentVoice!] = { ...location, column: voiceMatch[2] ? raw.indexOf(voiceMatch[2]) + 1 : location.column + 3 };
        if (currentVoice === "H") block!.harmony = voiceMatch[2];
        else block!.voices[currentVoice!] = voiceMatch[2];
      } else {
        if (!currentVoice) fail("小节块内需要 S:、A:、T:、B: 或 H:", location);
        if (currentVoice === "H") block!.harmony += `\n${stripComment(raw)}`;
        else block!.voices[currentVoice] += `\n${stripComment(raw)}`;
      }
      return;
    }
    if (section === "annotations" || section === "reference") {
      if (/^(chord|note|phrase|cadence)\s/.test(line)) {
        pendingAnnotation = parseAnnotation(line, location);
        spec[section]!.push(pendingAnnotation);
      } else {
        if (!pendingAnnotation) fail("属性续行前缺少标注声明", location);
        const extra = fields(line, location);
        for (const [key, value] of Object.entries(extra)) {
          if (Object.hasOwn(pendingAnnotation.fields, key)) fail(`重复属性 ${key}`, location);
          pendingAnnotation.fields[key] = value;
        }
      }
      return;
    }
    const blockMatch = /^bars\s+(\d+)\.\.(\d+)\s*\{$/.exec(line);
    if (blockMatch) {
      block = { from: Number(blockMatch[1]), to: Number(blockMatch[2]), voices: {} as ScoreBlock["voices"], location, voiceLocations: {} };
      spec.blocks.push(block); section = "bars"; return;
    }
    const annotationMatch = /^(annotations|reference)(?:\s+complete=([a-z,]+))?\s*\{$/.exec(line);
    if (annotationMatch) {
      section = annotationMatch[1] as "annotations" | "reference";
      if (annotationMatch[2]) {
        if (section !== "reference" || spec.referenceComplete) fail("complete 只能在一个 reference 块上声明", location);
        const kinds = annotationMatch[2].split(",");
        if (kinds.some((kind) => !["chord", "note", "phrase", "cadence"].includes(kind)) || new Set(kinds).size !== kinds.length)
          fail("complete 使用 chord,note,phrase,cadence 中不重复的项目", location);
        spec.referenceComplete = kinds as ScoreAnnotationKind[];
      }
      return;
    }
    const eventMatch = /^at\s+(\S+)\s+(key|meter|tempo)\s+(.+)$/.exec(line);
    if (eventMatch) {
      spec.events!.push({ at: eventMatch[1], [eventMatch[2]]: eventMatch[2] === "tempo" ? Number(eventMatch[3]) : eventMatch[3], location });
      return;
    }
    const metaMatch = /^meta\s+([\w.-]+)\s+(.+)$/.exec(line);
    if (metaMatch) {
      if (Object.hasOwn(spec.metadata!, metaMatch[1])) fail(`重复元信息 ${metaMatch[1]}`, location);
      Object.defineProperty(spec.metadata!, metaMatch[1], { value: unquote(metaMatch[2], location), enumerable: true });
      return;
    }
    const header = /^(title|key|meter|tempo)\s+(.+)$/.exec(line);
    if (!header) fail(`未知声明：${line}`, location);
    if (seenHeaders.has(header[1])) fail(`重复声明 ${header[1]}；时间变化请使用 at`, location);
    seenHeaders.add(header[1]);
    if (header[1] === "tempo") spec.tempo = Number(header[2]);
    else if (header[1] === "title") spec.title = unquote(header[2], location);
    else if (header[1] === "key") spec.key = header[2];
    else spec.meter = header[2];
  });
  if (!versionSeen) fail("缺少 satb 1 声明");
  if (section) fail(`未关闭的 ${section} 块`, { line: lines.length, column: 1 });
  if (!spec.blocks.length) fail("至少需要一个 bars 块");
  return spec;
}
