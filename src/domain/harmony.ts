import {
  KEY_NAMES,
  VOICE_CONFIG,
  VOICE_ORDER,
  getTrack,
  type ChordEvent,
  type ChordQuality,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from './model'
import { keyAtTick } from './time'

export type DiagnosticSeverity = 'error' | 'warning' | 'suggestion'

export interface HarmonyDiagnostic {
  id: string
  ruleId: string
  severity: DiagnosticSeverity
  tick: number
  endTick: number
  voiceIds: VoiceId[]
  noteIds: string[]
  title: string
  message: string
}

export interface HarmonyCheckResult {
  diagnostics: HarmonyDiagnostic[]
  skippedRuleIds: string[]
}

interface Slice {
  tick: number
  endTick: number
  notes: Partial<Record<VoiceId, NoteEvent>>
}

const CHORD_RULE_IDS = ['chord-membership', 'chord-completeness', 'chord-inversion', 'leading-tone-doubling']
const DEGREE_MAJOR = [0, 2, 4, 5, 7, 9, 11]
const DEGREE_MINOR = [0, 2, 3, 5, 7, 8, 10]

const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  halfDiminished7: [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9],
}

function pitchClass(note: number) {
  return ((note % 12) + 12) % 12
}

function direction(from: number, to: number) {
  return Math.sign(to - from)
}

function diagnostic(
  ruleId: string,
  severity: DiagnosticSeverity,
  tick: number,
  endTick: number,
  voiceIds: VoiceId[],
  notes: NoteEvent[],
  title: string,
  message: string,
): HarmonyDiagnostic {
  const noteIds = notes.map((note) => note.id)
  return {
    id: `${ruleId}:${tick}:${[...noteIds].sort().join(',')}`,
    ruleId,
    severity,
    tick,
    endTick,
    voiceIds,
    noteIds,
    title,
    message,
  }
}

function buildSlices(project: ProjectDocument): Slice[] {
  const boundaries = new Set<number>([0, project.lengthTicks])
  project.tracks.forEach((track) => track.notes.forEach((note) => {
    boundaries.add(note.startTick)
    boundaries.add(note.startTick + note.durationTicks)
  }))
  project.chords.forEach((chord) => {
    boundaries.add(chord.startTick)
    boundaries.add(chord.startTick + chord.durationTicks)
  })

  const ordered = [...boundaries].filter((tick) => tick >= 0 && tick <= project.lengthTicks).sort((a, b) => a - b)
  return ordered.slice(0, -1).map((tick, index) => {
    const notes: Slice['notes'] = {}
    project.tracks.forEach((track) => {
      notes[track.id] = track.notes.find((note) => note.startTick <= tick && note.startTick + note.durationTicks > tick)
    })
    return { tick, endTick: ordered[index + 1], notes }
  })
}

function chordAtTick(chords: ChordEvent[], tick: number) {
  return chords.find((chord) => chord.startTick <= tick && chord.startTick + chord.durationTicks > tick)
}

function chordRoot(project: ProjectDocument, chord: ChordEvent) {
  const key = keyAtTick(project.keyEvents, chord.startTick)
  const degrees = key.mode === 'major' ? DEGREE_MAJOR : DEGREE_MINOR
  return pitchClass(key.tonic + degrees[chord.degree - 1] + chord.accidental)
}

function checkRanges(project: ProjectDocument) {
  const diagnostics: HarmonyDiagnostic[] = []
  project.tracks.forEach((track) => track.notes.forEach((note) => {
    const range = VOICE_CONFIG[track.id]
    if (note.midiNote < range.min || note.midiNote > range.max) {
      diagnostics.push(diagnostic(
        'voice-range', 'warning', note.startTick, note.startTick + note.durationTicks,
        [track.id], [note], '超出建议音域',
        `${track.name}建议使用 MIDI ${range.min}-${range.max}，当前音高为 ${note.midiNote}。`,
      ))
    }
  }))
  return diagnostics
}

