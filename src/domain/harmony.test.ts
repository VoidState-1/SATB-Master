import { describe, expect, it } from 'vitest'
import { checkHarmony } from './harmony'
import { createEmptyProject, PPQ, type NoteEvent, type VoiceId } from './model'

function addPair(project: ReturnType<typeof createEmptyProject>, voiceId: VoiceId, pitches: [number, number]) {
  project.tracks.find((track) => track.id === voiceId)!.notes = pitches.map((midiNote, index) => ({
    id: `${voiceId}-${index}`,
    startTick: index * PPQ,
    durationTicks: PPQ,
    midiNote,
    velocity: 88,
    locked: false,
  }))
}

function note(id: string, startTick: number, durationTicks: number, midiNote: number): NoteEvent {
  return { id, startTick, durationTicks, midiNote, velocity: 88, locked: false }
}

function ruleIds(project: ReturnType<typeof createEmptyProject>) {
  return checkHarmony(project).diagnostics.map((item) => item.ruleId)
}

describe('斯波索宾基础规则检查', () => {
  it('识别两个声部同向形成的连续纯五度', () => {
    const project = createEmptyProject()
    project.lengthTicks = PPQ * 2
    addPair(project, 'soprano', [67, 69])
    addPair(project, 'bass', [48, 50])

    const result = checkHarmony(project)
    expect(result.diagnostics.some((item) => item.ruleId === 'parallel-fifths' && item.tick === PPQ)).toBe(true)
  })

  it('和弦轨为空时明确跳过依赖和弦标注的规则', () => {
    const result = checkHarmony(createEmptyProject())
    expect(result.skippedRuleIds).toEqual(expect.arrayContaining([
      'chord-membership',
      'chord-completeness',
      'chord-inversion',
      'leading-tone-doubling',
      'chord-seventh-resolution',
    ]))
  })

  it('识别同一声部内时间重叠的音符', () => {
    const project = createEmptyProject()
    project.lengthTicks = PPQ * 2
    project.tracks[0].notes = [
      note('s-0', 0, PPQ, 67),
      note('s-1', PPQ / 2, PPQ, 69),
    ]

    expect(ruleIds(project)).toContain('voice-note-overlap')
  })

  it('相邻但不重叠的同声部音符不触发重叠规则', () => {
    const project = createEmptyProject()
    project.lengthTicks = PPQ * 2
    addPair(project, 'soprano', [67, 69])

    expect(ruleIds(project)).not.toContain('voice-note-overlap')
  })

  it('大调导音上行到主音时通过', () => {
    const project = createEmptyProject()
    project.lengthTicks = PPQ * 2
    addPair(project, 'soprano', [71, 72])

    expect(ruleIds(project)).not.toContain('leading-tone-resolution')
  })

  it('连续导音未上行到主音时给出提示', () => {
    const project = createEmptyProject()
    project.lengthTicks = PPQ * 2
    addPair(project, 'soprano', [71, 69])

    expect(ruleIds(project)).toContain('leading-tone-resolution')
  })

  it('小调自然七级不被误判为升高导音', () => {
    const project = createEmptyProject()
    project.lengthTicks = PPQ * 2
    project.keyEvents[0] = { ...project.keyEvents[0], tonic: 0, mode: 'minor' }
    addPair(project, 'soprano', [70, 68])

    expect(ruleIds(project)).not.toContain('leading-tone-resolution')
  })

  it('换调边界不沿用旧调导音解决要求', () => {
    const project = createEmptyProject()
    project.lengthTicks = PPQ * 2
    project.keyEvents.push({ id: 'key-d', tick: PPQ, tonic: 2, mode: 'major' })
    addPair(project, 'soprano', [71, 69])

    expect(ruleIds(project)).not.toContain('leading-tone-resolution')
  })

  it('七和弦七音级进下行解决时通过', () => {
    const project = createEmptyProject()
    project.lengthTicks = PPQ * 2
    project.chords.push({
      id: 'g7', startTick: 0, durationTicks: PPQ, degree: 5, accidental: 0,
      quality: 'dominant7', inversion: 0, label: 'V7', locked: false,
    })
    addPair(project, 'alto', [65, 64])

    expect(ruleIds(project)).not.toContain('chord-seventh-resolution')
  })

  it('七和弦七音未级进下行时给出提示', () => {
    const project = createEmptyProject()
    project.lengthTicks = PPQ * 2
    project.chords.push({
      id: 'g7', startTick: 0, durationTicks: PPQ, degree: 5, accidental: 0,
      quality: 'dominant7', inversion: 0, label: 'V7', locked: false,
    })
    addPair(project, 'alto', [65, 67])

    expect(ruleIds(project)).toContain('chord-seventh-resolution')
  })
})
