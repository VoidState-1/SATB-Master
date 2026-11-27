import { parseMidi, type MidiData, type MidiEvent } from "midi-file";
import { isSatbRangeLocked, overlaps, type EditResult } from "./editing";
import { fromMidiString } from "./midi";
import { keySignatureFifths, keyTonicOptions, spellMidi } from "./pitch";
import {
  AUXILIARY_COLOR_PALETTE,
  METER_DENOMINATORS,
  PPQ,
  cloneProject,
  createId,
  deriveAuxiliaryShortName,
  getAllPlayableTracks,
  normalizeProject,
  resolveAuxiliaryTrackColor,
  validateProject,
  type KeyEvent,
  type MeterEvent,
  type NoteEvent,
  type ProjectDocument,
  type TempoEvent,
  type VoiceId,
} from "./project";
import { isInteger } from "./project/validation";
import { eventAtTick, keyAtTick, orderedEvents, ticksPerBeat } from "./time";

export interface ParsedMidiRawNote {
  sourceStartTick: number;
  sourceDurationTicks: number;
  startTick: number;
  durationTicks: number;
  midiNote: number;
  velocity: number;
  channel: number;
  sourceTrack: number;
}

export interface ParsedMidiTrackSummary {
  key: string;
  sourceTrack: number;
  channel: number;
  name: string;
  program: number;
  isPercussion: boolean;
  noteCount: number;
  hasPolyphony: boolean;
  minMidi: number;
  maxMidi: number;
}

export interface ParsedMidiTrack extends ParsedMidiTrackSummary {
  notes: readonly ParsedMidiRawNote[];
}

type ParsedTempoEvent = Omit<TempoEvent, "id">;
type ParsedMeterEvent = Omit<MeterEvent, "id" | "beatGrouping">;
type ParsedKeyEvent = Omit<KeyEvent, "id">;

export interface ParsedMidiFile {
  fileName: string;
  format: 0 | 1 | 2 | "svp";
  sourceTicksPerBeat: number;
  sourceTrackCount: number;
  tracks: readonly ParsedMidiTrack[];
  tempoEvents: readonly ParsedTempoEvent[];
  meterEvents: readonly ParsedMeterEvent[];
  keyEvents: readonly ParsedKeyEvent[];
  endTick: number;
  warnings: readonly string[];
}

export interface MidiImportApplyOptions {
  /** 省略时选择旋律轨，纯打击乐文件则选择全部轨道。 */
  selectedTrackKeys?: readonly string[];
  satbDestinations?: Readonly<Record<string, VoiceId>>;
  /** 应用导入的时间线，缺少起始事件时沿用工程对应的起始事件。 */
  applyTimingEvents?: boolean;
  showInScorePreview?: boolean;
  /** 音符与启用导入的时间事件使用同一个工程 tick 偏移。 */
  startTickOffset?: number;
}

export interface MidiImportResult extends EditResult {
  importedTrackIds: string[];
  importedNoteCount: number;
  deduplicatedNoteCount: number;
  extendedLengthTicks?: number;
  warnings: string[];
}

type OpenNote = Pick<
  ParsedMidiRawNote,
  "sourceStartTick" | "midiNote" | "velocity" | "channel"
>;

interface NoteQueue {
  notes: OpenNote[];
  head: number;
}

interface MidiParseContext {
  sourceTicksPerBeat: number;
  scaleTick: (tick: number) => number;
  warnings: string[];
  tempos: Map<number, ParsedTempoEvent>;
  meters: Map<number, ParsedMeterEvent>;
  keys: Map<number, ParsedKeyEvent>;
}

const MIDI_PARSE_ERROR = "无法解析 MIDI 文件，请确认文件格式有效";

function readMidi(bytes: Uint8Array): MidiData {
  try {
    // midi-file 的 chunk 读取使用 slice，截断的 chunk 可能被当成完整数据。
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLength = data.getUint32(4);
    const trackCount = data.getUint16(10);
    let offset = 8 + headerLength;
    if (headerLength < 6 || offset > data.byteLength) throw new Error();
    for (let track = 0; track < trackCount; track += 1) {
      offset += 8 + data.getUint32(offset + 4);
      if (offset > data.byteLength) throw new Error();
    }
    const midi = parseMidi(bytes);
    if (
      ![0, 1, 2].includes(midi.header.format) ||
      midi.tracks.length !== trackCount
    )
      throw new Error();
    return midi;
  } catch {
    throw new Error(MIDI_PARSE_ERROR);
  }
}

