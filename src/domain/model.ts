export const PROJECT_SCHEMA_VERSION = 1
export const PPQ = 960

export type VoiceId = 'soprano' | 'alto' | 'tenor' | 'bass'
export type KeyMode = 'major' | 'minor'
export type ChordQuality =
  | 'major'
  | 'minor'
  | 'diminished'
  | 'augmented'
  | 'dominant7'
  | 'major7'
  | 'minor7'
  | 'halfDiminished7'
  | 'diminished7'

export interface NoteEvent {
  id: string
  startTick: number
  durationTicks: number
  midiNote: number
  velocity: number
  locked: boolean
}

export interface VoiceTrack {
  id: VoiceId
  name: string
  shortName: 'S' | 'A' | 'T' | 'B'
  notes: NoteEvent[]
  visible: boolean
  muted: boolean
  solo: boolean
  locked: boolean
  volume: number
  pan: number
  program: number
}

export interface TempoEvent {
  id: string
  tick: number
  bpm: number
}

export interface MeterEvent {
  id: string
  tick: number
  numerator: number
  denominator: 2 | 4 | 8 | 16
}

export interface KeyEvent {
  id: string
  tick: number
  tonic: number
  mode: KeyMode
}

export interface ChordEvent {
  id: string
  startTick: number
  durationTicks: number
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7
  accidental: -2 | -1 | 0 | 1 | 2
  quality: ChordQuality
  inversion: 0 | 1 | 2 | 3
  label: string
  locked: boolean
}

export interface EditableRange {
  id: string
  voiceIds: VoiceId[]
  fromTick: number
  toTick: number
  editable: boolean
}

export interface ProjectDocument {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  id: string
  title: string
  author: string
  notes: string
  createdAt: string
  updatedAt: string
  ppq: typeof PPQ
  lengthTicks: number
  tempoEvents: TempoEvent[]
  meterEvents: MeterEvent[]
  keyEvents: KeyEvent[]
  tracks: VoiceTrack[]
  chords: ChordEvent[]
  exercise: {
    instructions: string
    editableRanges: EditableRange[]
  }
  audio: {
    masterVolume: number
    soundFont: {
      kind: 'default' | 'user'
      name: string
      path?: string
      hash?: string
    }
  }
}

export const VOICE_ORDER: VoiceId[] = ['soprano', 'alto', 'tenor', 'bass']

export const VOICE_CONFIG: Record<VoiceId, {
  name: string
  shortName: VoiceTrack['shortName']
  min: number
  max: number
  color: string
  darkColor: string
}> = {
  soprano: { name: '女高音', shortName: 'S', min: 60, max: 81, color: '#c6533d', darkColor: '#873424' },
  alto: { name: '女低音', shortName: 'A', min: 55, max: 74, color: '#2d7a68', darkColor: '#1f5549' },
  tenor: { name: '男高音', shortName: 'T', min: 48, max: 67, color: '#3f6fa8', darkColor: '#2b4f79' },
  bass: { name: '男低音', shortName: 'B', min: 40, max: 60, color: '#87643d', darkColor: '#60472b' },
}

export const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function createTrack(id: VoiceId, program: number): VoiceTrack {
  const config = VOICE_CONFIG[id]
  return {
    id,
    name: config.name,
    shortName: config.shortName,
    notes: [],
    visible: true,
    muted: false,
    solo: false,
    locked: false,
    volume: 0.82,
    pan: id === 'soprano' ? 0.2 : id === 'alto' ? 0.08 : id === 'tenor' ? -0.08 : -0.2,
    program,
  }
}

export function createEmptyProject(title = '未命名练习'): ProjectDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId('project'),
    title,
    author: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
    ppq: PPQ,
    lengthTicks: PPQ * 4 * 16,
    tempoEvents: [{ id: createId('tempo'), tick: 0, bpm: 80 }],
    meterEvents: [{ id: createId('meter'), tick: 0, numerator: 4, denominator: 4 }],
    keyEvents: [{ id: createId('key'), tick: 0, tonic: 0, mode: 'major' }],
    tracks: [
      createTrack('soprano', 52),
      createTrack('alto', 52),
      createTrack('tenor', 52),
      createTrack('bass', 53),
    ],
    chords: [],
    exercise: { instructions: '', editableRanges: [] },
    audio: {
      masterVolume: 0.78,
      soundFont: { kind: 'default', name: 'SATB Master 默认音色' },
    },
  }
}

export function cloneProject(project: ProjectDocument): ProjectDocument {
  return structuredClone(project)
}

export function getTrack(project: ProjectDocument, voiceId: VoiceId) {
  const track = project.tracks.find((item) => item.id === voiceId)
  if (!track) throw new Error(`工程缺少声部：${voiceId}`)
  return track
}

export function normalizeProject(project: ProjectDocument): ProjectDocument {
  const normalized = cloneProject(project)
  normalized.tempoEvents.sort((a, b) => a.tick - b.tick)
  normalized.meterEvents.sort((a, b) => a.tick - b.tick)
  normalized.keyEvents.sort((a, b) => a.tick - b.tick)
  normalized.chords.sort((a, b) => a.startTick - b.startTick)
  normalized.tracks.forEach((track) => track.notes.sort((a, b) => a.startTick - b.startTick || a.midiNote - b.midiNote))
  return normalized
}

export function validateProject(value: unknown): value is ProjectDocument {
  if (!value || typeof value !== 'object') return false
  const project = value as Partial<ProjectDocument>
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION || project.ppq !== PPQ) return false
  if (typeof project.id !== 'string' || typeof project.title !== 'string') return false
  if (!Array.isArray(project.tracks) || project.tracks.length !== 4) return false
  if (!Array.isArray(project.tempoEvents) || !Array.isArray(project.meterEvents) || !Array.isArray(project.keyEvents)) return false
  if (!Array.isArray(project.chords) || typeof project.lengthTicks !== 'number') return false

  return VOICE_ORDER.every((voiceId) => project.tracks?.some((track) => track.id === voiceId && Array.isArray(track.notes)))
}
