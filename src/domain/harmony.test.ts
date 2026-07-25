import { describe, expect, it } from 'vitest'
import { checkHarmony } from './harmony'
import { createEmptyProject, PPQ, type VoiceId } from './model'

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
    ]))
  })
})