function decodeMidiName(text: string) {
  let name: string;
  try {
    name = fromMidiString(text, { fatal: true });
  } catch {
    name = text;
  }
  return name.replace(/\p{Cc}/gu, "").trim();
}

function resampleEvents<T extends { tick: number }>(
  events: ReadonlyMap<number, T>,
  scaleTick: MidiParseContext["scaleTick"],
) {
  const byTick = new Map<number, T>();
  for (const event of orderedEvents([...events.values()])) {
    const tick = scaleTick(event.tick);
    byTick.set(tick, { ...event, tick });
  }
  return [...byTick.values()];
}

export function summarizeImportNotes(notes: ParsedMidiRawNote[]) {
  notes.sort((left, right) => left.sourceStartTick - right.sourceStartTick);
  let minMidi = 127;
  let maxMidi = 0;
  let latestEndTick = 0;
  let hasPolyphony = false;
  for (const note of notes) {
    minMidi = Math.min(minMidi, note.midiNote);
    maxMidi = Math.max(maxMidi, note.midiNote);
    hasPolyphony ||= note.startTick < latestEndTick;
    latestEndTick = Math.max(latestEndTick, note.startTick + note.durationTicks);
  }
  return { noteCount: notes.length, minMidi, maxMidi, hasPolyphony };
}

function parseSourceTrack(
  events: readonly MidiEvent[],
  sourceTrack: number,
  fileName: string,
  context: MidiParseContext,
): ParsedMidiTrack[] {
  const { scaleTick, warnings, tempos, meters, keys } = context;
  const notesByChannel = new Map<number, ParsedMidiRawNote[]>();
  const programs = new Map<number, number>();
  const openNotes = new Map<number, NoteQueue>();
  const trackLabel = "MIDI 轨 " + (sourceTrack + 1);
  let trackName = "";
  let instrumentName = "";
  let tick = 0;

  function closeNote(note: OpenNote, sourceEndTick: number) {
    const startTick = scaleTick(note.sourceStartTick);
    const durationTicks = Math.max(1, scaleTick(sourceEndTick) - startTick);
    if (!isInteger(startTick + durationTicks, 1)) throw new Error(MIDI_PARSE_ERROR);
    const notes = notesByChannel.get(note.channel) ?? [];
    notes.push({
      ...note,
      sourceTrack,
      sourceDurationTicks: Math.max(1, sourceEndTick - note.sourceStartTick),
      startTick,
      durationTicks,
    });
    notesByChannel.set(note.channel, notes);
  }

  for (const event of events) {
    tick += event.deltaTime;
    if (!isInteger(event.deltaTime, 0) || !isInteger(tick, 0))
      throw new Error(MIDI_PARSE_ERROR);

    switch (event.type) {
      case "trackName":
        trackName ||= decodeMidiName(event.text);
        break;
      case "instrumentName":
        instrumentName ||= decodeMidiName(event.text);
        break;
      case "setTempo": {
        if (!Number.isInteger(event.microsecondsPerBeat)) throw new Error(MIDI_PARSE_ERROR);
        const bpm = Math.round(60_000_000 / event.microsecondsPerBeat);
        tempos.set(tick, { tick, bpm: Math.max(20, Math.min(300, bpm)) });
        break;
      }
      case "timeSignature": {
        const { numerator, denominator } = event;
        const supportedDenominator = METER_DENOMINATORS.find(
          (value) => value === denominator,
        );
        if (supportedDenominator === undefined || !isInteger(numerator, 1, 32)) {
          warnings.push(
            trackLabel + " 跳过了不支持的拍号 " + numerator + "/" + denominator,
          );
        } else {
          meters.set(tick, { tick, numerator, denominator: supportedDenominator });
        }
        break;
      }
      case "keySignature": {
        const mode = event.scale === 0 ? "major" : "minor";
        const tonic = (event.scale === 0 || event.scale === 1) &&
          keyTonicOptions(mode).find(
            (candidate) => keySignatureFifths({ tonic: candidate, mode }) === event.key,
          );
        if (tonic) {
          keys.set(tick, { tick, tonic: { ...tonic }, mode });
        } else {
          warnings.push(trackLabel + " 跳过了不支持的调号（升降号数 " +
            event.key + "，调式 " + event.scale + "）");
        }
        break;
      }
      case "programChange":
        if (!programs.has(event.channel)) programs.set(event.channel, event.programNumber);
        break;
      case "noteOn":
      case "noteOff": {
        const { noteNumber: midiNote, velocity, channel } = event;
        if (!isInteger(midiNote, 0, 127) || !isInteger(velocity, 0, 127))
          throw new Error(MIDI_PARSE_ERROR);
        const queueKey = channel * 128 + midiNote;
        const queue = openNotes.get(queueKey);
        if (event.type === "noteOn" && velocity > 0) {
          const active = queue ?? { notes: [], head: 0 };
          active.notes.push({ sourceStartTick: tick, midiNote, velocity, channel });
          openNotes.set(queueKey, active);
        } else if (queue) {
          closeNote(queue.notes[queue.head], tick);
          queue.head += 1;
          if (queue.head === queue.notes.length) openNotes.delete(queueKey);
        }
        break;
      }
    }
  }

  let unclosedCount = 0;
  for (const { notes, head } of openNotes.values()) {
    for (let index = head; index < notes.length; index += 1) {
      const note = notes[index];
      const endTick = tick > note.sourceStartTick ? tick : tick + context.sourceTicksPerBeat;
      closeNote(note, endTick);
      unclosedCount += 1;
    }
  }
  if (unclosedCount > 0) {
    warnings.push(trackLabel + " 已补齐 " + unclosedCount + " 个未闭合音符");
  }

  const name = trackName || instrumentName || fileName.trim() || trackLabel;
  return [...notesByChannel.entries()]
    .sort(([left], [right]) => left - right)
    .map(([channel, notes]) => {
      const isPercussion = channel === 9;
      const channelLabel = " (Ch " + (channel + 1) + (isPercussion ? " 打击乐)" : ")");
      return {
        key: "t" + sourceTrack + "-c" + channel,
        sourceTrack,
        channel,
        name: notesByChannel.size > 1 || isPercussion ? name + channelLabel : name,
        program: clampProgram(programs.get(channel) ?? 0),
        isPercussion,
        ...summarizeImportNotes(notes),
        notes,
      };
    });
}

