import { describe, expect, it } from 'vitest'
import { addNote, deleteNotes, updateNote } from './editing'
import { createEmptyProject, PPQ, type NoteEvent } from './model'

function note(id: string, startTick: number): NoteEvent {
  return { id, startTick, durationTicks: PPQ, midiNote: 60, velocity: 88, locked: false }
}

describe('练习锁定约束', () => {
  it('阻止在锁定时间区间新增音符', () => {
    const project = createEmptyProject()
    project.exercise.editableRanges = [{
      id: 'range-1',
      voiceIds: ['soprano'],
      fromTick: 0,
      toTick: PPQ * 2,
      editable: false,
    }]

    const result = addNote(project, 'soprano', note('note-1', PPQ))
    expect(result.project).toBe(project)
    expect(result.error).toContain('锁定')
  })

  it('阻止音符移入锁定区间，也阻止删除区间内的给定音符', () => {
    const project = createEmptyProject()
    project.exercise.editableRanges = [{
      id: 'range-1',
      voiceIds: ['bass'],
      fromTick: 0,
      toTick: PPQ * 2,
      editable: false,
    }]
    project.tracks.find((track) => track.id === 'bass')!.notes = [note('given', 0), note('answer', PPQ * 3)]

    expect(updateNote(project, 'bass', 'answer', { startTick: PPQ }).error).toContain('锁定')
    expect(deleteNotes(project, new Set(['given'])).error).toContain('没有可删除')
    expect(project.tracks.find((track) => track.id === 'bass')!.notes).toHaveLength(2)
  })
})

describe('音符数值边界', () => {
  it('拒绝越界音高和非有限时值', () => {
    const project = createEmptyProject()

    expect(addNote(project, 'soprano', { ...note('high', 0), midiNote: 128 }).error).toContain('参数无效')
    expect(addNote(project, 'soprano', { ...note('nan', 0), durationTicks: Number.NaN }).error).toContain('参数无效')
  })

  it('拒绝属性编辑产生非法力度', () => {
    const project = createEmptyProject()
    project.tracks[0].notes = [note('existing', 0)]

    expect(updateNote(project, 'soprano', 'existing', { velocity: 0 }).error).toContain('参数无效')
  })
})
