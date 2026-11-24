import { writeMidi, type MidiData, type MidiEvent } from "midi-file";
import { formatChordRegion } from "./chords";
import {
  getExportAuxiliaryTracks,
  melodicMidiChannel,
  type AuxiliaryTrackExportOptions,
} from "./exportTracks";
import {
  type MusicalTrack,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "./project";
import { formatPitchClass, keySignatureFifths, toMidi } from "./pitch";

export type MidiExportLayout =
  | "single-track"
  | "piano-grand-staff"
  | "satb-separate";
export type MidiExportTimbre = "piano" | "choir" | "project";

export interface MidiExportOptions extends AuxiliaryTrackExportOptions {
  layout?: MidiExportLayout;
  timbre?: MidiExportTimbre;
  includeChords?: boolean;
}

export type MidiExportPreferences = Required<
  Omit<MidiExportOptions, "auxiliaryTrackIds">
>;

export const DEFAULT_MIDI_EXPORT_OPTIONS: MidiExportPreferences = {
  layout: "satb-separate",
  timbre: "piano",
  includeChords: true,
  includeAuxiliaryTracks: true,
};

const VOICE_INSTRUMENT_NAMES: Record<VoiceId, string> = {
  soprano: "Soprano",
  alto: "Alto",
  tenor: "Tenor",
  bass: "Bass",
};

const VOICE_DISPLAY_NAMES: Record<VoiceId, string> = {
  soprano: "女高音",
  alto: "女低音",
  tenor: "男高音",
  bass: "男低音",
};

export function toMidiString(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return binary;
}

export function fromMidiString(binary: string): string {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

type WithoutDelta<T> = T extends unknown ? Omit<T, "deltaTime"> : never;
type MidiEventPayload = WithoutDelta<MidiEvent>;

interface AbsoluteEvent {
  tick: number;
  priority: number;
  event: MidiEventPayload;
}

function toDeltaEvents(events: AbsoluteEvent[], endTick: number): MidiEvent[] {
  const ordered = [...events].sort(
    (a, b) => a.tick - b.tick || a.priority - b.priority,
  );
  const output: MidiEvent[] = [];
  let cursor = 0;
  ordered.forEach(({ tick, event }) => {
    output.push({
      ...event,
      deltaTime: Math.max(0, tick - cursor),
    } as MidiEvent);
    cursor = tick;
  });
  output.push({
    deltaTime: Math.max(0, endTick - cursor),
    type: "endOfTrack",
    meta: true,
  });
  return output;
}

function globalTrack(project: ProjectDocument) {
  const events: AbsoluteEvent[] = [
    {
      tick: 0,
      priority: 0,
      event: {
        type: "trackName",
        text: toMidiString(project.title || "SATB Master"),
        meta: true,
      },
    },
  ];
  project.tempoEvents.forEach((tempo) =>
    events.push({
      tick: tempo.tick,
      priority: 1,
      event: {
        type: "setTempo",
        microsecondsPerBeat: Math.round(60_000_000 / tempo.bpm),
        meta: true,
      },
    }),
  );
  project.meterEvents.forEach((meter) =>
    events.push({
      tick: meter.tick,
      priority: 1,
      event: {
        type: "timeSignature",
        numerator: meter.numerator,
        denominator: meter.denominator,
        metronome: 24,
        thirtyseconds: 8,
        meta: true,
      },
    }),
  );
  project.keyEvents.forEach((key) =>
    events.push({
      tick: key.tick,
      priority: 1,
      event: {
        type: "keySignature",
        key: keySignatureFifths(key),
        scale: key.mode === "minor" ? 1 : 0,
        meta: true,
      },
    }),
  );
  return toDeltaEvents(events, project.lengthTicks);
}

function resolveProgram(
  defaultProgram: number,
  timbre: MidiExportTimbre,
): number {
  if (timbre === "piano") return 0;
  if (timbre === "choir") return 52;
  return defaultProgram;
}

function appendNoteEvents(
  events: AbsoluteEvent[],
  note: NoteEvent,
  channel: number,
) {
  events.push({
    tick: note.startTick,
    priority: 3,
    event: {
      type: "noteOn",
      channel,
      noteNumber: toMidi(note.pitch),
      velocity: note.velocity,
    },
  });
  events.push({
    tick: note.startTick + note.durationTicks,
    priority: 2,
    event: {
      type: "noteOff",
      channel,
      noteNumber: toMidi(note.pitch),
      velocity: 0,
    },
  });
}

function buildNamedTrack(
  track: MusicalTrack,
  endTick: number,
  channel: number,
  programNumber: number,
  instrumentName?: string,
): MidiEvent[] {
  const displayName = track.kind === "satb" ? VOICE_DISPLAY_NAMES[track.id] : track.name;
  const events: AbsoluteEvent[] = [
    {
      tick: 0,
      priority: 0,
      event: { type: "trackName", text: toMidiString(displayName), meta: true },
    },
  ];
  if (instrumentName !== undefined) {
    events.push({
      tick: 0,
      priority: 0,
      event: { type: "instrumentName", text: toMidiString(instrumentName), meta: true },
    });
  }
  events.push({
    tick: 0,
    priority: 1,
    event: { type: "programChange", channel, programNumber },
  });
  track.notes.forEach((note) => appendNoteEvents(events, note, channel));
  return toDeltaEvents(events, endTick);
}

function buildPianoGrandStaffTracks(
  project: ProjectDocument,
  timbre: MidiExportTimbre,
): MidiEvent[][] {
  const programNumber = resolveProgram(0, timbre);

  // 钢琴大谱表：上下两轨共享 Channel 0 与相同的乐器名（Piano），
  // MuseScore / Sibelius 等打谱软件会自动将同一通道/乐器的双轨合并为单一「钢琴大谱表」（Grand Staff）。
  const sopranoTrack = project.satbTracks.find((t) => t.id === "soprano");
  const altoTrack = project.satbTracks.find((t) => t.id === "alto");

  const upperEvents: AbsoluteEvent[] = [
    {
      tick: 0,
      priority: 0,
      event: {
        type: "trackName",
        text: toMidiString("钢琴"),
        meta: true,
      },
    },
    {
      tick: 0,
      priority: 0,
      event: {
        type: "instrumentName",
        text: toMidiString("Piano"),
        meta: true,
      },
    },
    {
      tick: 0,
      priority: 1,
      event: { type: "programChange", channel: 0, programNumber },
    },
  ];

  sopranoTrack?.notes.forEach((note) => {
    appendNoteEvents(upperEvents, note, 0);
  });
  altoTrack?.notes.forEach((note) => {
    appendNoteEvents(upperEvents, note, 0);
  });

  // 下谱表（低音谱表）：男高音 + 男低音（均在 Channel 0）
  const tenorTrack = project.satbTracks.find((t) => t.id === "tenor");
  const bassTrack = project.satbTracks.find((t) => t.id === "bass");

  const lowerEvents: AbsoluteEvent[] = [
    {
      tick: 0,
      priority: 0,
      event: {
        type: "trackName",
        text: toMidiString("钢琴"),
        meta: true,
      },
    },
    {
      tick: 0,
      priority: 0,
      event: {
        type: "instrumentName",
        text: toMidiString("Piano"),
        meta: true,
      },
    },
    {
      tick: 0,
      priority: 1,
      event: { type: "programChange", channel: 0, programNumber },
    },
  ];

  tenorTrack?.notes.forEach((note) => {
    appendNoteEvents(lowerEvents, note, 0);
  });
  bassTrack?.notes.forEach((note) => {
    appendNoteEvents(lowerEvents, note, 0);
  });

  return [
    toDeltaEvents(upperEvents, project.lengthTicks),
    toDeltaEvents(lowerEvents, project.lengthTicks),
  ];
}

function buildSingleTrack(
  project: ProjectDocument,
  timbre: MidiExportTimbre,
): MidiEvent[][] {
  const programNumber = resolveProgram(0, timbre);
  const events: AbsoluteEvent[] = [
    {
      tick: 0,
      priority: 0,
      event: {
        type: "trackName",
        text: toMidiString(project.title || "SATB Master"),
        meta: true,
      },
    },
    {
      tick: 0,
      priority: 1,
      event: { type: "programChange", channel: 0, programNumber },
    },
  ];

  project.satbTracks.forEach((track) => {
    track.notes.forEach((note) => {
      appendNoteEvents(events, note, 0);
    });
  });

  return [toDeltaEvents(events, project.lengthTicks)];
}

function chordTrack(project: ProjectDocument) {
  const events: AbsoluteEvent[] = [
    {
      tick: 0,
      priority: 0,
      event: { type: "trackName", text: toMidiString("和弦标记"), meta: true },
    },
  ];
  project.chordTrack.regions.forEach((chord, index) => {
    events.push({
      tick: chord.startTick,
      priority: 1,
      event: {
        type: "marker",
        text: toMidiString(formatChordRegion(project, chord).roman),
        meta: true,
      },
    });
    const endTick = chord.startTick + chord.durationTicks;
    const nextChord = project.chordTrack.regions[index + 1];
    if (
      endTick < project.lengthTicks &&
      (!nextChord || nextChord.startTick > endTick)
    ) {
      events.push({
        tick: endTick,
        priority: 1,
        event: { type: "marker", text: toMidiString("N.C."), meta: true },
      });
    }
  });
  return toDeltaEvents(events, project.lengthTicks);
}

export function buildMidi(
  project: ProjectDocument,
  options?: boolean | MidiExportOptions,
) {
  const resolvedOptions =
    typeof options === "boolean"
      ? { ...DEFAULT_MIDI_EXPORT_OPTIONS, includeChords: options }
      : { ...DEFAULT_MIDI_EXPORT_OPTIONS, ...options };

  const layout = resolvedOptions.layout ?? DEFAULT_MIDI_EXPORT_OPTIONS.layout;
  const timbre = resolvedOptions.timbre ?? DEFAULT_MIDI_EXPORT_OPTIONS.timbre;
  const separate = layout === "satb-separate";
  const contentTracks =
    layout === "single-track"
      ? buildSingleTrack(project, timbre)
      : layout === "piano-grand-staff"
        ? buildPianoGrandStaffTracks(project, timbre)
        : project.satbTracks.map((track, index) =>
            buildNamedTrack(
              track,
              project.lengthTicks,
              melodicMidiChannel(index),
              resolveProgram(track.program, timbre),
              VOICE_INSTRUMENT_NAMES[track.id],
            ),
          );

  const auxiliaryChannelOffset = separate ? project.satbTracks.length : 1;
  const auxiliaryTracks = getExportAuxiliaryTracks(project, resolvedOptions).map(
    (track, index) =>
      buildNamedTrack(
        track,
        project.lengthTicks,
        melodicMidiChannel(auxiliaryChannelOffset + index),
        separate ? resolveProgram(track.program, timbre) : track.program,
        separate ? track.name : undefined,
      ),
  );
  const tracks = [globalTrack(project), ...contentTracks, ...auxiliaryTracks];

  if (resolvedOptions.includeChords && project.chordTrack.regions.length > 0)
    tracks.push(chordTrack(project));

  const data: MidiData = {
    header: { format: 1, numTracks: tracks.length, ticksPerBeat: project.ppq },
    tracks,
  };
  return new Uint8Array(
    writeMidi(data, { running: true, useByte9ForNoteOff: false }),
  );
}

export function midiFileName(
  project: ProjectDocument,
  layout: MidiExportLayout = "satb-separate",
) {
  const safe = project.title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ");
  const baseName =
    safe ||
    `${formatPitchClass(project.keyEvents[0]?.tonic ?? { step: "C", alter: 0 })}调四部和声`;
  const suffix =
    layout === "single-track"
      ? "（单轨）"
      : layout === "piano-grand-staff"
        ? "（大谱表）"
        : "（分轨总谱）";
  return `${baseName}${suffix}`;
}
