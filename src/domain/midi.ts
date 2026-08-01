import { writeMidi, type MidiData, type MidiEvent } from "midi-file";
import { formatChordRegion } from "./chords";
import {
  getAllPlayableTracks,
  type MusicalTrack,
  type ProjectDocument,
} from "./model";
import { formatPitchClass, keySignatureFifths, toMidi } from "./pitch";

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
      event: { type: "trackName", text: "SATB Master", meta: true },
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

function playableTrack(
  track: MusicalTrack,
  trackIndex: number,
  endTick: number,
) {
  // MIDI 通道 10（索引 9）保留给打击乐；辅助轨超过可用通道时允许复用通道，但仍保持独立轨道。
  const channel = trackIndex < 9 ? trackIndex : (trackIndex + 1) % 16;
  const events: AbsoluteEvent[] = [
    {
      tick: 0,
      priority: 0,
      event: { type: "trackName", text: track.name, meta: true },
    },
    {
      tick: 0,
      priority: 1,
      event: { type: "programChange", channel, programNumber: track.program },
    },
  ];
  track.notes.forEach((note) => {
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
  });
  return toDeltaEvents(events, endTick);
}

function chordTrack(project: ProjectDocument) {
  const events: AbsoluteEvent[] = [
    {
      tick: 0,
      priority: 0,
      event: { type: "trackName", text: "Chords", meta: true },
    },
  ];
  project.chordTrack.regions.forEach((chord, index) => {
    events.push({
      tick: chord.startTick,
      priority: 1,
      event: {
        type: "marker",
        text: formatChordRegion(project, chord).roman,
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
        event: { type: "marker", text: "N.C.", meta: true },
      });
    }
  });
  return toDeltaEvents(events, project.lengthTicks);
}

export function buildMidi(project: ProjectDocument, includeChords = true) {
  const tracks = [
    globalTrack(project),
    ...getAllPlayableTracks(project).map((track, index) =>
      playableTrack(track, index, project.lengthTicks),
    ),
  ];
  if (includeChords && project.chordTrack.regions.length > 0)
    tracks.push(chordTrack(project));

  const data: MidiData = {
    header: { format: 1, numTracks: tracks.length, ticksPerBeat: project.ppq },
    tracks,
  };
  return new Uint8Array(
    writeMidi(data, { running: true, useByte9ForNoteOff: false }),
  );
}

export function midiFileName(project: ProjectDocument) {
  const safe = project.title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ");
  return (
    safe ||
    `${formatPitchClass(project.keyEvents[0]?.tonic ?? { step: "C", alter: 0 })}调四部和声`
  );
}
