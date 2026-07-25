import { describe, expect, it } from 'vitest'
import { createEmptyProject, migrateProject, validateProject } from './model'

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
    project.chordTrack.regions.push({
      id: 'bad-chord', startTick: 0, durationTicks: 960,
      analysis: { degree: 1, accidental: 0, quality: 'major', inversion: 0 }, locked: false,
    })
    ;(project.chordTrack.regions[0].analysis as { quality: string }).quality = 'unknown'

    expect(validateProject(project)).toBe(false)
  })

  it('把 v1 点式和弦数据迁移为 v2 范围轨并丢弃手写名称', () => {
    const current = createEmptyProject()
    const legacy = structuredClone(current) as unknown as Record<string, unknown>
    legacy.schemaVersion = 1
    legacy.chords = [{
      id: 'legacy-chord', startTick: 480, durationTicks: 960,
      degree: 5, accidental: 0, quality: 'dominant7', inversion: 1,
      label: '用户随意填写的名称', locked: false,
    }]
    delete legacy.chordTrack

    const migrated = migrateProject(legacy)
    expect(migrated?.schemaVersion).toBe(2)
    expect(migrated?.chordTrack.displayMode).toBe('roman')
    expect(migrated?.chordTrack.regions[0]).toMatchObject({
      id: 'legacy-chord', startTick: 480, durationTicks: 960,
      analysis: { degree: 5, accidental: 0, quality: 'dominant7', inversion: 1 },
    })
    expect(migrated?.chordTrack.regions[0]).not.toHaveProperty('label')
  })
})