function checkMelodicMotion(project: ProjectDocument) {
  const diagnostics: HarmonyDiagnostic[] = []
  project.tracks.forEach((track) => {
    const notes = [...track.notes].sort((a, b) => a.startTick - b.startTick)
    for (let index = 1; index < notes.length; index += 1) {
      const previous = notes[index - 1]
      const current = notes[index]
      const interval = Math.abs(current.midiNote - previous.midiNote)
      if (interval > 12) {
        diagnostics.push(diagnostic(
          'melodic-large-leap', 'error', current.startTick, current.startTick + current.durationTicks,
          [track.id], [previous, current], '旋律跳进过大', `${track.name}出现超过八度的跳进（${interval} 个半音）。`,
        ))
      } else if (interval > 7) {
        diagnostics.push(diagnostic(
          'melodic-large-leap', 'warning', current.startTick, current.startTick + current.durationTicks,
          [track.id], [previous, current], '较大旋律跳进', `${track.name}出现大于纯五度的跳进，需检查前后旋律方向。`,
        ))
      } else if (interval === 6) {
        diagnostics.push(diagnostic(
          'melodic-tritone', 'warning', current.startTick, current.startTick + current.durationTicks,
          [track.id], [previous, current], '旋律三全音', `${track.name}出现三全音跳进。`,
        ))
      }

      const key = keyAtTick(project.keyEvents, previous.startTick)
      const previousDegree = pitchClass(previous.midiNote - key.tonic)
      if (previousDegree === 11 && current.startTick === previous.startTick + previous.durationTicks) {
        if (pitchClass(current.midiNote) !== pitchClass(key.tonic) || current.midiNote <= previous.midiNote) {
          diagnostics.push(diagnostic(
            'leading-tone-resolution', 'warning', current.startTick, current.startTick + current.durationTicks,
            [track.id], [previous, current], '导音未上行解决',
            `${KEY_NAMES[key.tonic]} ${key.mode === 'major' ? '大调' : '小调'}中的导音通常应上行解决到主音。`,
          ))
        }
      }
    }
  })
  return diagnostics
}

function checkVerticalSlices(slices: Slice[]) {
  const diagnostics: HarmonyDiagnostic[] = []
  const seen = new Set<string>()

  slices.forEach((slice) => {
    const notes = slice.notes
    const adjacent: Array<[VoiceId, VoiceId]> = [['soprano', 'alto'], ['alto', 'tenor'], ['tenor', 'bass']]
    adjacent.forEach(([upperId, lowerId], pairIndex) => {
      const upper = notes[upperId]
      const lower = notes[lowerId]
      if (!upper || !lower) return

      if (upper.midiNote < lower.midiNote) {
        const item = diagnostic(
          'voice-crossing', 'error', slice.tick, slice.endTick,
          [upperId, lowerId], [upper, lower], '声部交叉', '较高声部低于相邻的较低声部。',
        )
        if (!seen.has(item.id)) diagnostics.push(item)
        seen.add(item.id)
      }

      if (pairIndex < 2 && upper.midiNote - lower.midiNote > 12) {
        const item = diagnostic(
          'upper-spacing', 'warning', slice.tick, slice.endTick,
          [upperId, lowerId], [upper, lower], '上三声部间距过宽', 'S-A 与 A-T 的相邻声部间距通常不应超过八度。',
        )
        if (!seen.has(item.id)) diagnostics.push(item)
        seen.add(item.id)
      }
    })
  })
  return diagnostics
}

function checkVoiceLeading(slices: Slice[]) {
  const diagnostics: HarmonyDiagnostic[] = []
  const seen = new Set<string>()

  for (let index = 1; index < slices.length; index += 1) {
    const previous = slices[index - 1]
    const current = slices[index]

    for (let upperIndex = 0; upperIndex < VOICE_ORDER.length - 1; upperIndex += 1) {
      for (let lowerIndex = upperIndex + 1; lowerIndex < VOICE_ORDER.length; lowerIndex += 1) {
        const upperId = VOICE_ORDER[upperIndex]
        const lowerId = VOICE_ORDER[lowerIndex]
        const previousUpper = previous.notes[upperId]
        const previousLower = previous.notes[lowerId]
        const currentUpper = current.notes[upperId]
        const currentLower = current.notes[lowerId]
        if (!previousUpper || !previousLower || !currentUpper || !currentLower) continue

        const upperDirection = direction(previousUpper.midiNote, currentUpper.midiNote)
        const lowerDirection = direction(previousLower.midiNote, currentLower.midiNote)
        const previousInterval = pitchClass(previousUpper.midiNote - previousLower.midiNote)
        const currentInterval = pitchClass(currentUpper.midiNote - currentLower.midiNote)
        const similarMotion = upperDirection !== 0 && upperDirection === lowerDirection

        if (similarMotion && previousInterval === currentInterval && (currentInterval === 0 || currentInterval === 7)) {
          const ruleId = currentInterval === 7 ? 'parallel-fifths' : 'parallel-octaves'
          const item = diagnostic(
            ruleId, 'error', current.tick, current.endTick,
            [upperId, lowerId], [previousUpper, previousLower, currentUpper, currentLower],
            currentInterval === 7 ? '平行纯五度' : '平行八度或同度',
            '两个声部同向移动，并连续形成相同类型的完全协和音程。',
          )
          if (!seen.has(item.id)) diagnostics.push(item)
          seen.add(item.id)
        }

        if (upperId === 'soprano' && lowerId === 'bass' && similarMotion && (currentInterval === 0 || currentInterval === 7)) {
          if (Math.abs(currentUpper.midiNote - previousUpper.midiNote) > 2 && previousInterval !== currentInterval) {
            const item = diagnostic(
              'hidden-perfect-interval', 'warning', current.tick, current.endTick,
              [upperId, lowerId], [previousUpper, previousLower, currentUpper, currentLower],
              '外声部隐伏完全协和音程', '外声部同向进入纯五度或八度，且高声部发生跳进。',
            )
            if (!seen.has(item.id)) diagnostics.push(item)
            seen.add(item.id)
          }
        }
      }
    }

    const adjacent: Array<[VoiceId, VoiceId]> = [['soprano', 'alto'], ['alto', 'tenor'], ['tenor', 'bass']]
    adjacent.forEach(([upperId, lowerId]) => {
      const previousUpper = previous.notes[upperId]
      const previousLower = previous.notes[lowerId]
      const currentUpper = current.notes[upperId]
      const currentLower = current.notes[lowerId]
      if (!previousUpper || !previousLower || !currentUpper || !currentLower) return
      if (currentUpper.midiNote < previousLower.midiNote || currentLower.midiNote > previousUpper.midiNote) {
        const item = diagnostic(
          'voice-overlap', 'warning', current.tick, current.endTick,
          [upperId, lowerId], [previousUpper, previousLower, currentUpper, currentLower],
          '声部重叠', '当前声部进入了相邻声部上一位置所占据的音域。',
        )
        if (!seen.has(item.id)) diagnostics.push(item)
        seen.add(item.id)
      }
    })
  }

  return diagnostics
}

