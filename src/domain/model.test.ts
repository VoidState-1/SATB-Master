import { describe, expect, it } from 'vitest'
import { createEmptyProject, validateProject } from './model'

describe('工程文件校验', () => {
  it('接受当前版本创建的完整工程', () => {
    expect(validateProject(createEmptyProject())).toBe(true)
  })

  it('拒绝旧的浅层结构伪装成完整工程', () => {
    const project = createEmptyProject() as unknown as Record<string, unknown>
    delete project.audio

    expect(validateProject(project)).toBe(false)
  })

  it('拒绝缺少零时刻基准的时间事件', () => {
    const project = createEmptyProject()
    project.tempoEvents[0].tick = 960

    expect(validateProject(project)).toBe(false)
  })

  it('拒绝越界音高与非有限数值', () => {
    const project = createEmptyProject()
    project.tracks[0].notes.push({
      id: 'bad-note', startTick: 0, durationTicks: 960,
      midiNote: 128, velocity: 88, locked: false,
    })
    project.audio.masterVolume = Number.NaN

    expect(validateProject(project)).toBe(false)
  })

  it('拒绝无效练习区间和未知和弦性质', () => {
    const project = createEmptyProject()
    project.exercise.editableRanges.push({
      id: 'bad-range', voiceIds: ['soprano'], fromTick: 960, toTick: 0, editable: false,
    })
    project.chords.push({
      id: 'bad-chord', startTick: 0, durationTicks: 960, degree: 1, accidental: 0,
      quality: 'major', inversion: 0, label: 'I', locked: false,
    })
    ;(project.chords[0] as { quality: string }).quality = 'unknown'

    expect(validateProject(project)).toBe(false)
  })
})