export function parseMidiForImport(
  bytes: Uint8Array,
  fileName = "",
): ParsedMidiFile {
  if (bytes.length === 0) throw new Error("MIDI 文件为空");
  const { header, tracks: sourceTracks } = readMidi(bytes);
  const { ticksPerBeat: sourceTicksPerBeat, format } = header;
  if (sourceTicksPerBeat === undefined)
    throw new Error("暂不支持 SMPTE 时间码格式的 MIDI 文件");
  if (!Number.isInteger(sourceTicksPerBeat) || sourceTicksPerBeat <= 0)
    throw new Error("MIDI 文件的每拍 tick 数无效");

  const context: MidiParseContext = {
    sourceTicksPerBeat,
    scaleTick(sourceTick) {
      const tick = Math.max(0, Math.round((sourceTick * PPQ) / sourceTicksPerBeat));
      if (!isInteger(tick, 0)) throw new Error("MIDI 文件的 tick 超出工程时间范围");
      return tick;
    },
    warnings: [],
    tempos: new Map(),
    meters: new Map(),
    keys: new Map(),
  };
  const tracks = sourceTracks.flatMap((events, index) =>
    parseSourceTrack(events, index, fileName, context),
  );
  if (tracks.length === 0) throw new Error("该 MIDI 文件不包含可导入的音符");

  let endTick = 0;
  for (const track of tracks) {
    for (const note of track.notes) {
      endTick = Math.max(endTick, note.startTick + note.durationTicks);
    }
  }
  return {
    fileName,
    format,
    sourceTicksPerBeat,
    sourceTrackCount: sourceTracks.length,
    tracks,
    endTick,
    tempoEvents: resampleEvents(context.tempos, context.scaleTick),
    meterEvents: resampleEvents(context.meters, context.scaleTick),
    keyEvents: resampleEvents(context.keys, context.scaleTick),
    warnings: context.warnings,
  };
}

function clampProgram(program: number) {
  return Math.max(0, Math.min(127, Math.round(program)));
}