function checkChordRules(project: ProjectDocument, slices: Slice[]) {
  const diagnostics: HarmonyDiagnostic[] = []
  const checked = new Set<string>()

  slices.forEach((slice) => {
    const chord = chordAtTick(project.chords, slice.tick)
    if (!chord || checked.has(chord.id)) return
    checked.add(chord.id)
    const active = VOICE_ORDER.map((voiceId) => ({ voiceId, note: slice.notes[voiceId] })).filter(
      (item): item is { voiceId: VoiceId; note: NoteEvent } => Boolean(item.note),
    )
    if (active.length < 4) return

    const root = chordRoot(project, chord)
    const intervals = QUALITY_INTERVALS[chord.quality]
    const chordTones = intervals.map((interval) => pitchClass(root + interval))
    const outside = active.filter(({ note }) => !chordTones.includes(pitchClass(note.midiNote)))
    if (outside.length > 0) {
      diagnostics.push(diagnostic(
        'chord-membership', 'warning', chord.startTick, chord.startTick + chord.durationTicks,
        outside.map((item) => item.voiceId), outside.map((item) => item.note), '和弦外音需要确认',
        `标注和弦 ${chord.label} 中存在未识别为和弦构成音的音符；经过音或辅助音可忽略此提示。`,
      ))
    }

    const present = new Set(active.map(({ note }) => pitchClass(note.midiNote)))
    const missing = chordTones.filter((tone) => !present.has(tone))
    if (missing.length > 0) {
      diagnostics.push(diagnostic(
        'chord-completeness', 'warning', chord.startTick, chord.startTick + chord.durationTicks,
        active.map((item) => item.voiceId), active.map((item) => item.note), '和弦构成音不完整',
        `${chord.label} 缺少 ${missing.length} 个标注和弦的构成音。`,
      ))
    }

    const bass = active.find((item) => item.voiceId === 'bass')
    const expectedBass = chordTones[Math.min(chord.inversion, chordTones.length - 1)]
    if (bass && pitchClass(bass.note.midiNote) !== expectedBass) {
      diagnostics.push(diagnostic(
        'chord-inversion', 'error', chord.startTick, chord.startTick + chord.durationTicks,
        ['bass'], [bass.note], '低音与转位不一致', `${chord.label} 的低音不符合当前转位标记。`,
      ))
    }

    const key = keyAtTick(project.keyEvents, chord.startTick)
    const leadingTone = pitchClass(key.tonic + 11)
    const leadingNotes = active.filter(({ note }) => pitchClass(note.midiNote) === leadingTone)
    if (leadingNotes.length > 1) {
      diagnostics.push(diagnostic(
        'leading-tone-doubling', 'error', chord.startTick, chord.startTick + chord.durationTicks,
        leadingNotes.map((item) => item.voiceId), leadingNotes.map((item) => item.note), '重复导音',
        '四部和声中通常不应重复调内导音。',
      ))
    }
  })

  return diagnostics
}

export function checkHarmony(project: ProjectDocument): HarmonyCheckResult {
  const slices = buildSlices(project)
  const diagnostics = [
    ...checkRanges(project),
    ...checkMelodicMotion(project),
    ...checkVerticalSlices(slices),
    ...checkVoiceLeading(slices),
  ]
  const skippedRuleIds = project.chords.length === 0 ? CHORD_RULE_IDS : []
  if (project.chords.length > 0) diagnostics.push(...checkChordRules(project, slices))

  const unique = new Map(diagnostics.map((item) => [item.id, item]))
  return {
    diagnostics: [...unique.values()].sort((a, b) => a.tick - b.tick || a.severity.localeCompare(b.severity)),
    skippedRuleIds,
  }
}
