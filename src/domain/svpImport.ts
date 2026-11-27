import { summarizeImportNotes, type ParsedMidiFile, type ParsedMidiRawNote, type ParsedMidiTrack } from "./midiImport";
import { METER_DENOMINATORS, PPQ } from "./project";
import { isInteger, isRecord } from "./project/validation";

// A quarter note in Synthesizer V is 705,600,000 blicks.
const SVP_QUARTER = 705_600_000;
const MAX_EXPANDED_NOTES = 100_000;
const toTick = (blick: number) => Math.round(blick / SVP_QUARTER * PPQ);

function integer(value: unknown, min: number, max?: number): value is number {
  return isInteger(value, min, max);
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readTiming(time: unknown) {
  const tempos = new Map<number, ParsedMidiFile["tempoEvents"][number]>();
  const meters: ParsedMidiFile["meterEvents"][number][] = [];
  let skippedTiming = 0;
  for (const event of records(isRecord(time) ? time.tempo : undefined)) {
    if (!integer(event.position, 0) || typeof event.bpm !== "number" ||
        event.bpm < 1 || event.bpm > 1000 || !Number.isFinite(event.bpm)) {
      skippedTiming++;
      continue;
    }
    const tick = toTick(event.position);
    tempos.set(tick, { tick, bpm: event.bpm });
  }
  const meterChanges = new Map<number, Omit<ParsedMidiFile["meterEvents"][number], "tick">>();
  for (const event of records(isRecord(time) ? time.meter : undefined)) {
    const denominator = METER_DENOMINATORS.find((value) => value === event.denominator);
    if (!integer(event.index, 0) || !integer(event.numerator, 1, 32) || denominator === undefined) {
      skippedTiming++;
      continue;
    }
    meterChanges.set(event.index, { numerator: event.numerator, denominator });
  }
  let previousIndex = 0;
  let tick = 0;
  let measureTicks = PPQ * 4;
  for (const [index, meter] of [...meterChanges].sort(([a], [b]) => a - b)) {
    tick += (index - previousIndex) * measureTicks;
    if (!Number.isSafeInteger(tick)) {
      skippedTiming++;
      break;
    }
    meters.push({ tick, ...meter });
    previousIndex = index;
    measureTicks = PPQ * 4 * meter.numerator / meter.denominator;
  }
  return { tempoEvents: [...tempos.values()].sort((a, b) => a.tick - b.tick), meterEvents: meters, skippedTiming };
}

export function parseSvpForImport(bytes: Uint8Array, fileName: string): ParsedMidiFile {
  let svp: unknown;
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    svp = JSON.parse(json.trimEnd().replace(/[\u0000\s]+$/, ""));
  } catch {
    throw new Error("无法读取 SVP，请选择有效的 Synthesizer V 工程");
  }
  if (!isRecord(svp) || !Array.isArray(svp.tracks))
    throw new Error("SVP 工程缺少轨道数据");

  const groups = new Map(records(svp.library).filter((group) => typeof group.uuid === "string").map((group) => [group.uuid, group]));
  const tracks: ParsedMidiTrack[] = [];
  let endTick = 0;
  let expandedNotes = 0;
  let invalidNotes = 0;
  let missingGroups = 0;
  svp.tracks.forEach((track, sourceTrack) => {
    if (!isRecord(track)) return;
    const notes: ParsedMidiRawNote[] = [];
    const addGroup = (group: Record<string, unknown>, ref: Record<string, unknown>) => {
      const offset = integer(ref.blickOffset, Number.MIN_SAFE_INTEGER) ? ref.blickOffset : 0;
      const transpose = integer(ref.pitchOffset, -127, 127) ? ref.pitchOffset : 0;
      const lower = integer(ref.blickAbsoluteBegin, 0) ? ref.blickAbsoluteBegin : 0;
      const upper = integer(ref.blickAbsoluteEnd, 0) ? ref.blickAbsoluteEnd : Infinity;
      for (const note of records(group.notes)) {
        if (++expandedNotes > MAX_EXPANDED_NOTES) throw new Error("SVP 展开后超过 100,000 个音符");
        if (!integer(note.onset, Number.MIN_SAFE_INTEGER) || !integer(note.duration, 1) || !integer(note.pitch, 0, 127) ||
            !integer(note.pitch + transpose, 0, 127)) {
          invalidNotes++;
          continue;
        }
        const onset = note.onset + offset;
        const start = Math.max(lower, onset);
        const end = Math.min(upper, onset + note.duration);
        if (end <= start) continue;
        const startTick = toTick(start);
        const durationTicks = Math.max(1, toTick(end) - startTick);
        endTick = Math.max(endTick, startTick + durationTicks);
        notes.push({
          sourceTrack, channel: 0, midiNote: note.pitch + transpose, velocity: 90,
          sourceStartTick: startTick, sourceDurationTicks: durationTicks, startTick, durationTicks,
        });
      }
    };

    if (isRecord(track.mainGroup)) addGroup(track.mainGroup, isRecord(track.mainRef) ? track.mainRef : {});
    for (const ref of records(track.groups)) {
      if (ref.isInstrumental === true) continue;
      const group = groups.get(ref.groupID);
      if (group) addGroup(group, ref);
      else missingGroups++;
    }
    if (notes.length === 0) return;
    tracks.push({
      key: `svp-${sourceTrack}`, sourceTrack, channel: 0, program: 52, isPercussion: false,
      name: typeof track.name === "string" && track.name.trim() ? track.name.trim() : `SVP 轨 ${sourceTrack + 1}`,
      notes, ...summarizeImportNotes(notes),
    });
  });
  if (tracks.length === 0) throw new Error("该 SVP 工程没有可导入的歌声音符");
  const { tempoEvents, meterEvents, skippedTiming } = readTiming(svp.time);
  const warnings: string[] = [];
  if (invalidNotes) warnings.push(`已跳过 ${invalidNotes} 个无效或超出 MIDI 音域的音符`);
  if (missingGroups) warnings.push(`已跳过 ${missingGroups} 个缺少数据的音符组`);
  if (skippedTiming) warnings.push(`已跳过 ${skippedTiming} 个不支持的速度或拍号事件`);
  return {
    fileName, format: "svp", sourceTicksPerBeat: SVP_QUARTER, sourceTrackCount: svp.tracks.length,
    tracks, endTick, tempoEvents, meterEvents, keyEvents: [], warnings,
  };
}