function timingEventsForImport<T extends { tick: number; id: string }>(
  current: readonly T[],
  imported: readonly Omit<T, "id">[],
  offset: number,
  idPrefix: string,
) {
  const events = imported.map((event) => ({
    ...event,
    id: createId(idPrefix),
    tick: event.tick + offset,
  }));
  const initial = current.find((event) => event.tick === 0);
  return initial && !events.some((event) => event.tick === 0)
    ? [initial, ...events]
    : events;
}

function enclosingMeasureEnd(targetTick: number, meterEvents: readonly MeterEvent[]) {
  // 与 buildMeasures 一样，变拍事件开启新小节。按拍号分段计算，无需逐小节展开长工程。
  const meters = orderedEvents(meterEvents);
  const meter = eventAtTick(meters, targetTick);
  const measureTicks = ticksPerBeat(PPQ, meter.denominator) * meter.numerator;
  const boundary =
    meter.tick + Math.ceil((targetTick - meter.tick) / measureTicks) * measureTicks;
  const nextMeter = meters.find((event) => event.tick > targetTick);
  return Math.min(boundary, nextMeter?.tick ?? boundary);
}

export function importNoteTracks(
  project: ProjectDocument,
  parsed: ParsedMidiFile,
  options: MidiImportApplyOptions = {},
): MidiImportResult {
  const warnings = [...parsed.warnings];
  const source = parsed.format === "svp" ? "SVP" : "MIDI";
  function failure(error: string): MidiImportResult {
    return {
      project,
      error,
      importedTrackIds: [],
      importedNoteCount: 0,
      deduplicatedNoteCount: 0,
      warnings,
    };
  }

  const selectedKeys = options.selectedTrackKeys && new Set(options.selectedTrackKeys);
  const hasMelodicTrack = parsed.tracks.some((track) => !track.isPercussion);
  const selectedTracks = parsed.tracks.filter((track) =>
    selectedKeys ? selectedKeys.has(track.key) : !hasMelodicTrack || !track.isPercussion,
  );
  if (selectedTracks.length === 0) return failure("请至少选择一条要导入的轨道");

  const offset = options.startTickOffset ?? 0;
  if (!isInteger(offset, 0)) return failure(`${source} 导入起点必须是非负整数 tick`);
  let maxImportedEndTick = 0;
  for (const track of selectedTracks) {
    for (const note of track.notes) {
      maxImportedEndTick = Math.max(
        maxImportedEndTick,
        note.startTick + note.durationTicks + offset,
      );
    }
  }
  if (!isInteger(maxImportedEndTick, 1)) return failure(`${source} 导入超出工程时间范围`);

  const next = cloneProject(project);
  if (options.applyTimingEvents) {
    next.tempoEvents = timingEventsForImport(
      next.tempoEvents, parsed.tempoEvents, offset, "tempo",
    );
    next.meterEvents = timingEventsForImport(
      next.meterEvents, parsed.meterEvents, offset, "meter",
    );
    next.keyEvents = timingEventsForImport(
      next.keyEvents, parsed.keyEvents, offset, "key",
    );
  }
  let extendedLengthTicks: number | undefined;
  if (maxImportedEndTick > next.lengthTicks) {
    extendedLengthTicks = enclosingMeasureEnd(maxImportedEndTick, next.meterEvents);
    if (!isInteger(extendedLengthTicks, maxImportedEndTick))
      return failure(`${source} 导入超出工程时间范围`);
    next.lengthTicks = extendedLengthTicks;
  }
  if (options.applyTimingEvents) {
    const withinProject = (event: { tick: number }) => event.tick <= next.lengthTicks;
    next.tempoEvents = next.tempoEvents.filter(withinProject);
    next.meterEvents = next.meterEvents.filter(withinProject);
    next.keyEvents = next.keyEvents.filter(withinProject).filter((event) => {
      const crossesChord = next.chordTrack.regions.some(
        (region) => region.startTick < event.tick &&
          event.tick < region.startTick + region.durationTicks,
      );
      if (crossesChord) {
        warnings.push("已跳过位于既有和弦区域内的导入调号变更（tick " + event.tick + "）");
      }
      return !crossesChord;
    });
  }

  const playableTracks = getAllPlayableTracks(next);
  const usedIds = new Set(playableTracks.map((track) => track.id));
  const usedNames = new Set(playableTracks.map((track) => track.name.trim()));
  const usedColors = new Set(
    next.auxiliaryTracks.map((track, index) =>
      resolveAuxiliaryTrackColor(track, index).toLowerCase(),
    ),
  );
  const keyEvents = [...orderedEvents(next.keyEvents)];
  const importId = createId("midi-import");
  const importedTrackIds: string[] = [];
  const usedSatbDestinations = new Set<VoiceId>();
  let importedNoteCount = 0;
  let deduplicatedNoteCount = 0;

  for (const track of selectedTracks) {
    const notes: NoteEvent[] = [];
    const seenNotes = new Set<string>();
    for (const rawNote of track.notes) {
      const { midiNote, durationTicks } = rawNote;
      const startTick = rawNote.startTick + offset;
      const noteKey = [midiNote, startTick, durationTicks].join(":");
      if (seenNotes.has(noteKey)) {
        deduplicatedNoteCount += 1;
        continue;
      }
      seenNotes.add(noteKey);
      notes.push({
        id: createId("note"),
        startTick,
        durationTicks,
        pitch: spellMidi(midiNote, keyAtTick(keyEvents, startTick)),
        velocity: rawNote.velocity,
        locked: false,
        spellingSource: "midi-inferred",
        ...(source === "MIDI" && { importOrigin: {
          importId,
          sourceTrack: rawNote.sourceTrack,
          channel: rawNote.channel,
          sourceStartTick: rawNote.sourceStartTick,
          sourceDurationTicks: rawNote.sourceDurationTicks,
          sourceMidiNote: midiNote,
        } }),
      });
    }
    const destination = options.satbDestinations?.[track.key];
    if (destination) {
      const satb = next.satbTracks.find(({ id }) => id === destination);
      if (!satb || usedSatbDestinations.has(destination))
        return failure("每条选中的源轨须对应不同的 SATB 声部");
      if (track.isPercussion || track.hasPolyphony)
        return failure(`「${track.name}」须为单音旋律轨才能导入 SATB`);
      if (satb.locked || notes.some((note) => isSatbRangeLocked(next, destination, note)))
        return failure(`「${satb.name}」声部或目标时间范围已锁定`);
      const combined = [...satb.notes, ...notes].sort((a, b) => a.startTick - b.startTick);
      if (combined.some((note, index) => index > 0 && overlaps(combined[index - 1], note)))
        return failure(`「${satb.name}」会出现重叠音符，可调整插入位置或选择额外声部`);
      satb.notes = combined;
      usedSatbDestinations.add(destination);
      importedTrackIds.push(destination);
      importedNoteCount += notes.length;
      continue;
    }
    const index = next.auxiliaryTracks.length;
    const baseName = track.name.trim();
    let name = baseName;
    for (let suffix = 2; usedNames.has(name); suffix += 1) {
      name = baseName + " " + suffix;
    }
    usedNames.add(name);
    const color = AUXILIARY_COLOR_PALETTE.find((candidate) => !usedColors.has(candidate)) ??
      resolveAuxiliaryTrackColor({}, index);
    usedColors.add(color);
    let id = createId("aux");
    while (usedIds.has(id)) id = createId("aux");
    usedIds.add(id);

    next.auxiliaryTracks.push({
      id,
      kind: "auxiliary",
      role: source === "MIDI" ? "midi-import" : "other",
      participatesInHarmony: false,
      monophonic: false,
      name,
      shortName: deriveAuxiliaryShortName(name, index),
      color,
      program: clampProgram(track.program),
      visible: true,
      muted: false,
      solo: false,
      locked: false,
      volume: 0.85,
      pan: 0,
      showInScorePreview: Boolean(options.showInScorePreview),
      notes,
    });
    importedTrackIds.push(id);
    importedNoteCount += notes.length;
  }

  next.updatedAt = new Date().toISOString();
  const normalized = normalizeProject(next);
  // 保留未参与导入的 SATB 轨原有音符顺序。
  normalized.satbTracks = next.satbTracks;
  if (!options.applyTimingEvents) {
    normalized.tempoEvents = next.tempoEvents;
    normalized.meterEvents = next.meterEvents;
    normalized.keyEvents = next.keyEvents;
  }
  if (!validateProject(normalized)) return failure(`${source} 导入后的工程校验失败`);
  return {
    project: normalized,
    importedTrackIds,
    importedNoteCount,
    deduplicatedNoteCount,
    ...(extendedLengthTicks === undefined ? {} : { extendedLengthTicks }),
    warnings,
  };
}

export const importMidiToAuxiliaryTracks = importNoteTracks;
