import { parseMidi } from 'midi-file'
import { describe, expect, it } from 'vitest'
import { buildMidi } from './midi'
import { createEmptyProject, PPQ } from './model'

describe('MIDI Type 1 导出', () => {
  it('导出全局轨与四条声部轨，并保留速度、拍号和调号', () => {
    const project = createEmptyProject()
    project.tempoEvents.push({ id: 'tempo-2', tick: PPQ * 4, bpm: 96 })
    project.tracks[0].notes.push({ id: 's-1', startTick: 0, durationTicks: PPQ, midiNote: 72, velocity: 90, locked: false })

    const parsed = parseMidi(Array.from(buildMidi(project)))
    expect(parsed.header.format).toBe(1)
    expect(parsed.header.ticksPerBeat).toBe(PPQ)
    expect(parsed.tracks).toHaveLength(5)
    expect(parsed.tracks[0].filter((event) => event.type === 'setTempo')).toHaveLength(2)
    expect(parsed.tracks[0].some((event) => event.type === 'timeSignature')).toBe(true)
    expect(parsed.tracks[0].some((event) => event.type === 'keySignature')).toBe(true)
    expect(parsed.tracks[1].some((event) => event.type === 'noteOn' && event.noteNumber === 72)).toBe(true)
  })

  it('仅在和弦轨非空时创建 Chords 标记轨', () => {
    const project = createEmptyProject()
    project.chords.push({
      id: 'chord-1',
      startTick: 0,
      durationTicks: PPQ,
      degree: 1,
      accidental: 0,
      quality: 'major',
      inversion: 0,
      label: 'I',
      locked: false,
    })

    const parsed = parseMidi(Array.from(buildMidi(project)))
    expect(parsed.tracks).toHaveLength(6)
    expect(parsed.tracks[5].some((event) => event.type === 'marker' && event.text === 'I')).toBe(true)
  })
})
