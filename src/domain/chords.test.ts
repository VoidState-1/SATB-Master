import { describe, expect, it } from 'vitest'
import { formatChord } from './chords'
import { addChordRegion, splitChordRegion, transformChordRegions, updateChordRegion } from './editing'
import { createEmptyProject, PPQ, type ChordRegion } from './model'

function region(id: string, startTick: number, durationTicks = PPQ): ChordRegion {
  return {
    id,
    startTick,
    durationTicks,
    analysis: { degree: 1, accidental: 0, quality: 'major', inversion: 0 },
    locked: false,
  }
}

describe('和弦命名', () => {
  const cMajor = { id: 'key-c', tick: 0, tonic: 0, mode: 'major' as const }

  it('从结构计算罗马数字、绝对和弦与转位低音', () => {
    expect(formatChord({ degree: 2, accidental: 0, quality: 'minor', inversion: 1 }, cMajor)).toMatchObject({
      roman: 'ii6', absolute: 'Dm/F', functionLabel: '下属功能',
    })
    expect(formatChord({ degree: 5, accidental: 0, quality: 'dominant7', inversion: 2 }, cMajor)).toMatchObject({
      roman: 'V4/3', absolute: 'G7/D',
    })
  })

  it('计算副属和弦和变化级数名称', () => {
    expect(formatChord({
      degree: 5, accidental: 0, quality: 'dominant7', inversion: 0, appliedToDegree: 5,
    }, cMajor)).toMatchObject({ roman: 'V7/V', absolute: 'D7' })
    expect(formatChord({ degree: 2, accidental: -1, quality: 'major', inversion: 0 }, cMajor)).toMatchObject({
      roman: '♭II', absolute: 'D♭',
    })
  })
})

describe('和弦范围命令', () => {
  it('拒绝重叠和跨调性区域', () => {
    const project = createEmptyProject()
    project.keyEvents.push({ id: 'key-g', tick: PPQ * 2, tonic: 7, mode: 'major' })
    const first = addChordRegion(project, region('first', 0))
    expect(first.error).toBeUndefined()
    expect(addChordRegion(first.project, region('overlap', PPQ / 2)).error).toContain('重叠')
    expect(addChordRegion(first.project, region('cross-key', PPQ, PPQ * 2)).error).toContain('调性')
  })

  it('批量移动与切分各自形成一次纯命令结果', () => {
    let project = createEmptyProject()
    project = addChordRegion(project, region('first', 0)).project
    project = addChordRegion(project, region('second', PPQ * 2)).project
    const moved = transformChordRegions(project, new Set(['first', 'second']), (item) => ({
      ...item, startTick: item.startTick + PPQ,
    }))
    expect(moved.error).toBeUndefined()
    expect(moved.project.chordTrack.regions.map((item) => item.startTick)).toEqual([PPQ, PPQ * 3])

    const split = splitChordRegion(moved.project, 'first', PPQ + PPQ / 2)
    expect(split.project.chordTrack.regions).toHaveLength(3)
    expect(split.project.chordTrack.regions.slice(0, 2).map((item) => item.durationTicks)).toEqual([PPQ / 2, PPQ / 2])
  })

  it('三和弦不接受第三转位且锁定区域不可移动', () => {
    let project = addChordRegion(createEmptyProject(), region('first', 0)).project
    expect(updateChordRegion(project, 'first', { analysis: { inversion: 3 } }).error).toContain('无效')
    project = updateChordRegion(project, 'first', { locked: true }).project
    expect(transformChordRegions(project, new Set(['first']), (item) => ({ ...item, startTick: PPQ })).error).toContain('锁定')
  })
})
