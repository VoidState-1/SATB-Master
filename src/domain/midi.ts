import { writeMidi, type MidiData, type MidiEvent } from 'midi-file'
import { KEY_NAMES, VOICE_ORDER, type ProjectDocument } from './model'

type WithoutDelta<T> = T extends unknown ? Omit<T, 'deltaTime'> : never
type MidiEventPayload = WithoutDelta<MidiEvent>

interface AbsoluteEvent {
  tick: number
  priority: number
  event: MidiEventPayload
}

const MAJOR_FIFTHS: Record<number, number> = {
  0: 0, 1: -5, 2: 2, 3: -3, 4: 4, 5: -1,
  6: 6, 7: 1, 8: -4, 9: 3, 10: -2, 11: 5,
}

function toDeltaEvents(events: AbsoluteEvent[], endTick: number): MidiEvent[] {
  const ordered = [...events].sort((a, b) => a.tick - b.tick || a.priority - b.priority)
  const output: MidiEvent[] = []
  let cursor = 0
  ordered.forEach(({ tick, event }) => {
    output.push({ ...event, deltaTime: Math.max(0, tick - cursor) } as MidiEvent)
    cursor = tick
  })
  output.push({ deltaTime: Math.max(0, endTick - cursor), type: 'endOfTrack', meta: true })
  return output
}

function keyFifths(tonic: number, mode: 'major' | 'minor') {
  const relativeMajor = mode === 'minor' ? (tonic + 3) % 12 : tonic
  return MAJOR_FIFTHS[relativeMajor] ?? 0
}

function globalTrack(project: ProjectDocument) {
  const events: AbsoluteEvent[] = [
    { tick: 0, priority: 0, event: { type: 'trackName', text: 'SATB Master', meta: true } },
  ]
  project.tempoEvents.forEach((tempo) => events.push({
    tick: tempo.tick,
    priority: 1,
    event: { type: 'setTempo', microsecondsPerBeat: Math.round(60_000_000 / tempo.bpm), meta: true },
  }))
  project.meterEvents.forEach((meter) => events.push({
    tick: meter.tick,
    priority: 1,
    event: {
      type: 'timeSignature',
      numerator: meter.numerator,
      denominator: meter.denominator,
      metronome: 24,
      thirtyseconds: 8,
      meta: true,
    },
  }))
  project.keyEvents.forEach((key) => events.push({
    tick: key.tick,
    priority: 1,
    event: { type: 'keySignature', key: keyFifths(key.tonic, key.mode), scale: key.mode === 'minor' ? 1 : 0, meta: true },
  }))
  return toDeltaEvents(events, project.lengthTicks)
}

function voiceTrack(project: ProjectDocument, voiceIndex: number) {
  const voiceId = VOICE_ORDER[voiceIndex]
  const track = project.tracks.find((candidate) => candidate.id === voiceId)
  if (!track) throw new Error(`缺少 MIDI 导出声部：${voiceId}`)
  const channel = voiceIndex
  const events: AbsoluteEvent[] = [
    { tick: 0, priority: 0, event: { type: 'trackName', text: track.name, meta: true } },
    { tick: 0, priority: 1, event: { type: 'programChange', channel, programNumber: track.program } },
  ]
  track.notes.forEach((note) => {
    events.push({
      tick: note.startTick,
      priority: 3,
      event: { type: 'noteOn', channel, noteNumber: note.midiNote, velocity: note.velocity },
    })
    events.push({
      tick: note.startTick + note.durationTicks,
      priority: 2,
      event: { type: 'noteOff', channel, noteNumber: note.midiNote, velocity: 0 },
    })
  })
  return toDeltaEvents(events, project.lengthTicks)
}

function chordTrack(project: ProjectDocument) {
  const events: AbsoluteEvent[] = [
    { tick: 0, priority: 0, event: { type: 'trackName', text: 'Chords', meta: true } },
  ]
  project.chords.forEach((chord) => events.push({
    tick: chord.startTick,
    priority: 1,
    event: { type: 'marker', text: chord.label, meta: true },
  }))
  return toDeltaEvents(events, project.lengthTicks)
}

export function buildMidi(project: ProjectDocument, includeChords = true) {
  const tracks = [globalTrack(project), ...VOICE_ORDER.map((_, index) => voiceTrack(project, index))]
  if (includeChords && project.chords.length > 0) tracks.push(chordTrack(project))

  const data: MidiData = {
    header: { format: 1, numTracks: tracks.length, ticksPerBeat: project.ppq },
    tracks,
  }
  return new Uint8Array(writeMidi(data, { running: true, useByte9ForNoteOff: false }))
}

export function midiFileName(project: ProjectDocument) {
  const safe = project.title.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ')
  return safe || `${KEY_NAMES[project.keyEvents[0]?.tonic ?? 0]}调四部和声`
}
