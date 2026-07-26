import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BellRing,
  Clipboard,
  Copy,
  Download,
  Eraser,
  FilePlus2,
  FolderOpen,
  Magnet,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  Repeat2,
  Redo2,
  Save,
  SaveAll,
  Settings2,
  SkipBack,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
  X,
  Scissors,
} from 'lucide-react'
import { audioEngine, type AudioEngineState } from './audio/audioEngine'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { IconButton } from './components/IconButton'
import { Inspector } from './components/Inspector'
import { PanelResizeHandle } from './components/PanelResizeHandle'
import { PianoRoll, type EditorTool } from './components/PianoRoll'
import { ShortcutSettings } from './components/ShortcutSettings'
import { TrackSidebar } from './components/TrackSidebar'
import { defaultChordAnalysisAtTick } from './domain/chords'
import {
  addChordRegion,
  addNote,
  deleteChordRegions,
  deleteNotes,
  replaceProject,
  setChordTrackState,
  splitChordRegion,
  splitNote,
  transformChordRegions,
  transformNotes,
  updateChordRegion,
  updateNote,
  type ChordRegionPatch,
} from './domain/editing'
import { checkHarmony, type HarmonyDiagnostic } from './domain/harmony'
import { buildMidi, midiFileName } from './domain/midi'
import {
  createEmptyProject,
  createId,
  getTrack,
  normalizeProject,
  type ChordAnalysis,
  type ChordRegion,
  type EditableRange,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from './domain/model'
import { buildMeasures, eventAtTick, formatPosition, ticksPerBeat } from './domain/time'
import { DEFAULT_PANEL_SIZES, PANEL_RESIZER_SIZE, usePanelLayout } from './hooks/usePanelLayout'
import { useHarmonyRuleSettings } from './hooks/useHarmonyRuleSettings'
import { useProjectHistory } from './hooks/useProjectHistory'
import { useShortcutBindings } from './hooks/useShortcutBindings'
import { commandForKeyboardEvent, formatShortcutBinding } from './shortcuts/shortcutRegistry'
import {
  autosaveProject,
  discardRecovery,
  exportMidi,
  findRecovery,
  loadDefaultSoundFont,
  loadPreparedDesktopSoundFont,
  loadUserSoundFont,
  MAX_SOUNDFONT_BYTES,
  openProject,
  readSoundFontBuffer,
  saveProject,
  type SoundFontLoadProgress,
} from './services/desktop'

interface ClipboardNote {
  voiceId: VoiceId
  note: NoteEvent
  offset: number
}

interface ClipboardChord {
  region: ChordRegion
  offset: number
}

type ClipboardPayload =
  | { kind: 'notes'; items: ClipboardNote[] }
  | { kind: 'chords'; items: ClipboardChord[] }

type EditorDomain = 'notes' | 'chords'

interface ConfirmationState {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
}

const GRID_OPTIONS = [
  { label: '1/4', ticks: 960 },
  { label: '1/8', ticks: 480 },
  { label: '1/16', ticks: 240 },
  { label: '1/32', ticks: 120 },
]

function soundFontId(soundFont: ProjectDocument['audio']['soundFont']) {
  return soundFont.kind === 'default' ? 'default' : `user:${soundFont.hash ?? soundFont.path ?? soundFont.name}`
}

function formatByteSize(bytes: number) {
  const gibibyte = 1024 * 1024 * 1024
  if (bytes >= gibibyte) return `${(bytes / gibibyte).toFixed(1)} GB`
  return `${Math.ceil(bytes / (1024 * 1024))} MB`
}

function soundFontProgressMessage(progress: SoundFontLoadProgress) {
  if (progress.phase === 'parsing') return '正在解析 SoundFont'
  const percent = progress.totalBytes > 0 ? Math.floor(progress.completedBytes / progress.totalBytes * 100) : 0
  return `正在读取并校验 SoundFont ${percent}%`
}

async function ensureSoundFontLoaded(
  soundFontConfig: ProjectDocument['audio']['soundFont'],
  generation: number,
  onProgress?: (progress: SoundFontLoadProgress) => void,
) {
  const targetSoundFontId = soundFontId(soundFontConfig)
  if (audioEngine.isSoundFontLoaded(targetSoundFontId)) return 'already-loaded' as const
  if (!audioEngine.isSoundFontChangeCurrent(generation)) return
  // 大音色加载前先释放旧音色，避免旧采样与新文件缓冲区同时占据峰值内存。
  if (!await audioEngine.unloadSoundFont(generation)) return
  const soundFont = soundFontConfig.kind === 'default'
    ? await loadDefaultSoundFont(onProgress)
    : await loadUserSoundFont(soundFontConfig.path ?? '', onProgress)
  if (!audioEngine.isSoundFontChangeCurrent(generation)) return
  if (soundFontConfig.kind === 'user' && soundFontConfig.hash && soundFont.hash !== soundFontConfig.hash) {
    throw new Error('工程引用的 SoundFont 文件已被替换')
  }
  onProgress?.({
    phase: 'parsing',
    completedBytes: soundFont.sizeBytes,
    totalBytes: soundFont.sizeBytes,
    fileSizeBytes: soundFont.sizeBytes,
    requiredMemoryBytes: soundFont.requiredMemoryBytes,
    availableMemoryBytes: soundFont.availableMemoryBytes,
  })
  if (!await audioEngine.loadSoundFont(soundFont.buffer, targetSoundFontId, generation)) return
  return soundFont
}

function App() {
  const initialProject = useMemo(() => createEmptyProject(), [])
  const history = useProjectHistory(initialProject)
  const project = history.project
  const [filePath, setFilePath] = useState<string>()
  const [activeVoice, setActiveVoice] = useState<VoiceId>('soprano')
  const [tool, setTool] = useState<EditorTool>('select')
  const [editorDomain, setEditorDomain] = useState<EditorDomain>('notes')
  const [toolModifiers, setToolModifiers] = useState({ control: false, alt: false })
  const [editorInteractionActive, setEditorInteractionActive] = useState(false)
  const [cancelEditorRequest, setCancelEditorRequest] = useState(0)
  const [gridTicks, setGridTicks] = useState(480)
  const [pixelsPerBeat, setPixelsPerBeat] = useState(72)
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [selectedChordIds, setSelectedChordIds] = useState<Set<string>>(new Set())
  const [chordBrush, setChordBrush] = useState<ChordAnalysis>(() => defaultChordAnalysisAtTick(initialProject, 0))
  const [playheadTick, setPlayheadTick] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [metronomeEnabled, setMetronomeEnabled] = useState(false)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [loopStartTick, setLoopStartTick] = useState(0)
  const [loopEndTick, setLoopEndTick] = useState(initialProject.ppq * 4)
  const [audioState, setAudioState] = useState<AudioEngineState>('idle')
  const [audioMessage, setAudioMessage] = useState('尚未启动音频')
  const [audioLevel, setAudioLevel] = useState(0)
  const [soundFontProgress, setSoundFontProgress] = useState<SoundFontLoadProgress>()
  const [soundFontSizeBytes, setSoundFontSizeBytes] = useState<number>()
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [confirmation, setConfirmation] = useState<ConfirmationState>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const clipboardRef = useRef<ClipboardPayload | undefined>(undefined)
  const confirmationResolverRef = useRef<((confirmed: boolean) => void) | undefined>(undefined)
  const recoveryCheckedRef = useRef(false)
  const defaultSoundFontRequestedRef = useRef(false)
  const playSessionRef = useRef(0)
  const panelLayout = usePanelLayout()
  const shortcutSettings = useShortcutBindings()
  const harmonyRuleSettings = useHarmonyRuleSettings()
  const effectiveTool: EditorTool = tool === 'select'
    ? toolModifiers.alt ? 'eraser' : toolModifiers.control ? 'pencil' : 'select'
    : tool

  const harmonyResult = useMemo(
    () => checkHarmony(project, harmonyRuleSettings.severities),
    [harmonyRuleSettings.severities, project],
  )
  const selectedNote = useMemo(() => {
    const id = selectedNoteIds.values().next().value as string | undefined
    if (!id) return undefined
    for (const track of project.tracks) {
      const note = track.notes.find((candidate) => candidate.id === id)
      if (note) return { voiceId: track.id, note }
    }
    return undefined
  }, [project, selectedNoteIds])
  const selectedChord = selectedChordIds.size === 1
    ? project.chordTrack.regions.find((chord) => chord.id === selectedChordIds.values().next().value)
    : undefined

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => current === message ? undefined : current), 2800)
  }, [])

  const reportSoundFontProgress = useCallback((progress: SoundFontLoadProgress) => {
    setSoundFontProgress(progress)
    setAudioState('loading')
    setAudioMessage(soundFontProgressMessage(progress))
  }, [])

  const requestConfirmation = useCallback((options: ConfirmationState) => new Promise<boolean>((resolve) => {
    confirmationResolverRef.current?.(false)
    confirmationResolverRef.current = resolve
    setConfirmation(options)
  }), [])

  const answerConfirmation = useCallback((confirmed: boolean) => {
    const resolve = confirmationResolverRef.current
    confirmationResolverRef.current = undefined
    setConfirmation(undefined)
    resolve?.(confirmed)
  }, [])

  useEffect(() => () => {
    confirmationResolverRef.current?.(false)
  }, [])

  useEffect(() => {
    audioEngine.onState((state, message) => {
      setAudioState(state)
      if (message) setAudioMessage(message)
    })
    return () => audioEngine.stop(false)
  }, [])

  useEffect(() => {
    if (defaultSoundFontRequestedRef.current) return
    defaultSoundFontRequestedRef.current = true
    const generation = audioEngine.beginSoundFontChange()
    const reportProgress = (progress: SoundFontLoadProgress) => {
      if (audioEngine.isSoundFontChangeCurrent(generation)) reportSoundFontProgress(progress)
    }
    void ensureSoundFontLoaded(initialProject.audio.soundFont, generation, reportProgress)
      .then((soundFont) => {
        if (soundFont && soundFont !== 'already-loaded') setSoundFontSizeBytes(soundFont.sizeBytes)
      })
      .catch(async (error) => {
        if (!audioEngine.isSoundFontChangeCurrent(generation)) return
        await audioEngine.unloadSoundFont()
        setSoundFontProgress(undefined)
        console.warn('启动时加载默认 SoundFont 失败，将使用回退音色。', error)
      })
      .finally(() => {
        if (audioEngine.isSoundFontChangeCurrent(generation)) setSoundFontProgress(undefined)
      })
  }, [initialProject.audio.soundFont, reportSoundFontProgress])

  useEffect(() => {
    const controls = window.desktop?.windowControls
    if (!controls) return
    void controls.isMaximized().then(setIsWindowMaximized)
    return controls.onMaximizedChange(setIsWindowMaximized)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setAudioLevel(audioEngine.getOutputLevel()), 50)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (recoveryCheckedRef.current) return
    recoveryCheckedRef.current = true
    void findRecovery().then(async (recovery) => {
      if (!recovery) return
      const savedAt = new Date(recovery.savedAt).toLocaleString('zh-CN')
      const source = recovery.sourcePath ? `\n原工程：${recovery.sourcePath}` : ''
      const shouldRecover = await requestConfirmation({
        title: '恢复未保存内容',
        message: `发现 ${savedAt} 的自动恢复内容。${source}\n\n是否恢复？`,
        confirmLabel: '恢复内容',
        cancelLabel: '不恢复',
      })
      if (shouldRecover) {
        history.recover(recovery.project)
        setFilePath(recovery.sourcePath)
        showNotice('已恢复未保存内容')
      } else {
        await discardRecovery()
      }
    }).catch((error) => console.warn('读取自动恢复文件失败', error))
  }, [history, requestConfirmation, showNotice])

  useEffect(() => {
    if (!history.isDirty) return
    const timer = window.setTimeout(() => {
      void autosaveProject(project, filePath).catch((error) => console.warn('自动恢复保存失败', error))
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [filePath, history.isDirty, project])

  const commitResult = useCallback((result: { project: ProjectDocument; error?: string }) => {
    if (result.error) {
      showNotice(result.error)
      return false
    }
    if (result.project !== project) history.commit(result.project)
    return true
  }, [history, project, showNotice])

  const handleAddNote = useCallback((voiceId: VoiceId, tick: number, midiNote: number, durationTicks = gridTicks) => {
    const result = addNote(project, voiceId, {
      id: createId('note'),
      startTick: tick,
      durationTicks,
      midiNote,
      velocity: 88,
      locked: false,
    })
    if (commitResult(result)) {
      const note = getTrack(result.project, voiceId).notes.find((candidate) => candidate.startTick === tick && candidate.midiNote === midiNote)
      if (note) setSelectedNoteIds(new Set([note.id]))
      setSelectedChordIds(new Set())
      void audioEngine.previewNote(midiNote, voiceId)
    }
  }, [commitResult, gridTicks, project])

  const handleMoveNotes = useCallback((noteIds: Set<string>, tickDelta: number, pitchDelta: number) => {
    commitResult(transformNotes(project, noteIds, (note) => ({
      ...note,
      startTick: note.startTick + tickDelta,
      midiNote: note.midiNote + pitchDelta,
    })))
  }, [commitResult, project])

  const handleSelectNotes = useCallback((noteIds: Set<string>) => {
    setSelectedNoteIds(noteIds)
    if (noteIds.size > 0) {
      setEditorDomain('notes')
      setSelectedChordIds(new Set())
    }
    if (noteIds.size !== 1) return
    const noteId = noteIds.values().next().value
    for (const track of project.tracks) {
      const note = track.notes.find((candidate) => candidate.id === noteId)
      if (note) {
        void audioEngine.previewNote(note.midiNote, track.id)
        return
      }
    }
  }, [project])

  const handleSelectChords = useCallback((chordIds: Set<string>) => {
    setSelectedChordIds(chordIds)
    if (chordIds.size > 0) {
      setEditorDomain('chords')
      setSelectedNoteIds(new Set())
    }
    if (chordIds.size !== 1) return
    const chord = project.chordTrack.regions.find((candidate) => candidate.id === chordIds.values().next().value)
    if (chord) setChordBrush(chord.analysis)
  }, [project.chordTrack.regions])

  const handlePreviewNote = useCallback((voiceId: VoiceId, midiNote: number) => {
    void audioEngine.previewNote(midiNote, voiceId)
  }, [])

  const handleSplitNote = useCallback((voiceId: VoiceId, noteId: string, splitTick: number) => {
    commitResult(splitNote(project, voiceId, noteId, splitTick))
  }, [commitResult, project])

  const handleUpdateNote = useCallback((voiceId: VoiceId, noteId: string, patch: Partial<NoteEvent>) => {
    const result = updateNote(project, voiceId, noteId, patch)
    if (commitResult(result) && typeof patch.midiNote === 'number' && selectedNoteIds.size === 1) {
      void audioEngine.previewNote(patch.midiNote, voiceId)
    }
  }, [commitResult, project, selectedNoteIds.size])

  const handleDeleteNotes = useCallback((noteIds: Set<string>) => {
    if (commitResult(deleteNotes(project, noteIds))) setSelectedNoteIds(new Set())
  }, [commitResult, project])

  const handleUpdateTrack = useCallback((voiceId: VoiceId, patch: Partial<ProjectDocument['tracks'][number]>) => {
    history.commit(replaceProject(project, (draft) => Object.assign(getTrack(draft, voiceId), patch)))
  }, [history, project])

  const handleUpdateProject = useCallback((patch: Partial<Pick<ProjectDocument, 'title' | 'author' | 'notes' | 'lengthTicks'>>) => {
    if (patch.lengthTicks !== undefined) {
      const latestEvent = Math.max(
        ...project.tracks.flatMap((track) => track.notes.map((note) => note.startTick + note.durationTicks)),
        ...project.chordTrack.regions.map((chord) => chord.startTick + chord.durationTicks),
        0,
      )
      if (patch.lengthTicks < latestEvent) {
        showNotice('工程长度不能短于现有音符或和弦')
        return
      }
    }
    history.commit(replaceProject(project, (draft) => Object.assign(draft, patch)))
  }, [history, project, showNotice])

  const handleUpdateInstructions = useCallback((instructions: string) => {
    history.commit(replaceProject(project, (draft) => {
      draft.exercise.instructions = instructions
    }))
  }, [history, project])

  const handleAddEditableRange = useCallback(() => {
    const measure = buildMeasures(project).find((item) => playheadTick >= item.startTick && playheadTick < item.endTick)
    const range: EditableRange = {
      id: createId('range'),
      voiceIds: [activeVoice],
      fromTick: measure?.startTick ?? playheadTick,
      toTick: measure?.endTick ?? Math.min(project.lengthTicks, playheadTick + project.ppq * 4),
      editable: false,
    }
    history.commit(replaceProject(project, (draft) => {
      draft.exercise.editableRanges.push(range)
    }))
  }, [activeVoice, history, playheadTick, project])

  const handleUpdateEditableRange = useCallback((rangeId: string, patch: Partial<EditableRange>) => {
    const current = project.exercise.editableRanges.find((range) => range.id === rangeId)
    if (!current) return
    const updated = { ...current, ...patch, editable: false }
    if (updated.voiceIds.length === 0) return showNotice('锁定区间至少要包含一个声部')
    if (!Number.isFinite(updated.fromTick) || !Number.isFinite(updated.toTick) || updated.fromTick < 0 || updated.toTick <= updated.fromTick || updated.toTick > project.lengthTicks) {
      return showNotice('锁定区间的时间范围无效')
    }
    history.commit(replaceProject(project, (draft) => {
      draft.exercise.editableRanges = draft.exercise.editableRanges.map((range) => range.id === rangeId ? updated : range)
    }))
  }, [history, project, showNotice])

  const handleDeleteEditableRange = useCallback((rangeId: string) => {
    history.commit(replaceProject(project, (draft) => {
      draft.exercise.editableRanges = draft.exercise.editableRanges.filter((range) => range.id !== rangeId)
    }))
  }, [history, project])

  const handleAddChord = useCallback((tick: number, durationTicks: number) => {
    const chord: ChordRegion = {
      id: createId('chord'),
      startTick: tick,
      durationTicks,
      analysis: chordBrush,
      locked: false,
    }
    const result = addChordRegion(project, chord)
    if (!commitResult(result)) return undefined
    setSelectedChordIds(new Set([chord.id]))
    setSelectedNoteIds(new Set())
    return chord.id
  }, [chordBrush, commitResult, project])

  const handleUpdateChord = useCallback((chordId: string, patch: ChordRegionPatch) => {
    const result = updateChordRegion(project, chordId, patch)
    if (!commitResult(result)) return
    const updated = result.project.chordTrack.regions.find((region) => region.id === chordId)
    if (updated && patch.analysis) setChordBrush(updated.analysis)
  }, [commitResult, project])

  const handleMoveChords = useCallback((chordIds: Set<string>, tickDelta: number) => {
    commitResult(transformChordRegions(project, chordIds, (region) => ({
      ...region,
      startTick: region.startTick + tickDelta,
    })))
  }, [commitResult, project])

  const handleDeleteChords = useCallback((chordIds: Set<string>) => {
    if (commitResult(deleteChordRegions(project, chordIds))) setSelectedChordIds(new Set())
  }, [commitResult, project])

  const handleSplitChord = useCallback((chordId: string, splitTick: number) => {
    commitResult(splitChordRegion(project, chordId, splitTick))
  }, [commitResult, project])

  const handleUpdateChordBrush = useCallback((patch: Partial<ChordAnalysis>) => {
    setChordBrush((current) => ({ ...current, ...patch }))
  }, [])

  const handleUpdateChordTrack = useCallback((patch: Partial<Pick<ProjectDocument['chordTrack'], 'visible' | 'locked' | 'displayMode'>>) => {
    commitResult(setChordTrackState(project, patch))
  }, [commitResult, project])

  const timingTick = useCallback((type: 'tempo' | 'meter' | 'key') => {
    if (type === 'tempo') return Math.round(playheadTick / gridTicks) * gridTicks
    return buildMeasures(project).find((measure) => playheadTick >= measure.startTick && playheadTick < measure.endTick)?.startTick ?? 0
  }, [gridTicks, playheadTick, project])

  const handleAddTimingEvent = useCallback((type: 'tempo' | 'meter' | 'key') => {
    const tick = timingTick(type)
    if (type === 'key' && project.chordTrack.regions.some((region) => (
      region.startTick < tick && region.startTick + region.durationTicks > tick
    ))) return showNotice('调性变化不能插入和弦区域内部，请先切分和弦')
    const source = type === 'tempo' ? project.tempoEvents : type === 'meter' ? project.meterEvents : project.keyEvents
    if (source.some((event) => event.tick === tick)) return showNotice('该位置已经存在同类变化事件')
    history.commit(replaceProject(project, (draft) => {
      if (type === 'tempo') {
        const current = eventAtTick(project.tempoEvents, tick)
        draft.tempoEvents.push({ id: createId('tempo'), tick, bpm: current.bpm })
        draft.tempoEvents.sort((a, b) => a.tick - b.tick)
      } else if (type === 'meter') {
        const current = eventAtTick(project.meterEvents, tick)
        draft.meterEvents.push({ id: createId('meter'), tick, numerator: current.numerator, denominator: current.denominator })
        draft.meterEvents.sort((a, b) => a.tick - b.tick)
      } else {
        const current = eventAtTick(project.keyEvents, tick)
        draft.keyEvents.push({ id: createId('key'), tick, tonic: current.tonic, mode: current.mode })
        draft.keyEvents.sort((a, b) => a.tick - b.tick)
      }
    }))
  }, [history, project, showNotice, timingTick])

  const handleUpdateTimingEvent = useCallback((type: 'tempo' | 'meter' | 'key', id: string, patch: Record<string, string | number>) => {
    history.commit(replaceProject(project, (draft) => {
      if (type === 'tempo') {
        draft.tempoEvents = draft.tempoEvents.map((event) => event.id === id ? { ...event, bpm: Math.max(20, Math.min(300, Number(patch.bpm))) } : event)
      } else if (type === 'meter') {
        const denominator = [2, 4, 8, 16].includes(Number(patch.denominator)) ? Number(patch.denominator) as 2 | 4 | 8 | 16 : 4
        draft.meterEvents = draft.meterEvents.map((event) => event.id === id ? {
          ...event,
          numerator: Math.max(1, Math.min(12, Number(patch.numerator))),
          denominator,
        } : event)
      } else {
        draft.keyEvents = draft.keyEvents.map((event) => event.id === id ? {
          ...event,
          tonic: Math.max(0, Math.min(11, Number(patch.tonic ?? event.tonic))),
          mode: patch.mode === 'minor' ? 'minor' : 'major',
        } : event)
      }
    }))
  }, [history, project])

  const handleDeleteTimingEvent = useCallback((type: 'tempo' | 'meter' | 'key', id: string) => {
    const source = type === 'tempo' ? project.tempoEvents : type === 'meter' ? project.meterEvents : project.keyEvents
    if (source.find((event) => event.id === id)?.tick === 0) return showNotice('起始事件不能删除')
    history.commit(replaceProject(project, (draft) => {
      if (type === 'tempo') draft.tempoEvents = draft.tempoEvents.filter((event) => event.id !== id)
      if (type === 'meter') draft.meterEvents = draft.meterEvents.filter((event) => event.id !== id)
      if (type === 'key') draft.keyEvents = draft.keyEvents.filter((event) => event.id !== id)
    }))
  }, [history, project, showNotice])

  const handleNew = useCallback(async () => {
    if (history.isDirty && !await requestConfirmation({
      title: '新建工程',
      message: '当前工程尚未保存，仍要新建吗？',
      confirmLabel: '继续新建',
      cancelLabel: '取消',
    })) return
    audioEngine.stop()
    history.load(createEmptyProject())
    setFilePath(undefined)
    setSelectedNoteIds(new Set())
    setSelectedChordIds(new Set())
    setChordBrush(defaultChordAnalysisAtTick(initialProject, 0))
    setPlayheadTick(0)
    setLoopStartTick(0)
    setLoopEndTick(initialProject.ppq * 4)
  }, [history, initialProject, requestConfirmation])

  const handleOpen = useCallback(async () => {
    if (history.isDirty && !await requestConfirmation({
      title: '打开工程',
      message: '当前工程尚未保存，仍要打开其他工程吗？',
      confirmLabel: '继续打开',
      cancelLabel: '取消',
    })) return
    try {
      const result = await openProject()
      if (!result) return
      audioEngine.stop()
      history.load(result.project)
      setFilePath(result.filePath)
      setSelectedNoteIds(new Set())
      setSelectedChordIds(new Set())
      setChordBrush(defaultChordAnalysisAtTick(result.project, 0))
      setPlayheadTick(0)
      setLoopStartTick(0)
      setLoopEndTick(Math.min(result.project.lengthTicks, result.project.ppq * 4))
      showNotice('工程已打开')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '打开工程失败')
    }
  }, [history, requestConfirmation, showNotice])

  const handleSave = useCallback(async (forceDialog = false) => {
    try {
      const result = await saveProject(normalizeProject(project), filePath, forceDialog)
      if (result.canceled) return
      setFilePath(result.filePath ?? filePath)
      history.markSaved()
      showNotice('工程已保存')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '保存工程失败')
    }
  }, [filePath, history, project, showNotice])

  const handleExportMidi = useCallback(async () => {
    try {
      const bytes = buildMidi(project, true)
      const result = await exportMidi(bytes, midiFileName(project))
      if (!result.canceled) showNotice('MIDI 已导出')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'MIDI 导出失败')
    }
  }, [project, showNotice])

  const handleChooseSoundFont = useCallback(async () => {
    let generation: number | undefined
    let reportProgress = reportSoundFontProgress
    const beginChange = () => {
      generation = audioEngine.beginSoundFontChange()
      reportProgress = (progress) => {
        if (generation !== undefined && audioEngine.isSoundFontChangeCurrent(generation)) {
          reportSoundFontProgress(progress)
        }
      }
      return generation
    }
    try {
      let name: string
      let path: string | undefined
      let hash: string | undefined
      let buffer: ArrayBuffer
      let sizeBytes: number
      if (window.desktop) {
        const result = await window.desktop.soundFont.open()
        if (result.canceled) return
        if (
          !result.name || !result.token || !result.sourceUrl || result.sizeBytes === undefined
          || result.requiredMemoryBytes === undefined || result.availableMemoryBytes === undefined
        ) throw new Error('SoundFont 加载信息不完整')
        const change = beginChange()
        if (!await audioEngine.unloadSoundFont(change)) {
          await window.desktop.soundFont.release(result.token)
          return
        }
        const loaded = await loadPreparedDesktopSoundFont({
          name: result.name,
          filePath: result.filePath,
          token: result.token,
          sourceUrl: result.sourceUrl,
          sizeBytes: result.sizeBytes,
          requiredMemoryBytes: result.requiredMemoryBytes,
          availableMemoryBytes: result.availableMemoryBytes,
        }, reportProgress)
        name = loaded.name
        path = loaded.filePath
        hash = loaded.hash
        buffer = loaded.buffer
        sizeBytes = loaded.sizeBytes
      } else {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.sf2,.sf3'
        const file = await new Promise<File | undefined>((resolve) => {
          input.onchange = () => resolve(input.files?.[0])
          input.click()
        })
        if (!file) return
        if (file.size > MAX_SOUNDFONT_BYTES) throw new Error('SoundFont 文件超过 2 GB 限制')
        name = file.name
        sizeBytes = file.size
        const change = beginChange()
        if (!await audioEngine.unloadSoundFont(change)) return
        const sourceUrl = URL.createObjectURL(file)
        try {
          buffer = await readSoundFontBuffer(sourceUrl, file.size, (completedBytes) => {
            reportProgress({
              phase: 'loading',
              completedBytes,
              totalBytes: file.size,
              fileSizeBytes: file.size,
            })
          })
        } finally {
          URL.revokeObjectURL(sourceUrl)
        }
      }

      if (generation === undefined || !audioEngine.isSoundFontChangeCurrent(generation)) return
      const selection = { kind: 'user' as const, name, path, hash }
      reportProgress({
        phase: 'parsing',
        completedBytes: sizeBytes,
        totalBytes: sizeBytes,
        fileSizeBytes: sizeBytes,
      })
      if (!await audioEngine.loadSoundFont(buffer, soundFontId(selection), generation)) return
      history.commit(replaceProject(project, (draft) => {
        draft.audio.soundFont = selection
      }))
      setSoundFontSizeBytes(sizeBytes)
      showNotice('SoundFont 已加载')
    } catch (error) {
      if (generation === undefined || audioEngine.isSoundFontChangeCurrent(generation)) {
        showNotice(error instanceof Error ? error.message : 'SoundFont 加载失败')
      }
    } finally {
      if (generation !== undefined && audioEngine.isSoundFontChangeCurrent(generation)) {
        setSoundFontProgress(undefined)
      }
    }
  }, [history, project, reportSoundFontProgress, showNotice])

  const handleUseDefaultSoundFont = useCallback(async () => {
    const generation = audioEngine.beginSoundFontChange()
    const reportProgress = (progress: SoundFontLoadProgress) => {
      if (audioEngine.isSoundFontChangeCurrent(generation)) reportSoundFontProgress(progress)
    }
    const defaultSoundFont = { kind: 'default' as const, name: 'SATB Master 默认音色' }
    history.commit(replaceProject(project, (draft) => {
      draft.audio.soundFont = defaultSoundFont
    }))
    try {
      const soundFont = await ensureSoundFontLoaded(defaultSoundFont, generation, reportProgress)
      if (!soundFont) return
      if (soundFont !== 'already-loaded') setSoundFontSizeBytes(soundFont.sizeBytes)
      showNotice('默认音色已加载')
    } catch (error) {
      if (audioEngine.isSoundFontChangeCurrent(generation)) {
        showNotice(error instanceof Error ? error.message : '默认音色加载失败')
      }
    } finally {
      if (audioEngine.isSoundFontChangeCurrent(generation)) setSoundFontProgress(undefined)
    }
  }, [history, project, reportSoundFontProgress, showNotice])

  const handleStop = useCallback((returnToStart = false) => {
    playSessionRef.current += 1
    audioEngine.stop()
    setIsPlaying(false)
    if (returnToStart) setPlayheadTick(0)
  }, [])

  const handlePlay = useCallback(async () => {
    if (isPlaying) {
      handleStop()
      return
    }
    try {
      await audioEngine.resume()
      const soundFontConfig = project.audio.soundFont
      if (!audioEngine.isSoundFontLoaded(soundFontId(soundFontConfig))) {
        const generation = audioEngine.beginSoundFontChange()
        const reportProgress = (progress: SoundFontLoadProgress) => {
          if (audioEngine.isSoundFontChangeCurrent(generation)) reportSoundFontProgress(progress)
        }
        try {
          const soundFont = await ensureSoundFontLoaded(soundFontConfig, generation, reportProgress)
          if (!soundFont) return
          if (soundFont !== 'already-loaded') setSoundFontSizeBytes(soundFont.sizeBytes)
        } catch (error) {
          if (!audioEngine.isSoundFontChangeCurrent(generation)) return
          // 音源缺失、摘要变化或安装路径异常时清掉旧音色，防止误用上一个工程的音色。
          await audioEngine.unloadSoundFont()
          setSoundFontProgress(undefined)
          console.warn('工程 SoundFont 加载失败，继续使用回退音色。', error)
          showNotice(soundFontConfig.kind === 'default'
            ? '默认音色不可用，已切换到回退音色'
            : '工程引用的音色不可用，已切换到回退音色')
        } finally {
          if (audioEngine.isSoundFontChangeCurrent(generation)) setSoundFontProgress(undefined)
        }
      }
      const session = playSessionRef.current + 1
      playSessionRef.current = session
      setIsPlaying(true)
      const playSegment = async (segmentStart: number): Promise<void> => {
        await audioEngine.playProject(project, {
          startTick: segmentStart,
          endTick: loopEnabled ? loopEndTick : project.lengthTicks,
          metronome: metronomeEnabled,
          onPosition: setPlayheadTick,
          onStop: () => {
            if (playSessionRef.current !== session) return
            if (loopEnabled) {
              setPlayheadTick(loopStartTick)
              void playSegment(loopStartTick)
            } else {
              setIsPlaying(false)
            }
          },
        })
      }
      const requestedStart = playheadTick >= project.lengthTicks ? 0 : playheadTick
      const startTick = loopEnabled && (requestedStart < loopStartTick || requestedStart >= loopEndTick) ? loopStartTick : requestedStart
      await playSegment(startTick)
    } catch (error) {
      setIsPlaying(false)
      showNotice(error instanceof Error ? error.message : '播放失败')
    }
  }, [handleStop, isPlaying, loopEnabled, loopEndTick, loopStartTick, metronomeEnabled, playheadTick, project, reportSoundFontProgress, showNotice])

  const setLoopBoundary = useCallback((boundary: 'start' | 'end') => {
    const tick = Math.max(0, Math.min(project.lengthTicks, Math.round(playheadTick / gridTicks) * gridTicks))
    if (boundary === 'start') {
      if (tick >= loopEndTick) return showNotice('循环起点必须早于终点')
      setLoopStartTick(tick)
    } else {
      if (tick <= loopStartTick) return showNotice('循环终点必须晚于起点')
      setLoopEndTick(tick)
    }
  }, [gridTicks, loopEndTick, loopStartTick, playheadTick, project.lengthTicks, showNotice])

  const copySelection = useCallback(() => {
    if (editorDomain === 'chords') {
      const selected = project.chordTrack.regions.filter((region) => selectedChordIds.has(region.id))
      if (selected.length === 0) return showNotice('没有选中的和弦')
      const earliest = Math.min(...selected.map((region) => region.startTick))
      clipboardRef.current = {
        kind: 'chords',
        items: selected.map((region) => ({ region, offset: region.startTick - earliest })),
      }
      showNotice(`已复制 ${selected.length} 个和弦区域`)
      return
    }
    const selected: ClipboardNote[] = []
    let earliest = Number.POSITIVE_INFINITY
    project.tracks.forEach((track) => track.notes.forEach((note) => {
      if (selectedNoteIds.has(note.id)) {
        earliest = Math.min(earliest, note.startTick)
        selected.push({ voiceId: track.id, note, offset: 0 })
      }
    }))
    if (selected.length === 0) return showNotice('没有选中的音符')
    clipboardRef.current = {
      kind: 'notes',
      items: selected.map((item) => ({ ...item, offset: item.note.startTick - earliest })),
    }
    showNotice(`已复制 ${selected.length} 个音符`)
  }, [editorDomain, project, selectedChordIds, selectedNoteIds, showNotice])

  const pasteSelection = useCallback(() => {
    const payload = clipboardRef.current
    if (!payload) return showNotice('编辑器剪贴板为空')
    if (payload.kind === 'chords') {
      let nextProject = project
      const newIds = new Set<string>()
      for (const item of payload.items) {
        const id = createId('chord')
        const result = addChordRegion(nextProject, {
          ...item.region,
          id,
          startTick: playheadTick + item.offset,
          locked: false,
        })
        if (result.error) return showNotice(`粘贴失败：${result.error}`)
        nextProject = result.project
        newIds.add(id)
      }
      history.commit(nextProject)
      setEditorDomain('chords')
      setSelectedChordIds(newIds)
      setSelectedNoteIds(new Set())
      return
    }
    let nextProject = project
    const newIds = new Set<string>()
    for (const item of payload.items) {
      const id = createId('note')
      const result = addNote(nextProject, item.voiceId, {
        ...item.note,
        id,
        startTick: playheadTick + item.offset,
        locked: false,
      })
      if (result.error) return showNotice(`粘贴失败：${result.error}`)
      nextProject = result.project
      newIds.add(id)
    }
    history.commit(nextProject)
    setEditorDomain('notes')
    setSelectedNoteIds(newIds)
    setSelectedChordIds(new Set())
  }, [history, playheadTick, project, showNotice])

  const clearSelection = useCallback(() => {
    setSelectedNoteIds(new Set())
    setSelectedChordIds(new Set())
  }, [])

  const selectAllInEditorDomain = useCallback(() => {
    if (editorDomain === 'chords') {
      setSelectedChordIds(new Set(project.chordTrack.regions.map((region) => region.id)))
      setSelectedNoteIds(new Set())
      return
    }
    setSelectedNoteIds(new Set(project.tracks.filter((track) => track.visible).flatMap((track) => track.notes.map((note) => note.id))))
    setSelectedChordIds(new Set())
  }, [editorDomain, project])

  const cutSelection = useCallback(() => {
    if (editorDomain === 'chords') {
      const selected = project.chordTrack.regions.filter((region) => selectedChordIds.has(region.id))
      if (selected.length === 0) return showNotice('没有选中的和弦')
      const result = deleteChordRegions(project, selectedChordIds)
      const remaining = result.project.chordTrack.regions.filter((region) => selectedChordIds.has(region.id)).length
      if (result.error || remaining > 0) return showNotice(result.error ?? '选区包含锁定和弦，无法整体剪切')
      const earliest = Math.min(...selected.map((region) => region.startTick))
      clipboardRef.current = {
        kind: 'chords',
        items: selected.map((region) => ({ region, offset: region.startTick - earliest })),
      }
      history.commit(result.project)
      clearSelection()
      showNotice(`已剪切 ${selected.length} 个和弦区域`)
      return
    }

    const selected: ClipboardNote[] = []
    let earliest = Number.POSITIVE_INFINITY
    project.tracks.forEach((track) => track.notes.forEach((note) => {
      if (!selectedNoteIds.has(note.id)) return
      earliest = Math.min(earliest, note.startTick)
      selected.push({ voiceId: track.id, note, offset: 0 })
    }))
    if (selected.length === 0) return showNotice('没有选中的音符')
    const result = deleteNotes(project, selectedNoteIds)
    const remaining = result.project.tracks.reduce((count, track) => (
      count + track.notes.filter((note) => selectedNoteIds.has(note.id)).length
    ), 0)
    if (result.error || remaining > 0) return showNotice(result.error ?? '选区包含锁定音符，无法整体剪切')
    clipboardRef.current = {
      kind: 'notes',
      items: selected.map((item) => ({ ...item, offset: item.note.startTick - earliest })),
    }
    history.commit(result.project)
    clearSelection()
    showNotice(`已剪切 ${selected.length} 个音符`)
  }, [clearSelection, editorDomain, history, project, selectedChordIds, selectedNoteIds, showNotice])

  const duplicateSelection = useCallback(() => {
    if (editorDomain === 'chords') {
      const selected = project.chordTrack.regions.filter((region) => selectedChordIds.has(region.id))
      if (selected.length === 0) return showNotice('没有选中的和弦')
      const earliest = Math.min(...selected.map((region) => region.startTick))
      const latestEnd = Math.max(...selected.map((region) => region.startTick + region.durationTicks))
      const offset = latestEnd - earliest
      let nextProject = project
      const newIds = new Set<string>()
      for (const region of selected) {
        const id = createId('chord')
        const result = addChordRegion(nextProject, { ...region, id, startTick: region.startTick + offset, locked: false })
        if (result.error) return showNotice(`重复失败：${result.error}`)
        nextProject = result.project
        newIds.add(id)
      }
      history.commit(nextProject)
      setEditorDomain('chords')
      setSelectedChordIds(newIds)
      setSelectedNoteIds(new Set())
      return
    }

    const selected = project.tracks.flatMap((track) => track.notes
      .filter((note) => selectedNoteIds.has(note.id))
      .map((note) => ({ voiceId: track.id, note })))
    if (selected.length === 0) return showNotice('没有选中的音符')
    const earliest = Math.min(...selected.map((item) => item.note.startTick))
    const latestEnd = Math.max(...selected.map((item) => item.note.startTick + item.note.durationTicks))
    const offset = latestEnd - earliest
    let nextProject = project
    const newIds = new Set<string>()
    for (const item of selected) {
      const id = createId('note')
      const result = addNote(nextProject, item.voiceId, {
        ...item.note,
        id,
        startTick: item.note.startTick + offset,
        locked: false,
      })
      if (result.error) return showNotice(`重复失败：${result.error}`)
      nextProject = result.project
      newIds.add(id)
    }
    history.commit(nextProject)
    setEditorDomain('notes')
    setSelectedNoteIds(newIds)
    setSelectedChordIds(new Set())
  }, [editorDomain, history, project, selectedChordIds, selectedNoteIds, showNotice])

  const cycleActiveVoice = useCallback((direction: 1 | -1) => {
    const visibleVoices = project.tracks.filter((track) => track.visible).map((track) => track.id)
    if (visibleVoices.length <= 1) return
    const currentIndex = visibleVoices.indexOf(activeVoice)
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : visibleVoices.length - 1
      : (currentIndex + direction + visibleVoices.length) % visibleVoices.length
    setActiveVoice(visibleVoices[nextIndex])
  }, [activeVoice, project.tracks])

  const movePlayheadByMeasure = useCallback((direction: 1 | -1) => {
    const measures = buildMeasures(project)
    if (measures.length === 0) return
    const containingIndex = measures.findIndex((measure) => playheadTick < measure.endTick)
    // 工程末尾位于最后小节的右边界，不属于任何小节；导航时仍应将它归入最后小节。
    const nextIndex = containingIndex < 0
      ? measures.length - 1
      : Math.max(0, Math.min(measures.length - 1, containingIndex + direction))
    setPlayheadTick(measures[nextIndex]?.startTick ?? 0)
  }, [playheadTick, project])

  const changeGridResolution = useCallback((direction: 1 | -1) => {
    setGridTicks((current) => {
      const currentIndex = GRID_OPTIONS.findIndex((option) => option.ticks === current)
      const nextIndex = Math.max(0, Math.min(GRID_OPTIONS.length - 1, currentIndex + direction))
      return GRID_OPTIONS[nextIndex]?.ticks ?? current
    })
  }, [])

  const changeTimelineZoom = useCallback((direction: 1 | -1) => {
    setPixelsPerBeat((current) => Math.max(42, Math.min(140, current + direction * 10)))
  }, [])

  const transformSelection = useCallback((tickDelta: number, pitchDelta: number, quantize = false) => {
    if (editorDomain === 'chords') {
      commitResult(transformChordRegions(project, selectedChordIds, (region) => ({
        ...region,
        startTick: quantize ? Math.floor(region.startTick / gridTicks) * gridTicks : region.startTick + tickDelta,
      })))
      return
    }
    const result = transformNotes(project, selectedNoteIds, (note) => ({
      ...note,
      startTick: quantize ? Math.round(note.startTick / gridTicks) * gridTicks : note.startTick + tickDelta,
      midiNote: Math.max(0, Math.min(127, note.midiNote + pitchDelta)),
    }))
    if (!commitResult(result) || selectedNoteIds.size !== 1) return
    const selectedId = selectedNoteIds.values().next().value
    for (const track of result.project.tracks) {
      const note = track.notes.find((candidate) => candidate.id === selectedId)
      if (note) {
        void audioEngine.previewNote(note.midiNote, track.id)
        return
      }
    }
  }, [commitResult, editorDomain, gridTicks, project, selectedChordIds, selectedNoteIds])

  useEffect(() => {
    const updateModifier = (key: string, pressed: boolean) => {
      if (key === 'Control') setToolModifiers((current) => current.control === pressed ? current : { ...current, control: pressed })
      if (key === 'Alt') setToolModifiers((current) => current.alt === pressed ? current : { ...current, alt: pressed })
    }
    const handleKeyDown = (event: KeyboardEvent) => updateModifier(event.key, true)
    const handleKeyUp = (event: KeyboardEvent) => updateModifier(event.key, false)
    const clearModifiers = () => {
      setToolModifiers({ control: false, alt: false })
      if (editorInteractionActive) setCancelEditorRequest((current) => current + 1)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearModifiers)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearModifiers)
    }
  }, [editorInteractionActive])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (confirmation || settingsOpen || event.isComposing) return
      const target = event.target instanceof HTMLElement ? event.target : document.body
      if (target.matches('input, textarea, select, [contenteditable="true"]') || target.closest('[role="dialog"]')) return
      const command = commandForKeyboardEvent(event, shortcutSettings.bindings)
      if (!command || (event.repeat && !command.allowRepeat)) return
      if ((command.id === 'nextVoice' || command.id === 'previousVoice')
        && target !== document.body && !target.closest('.piano-roll')) return
      event.preventDefault()

      switch (command.id) {
        case 'newProject': void handleNew(); break
        case 'openProject': void handleOpen(); break
        case 'saveProject': void handleSave(false); break
        case 'saveProjectAs': void handleSave(true); break
        case 'undo': history.undo(); break
        case 'redo': history.redo(); break
        case 'selectAll': selectAllInEditorDomain(); break
        case 'clearSelection': clearSelection(); break
        case 'copySelection': copySelection(); break
        case 'cutSelection': cutSelection(); break
        case 'pasteSelection': pasteSelection(); break
        case 'duplicateSelection': duplicateSelection(); break
        case 'deleteSelection':
          if (editorDomain === 'chords') handleDeleteChords(selectedChordIds)
          else handleDeleteNotes(selectedNoteIds)
          break
        case 'cancelOrClear':
          if (editorInteractionActive) setCancelEditorRequest((current) => current + 1)
          else clearSelection()
          break
        case 'quantizeSelection': transformSelection(0, 0, true); break
        case 'moveSelectionLeft': transformSelection(-gridTicks, 0); break
        case 'moveSelectionRight': transformSelection(gridTicks, 0); break
        case 'pitchUp': if (selectedChordIds.size === 0) transformSelection(0, 1); break
        case 'pitchDown': if (selectedChordIds.size === 0) transformSelection(0, -1); break
        case 'octaveUp': if (selectedChordIds.size === 0) transformSelection(0, 12); break
        case 'octaveDown': if (selectedChordIds.size === 0) transformSelection(0, -12); break
        case 'selectTool': setTool('select'); break
        case 'pencilTool': setTool('pencil'); break
        case 'eraserTool': setTool('eraser'); break
        case 'splitTool': setTool('split'); break
        case 'nextVoice': cycleActiveVoice(1); break
        case 'previousVoice': cycleActiveVoice(-1); break
        case 'playPause': void handlePlay(); break
        case 'goToStart': setPlayheadTick(0); break
        case 'goToEnd': setPlayheadTick(project.lengthTicks); break
        case 'previousMeasure': movePlayheadByMeasure(-1); break
        case 'nextMeasure': movePlayheadByMeasure(1); break
        case 'gridCoarser': changeGridResolution(-1); break
        case 'gridFiner': changeGridResolution(1); break
        case 'zoomOut': changeTimelineZoom(-1); break
        case 'zoomIn': changeTimelineZoom(1); break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [changeGridResolution, changeTimelineZoom, clearSelection, confirmation, copySelection, cutSelection, cycleActiveVoice, duplicateSelection, editorDomain, editorInteractionActive, gridTicks, handleDeleteChords, handleDeleteNotes, handleNew, handleOpen, handlePlay, handleSave, history, movePlayheadByMeasure, pasteSelection, project.lengthTicks, selectAllInEditorDomain, selectedChordIds, selectedNoteIds, settingsOpen, shortcutSettings.bindings, transformSelection])

  const handleDiagnostic = (diagnostic: HarmonyDiagnostic) => {
    setPlayheadTick(diagnostic.tick)
    setSelectedNoteIds(new Set(diagnostic.noteIds))
    setSelectedChordIds(new Set(diagnostic.chordIds))
  }

  const measureCount = buildMeasures(project).length
  const toggleWindowMaximize = async () => {
    const maximized = await window.desktop?.windowControls.toggleMaximize()
    if (typeof maximized === 'boolean') setIsWindowMaximized(maximized)
  }
  const closeWindow = async () => {
    if (history.isDirty && !await requestConfirmation({
      title: '关闭工程',
      message: '当前工程尚未保存，仍要关闭吗？',
      confirmLabel: '仍要关闭',
      cancelLabel: '取消',
    })) return
    void window.desktop?.windowControls.close()
  }

  return (
    <main className="app-shell">
      <header
        className="app-titlebar"
        onDoubleClick={(event) => {
          if (event.target instanceof Element && event.target.closest('.titlebar-controls')) return
          void toggleWindowMaximize()
        }}
      >
        <div className="brand-mark">SM</div>
        <strong>SATB Master</strong>
        <span className="project-title">{project.title}{history.isDirty ? ' *' : ''}</span>
        <span className="file-path">{filePath ?? '未保存工程'}</span>
        <span className={`engine-status ${audioState}`}><i />{audioMessage}</span>
        {window.desktop?.windowControls ? (
          <div className="titlebar-controls">
            <IconButton className="window-control" label="最小化" icon={<Minus />} onClick={() => void window.desktop?.windowControls.minimize()} />
            <IconButton
              className="window-control"
              label={isWindowMaximized ? '还原' : '最大化'}
              icon={isWindowMaximized ? <Minimize2 /> : <Maximize2 />}
              onClick={() => void toggleWindowMaximize()}
            />
            <IconButton className="window-control close" label="关闭" icon={<X />} onClick={() => void closeWindow()} />
          </div>
        ) : null}
      </header>

      <div className="main-toolbar">
        <div className="toolbar-group">
          <IconButton label="新建工程" icon={<FilePlus2 />} onClick={() => void handleNew()} />
          <IconButton label="打开工程" icon={<FolderOpen />} onClick={() => void handleOpen()} />
          <IconButton label="保存" icon={<Save />} onClick={() => void handleSave(false)} />
          <IconButton label="另存为" icon={<SaveAll />} onClick={() => void handleSave(true)} />
          <IconButton label="导出 MIDI" icon={<Download />} onClick={() => void handleExportMidi()} />
        </div>
        <div className="toolbar-group">
          <IconButton label="撤销" icon={<Undo2 />} disabled={!history.canUndo} onClick={history.undo} />
          <IconButton label="重做" icon={<Redo2 />} disabled={!history.canRedo} onClick={history.redo} />
          <IconButton label="复制选中事件" icon={<Copy />} onClick={copySelection} />
          <IconButton label="粘贴事件" icon={<Clipboard />} onClick={pasteSelection} />
          <IconButton
            label="删除选中事件"
            icon={<Trash2 />}
            onClick={() => editorDomain === 'chords' ? handleDeleteChords(selectedChordIds) : handleDeleteNotes(selectedNoteIds)}
          />
        </div>
        <div className="toolbar-group tool-selector">
          <IconButton label={`选择工具（${shortcutSettings.bindings.selectTool[0] ? formatShortcutBinding(shortcutSettings.bindings.selectTool[0]) : '未设置'}）`} icon={<MousePointer2 />} active={effectiveTool === 'select'} onClick={() => setTool('select')} />
          <IconButton label={`铅笔工具（${shortcutSettings.bindings.pencilTool[0] ? formatShortcutBinding(shortcutSettings.bindings.pencilTool[0]) : '未设置'}）`} icon={<Pencil />} active={effectiveTool === 'pencil'} onClick={() => setTool('pencil')} />
          <IconButton label={`擦除工具（${shortcutSettings.bindings.eraserTool[0] ? formatShortcutBinding(shortcutSettings.bindings.eraserTool[0]) : '未设置'}）`} icon={<Eraser />} active={effectiveTool === 'eraser'} onClick={() => setTool('eraser')} />
          <IconButton label={`切分工具（${shortcutSettings.bindings.splitTool[0] ? formatShortcutBinding(shortcutSettings.bindings.splitTool[0]) : '未设置'}）`} icon={<Scissors />} active={effectiveTool === 'split'} onClick={() => setTool('split')} />
        </div>
        <div className="transport-group">
          <IconButton label="回到开头" icon={<SkipBack />} onClick={() => handleStop(true)} />
          <IconButton label={isPlaying ? '暂停' : '播放'} icon={isPlaying ? <Pause /> : <Play />} active={isPlaying} onClick={() => void handlePlay()} />
          <IconButton label="停止" icon={<Square />} onClick={() => handleStop()} />
          <IconButton label="循环播放" icon={<Repeat2 />} active={loopEnabled} onClick={() => setLoopEnabled((value) => !value)} />
          <button type="button" className="loop-boundary" title="将循环起点设为播放头" onClick={() => setLoopBoundary('start')}>起 {formatPosition(project, loopStartTick)}</button>
          <button type="button" className="loop-boundary" title="将循环终点设为播放头" onClick={() => setLoopBoundary('end')}>止 {formatPosition(project, loopEndTick)}</button>
          <IconButton label="节拍器" icon={<BellRing />} active={metronomeEnabled} onClick={() => setMetronomeEnabled((value) => !value)} />
          <span
            className={`output-meter ${audioLevel >= 0.98 ? 'is-clipping' : ''}`}
            role="meter"
            aria-label="主输出电平"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={Number(audioLevel.toFixed(4))}
            title="主输出电平"
          ><i style={{ width: `${Math.max(2, audioLevel * 100)}%` }} /></span>
          <span className="position-readout">{formatPosition(project, playheadTick)}</span>
          <span className="transport-meta">{measureCount} 小节</span>
        </div>
        <div className="toolbar-group toolbar-right">
          <IconButton label="设置" icon={<Settings2 />} onClick={() => setSettingsOpen(true)} />
          <div className="grid-control" title="编辑吸附网格">
            <Magnet aria-hidden="true" />
            <select aria-label="时值对齐" value={gridTicks} onChange={(event) => setGridTicks(Number(event.target.value))}>
              {GRID_OPTIONS.map((option) => <option key={option.ticks} value={option.ticks}>{option.label}</option>)}
            </select>
          </div>
          <IconButton label="缩小时间轴" icon={<ZoomOut />} onClick={() => setPixelsPerBeat((value) => Math.max(42, value - 10))} />
          <span className="zoom-value">{pixelsPerBeat}</span>
          <IconButton label="放大时间轴" icon={<ZoomIn />} onClick={() => setPixelsPerBeat((value) => Math.min(140, value + 10))} />
        </div>
      </div>

      <div
        className="workspace"
        ref={panelLayout.workspaceRef}
        style={{
          gridTemplateColumns: `${panelLayout.sizes.left}px ${PANEL_RESIZER_SIZE}px minmax(0, 1fr) ${PANEL_RESIZER_SIZE}px ${panelLayout.sizes.right}px`,
        }}
      >
        <TrackSidebar project={project} activeVoice={activeVoice} onSetActive={setActiveVoice} onUpdateTrack={handleUpdateTrack} />
        <PanelResizeHandle
          orientation="vertical"
          label="调整声部面板宽度"
          value={panelLayout.sizes.left}
          min={panelLayout.limits.left.min}
          max={panelLayout.limits.left.max}
          defaultValue={DEFAULT_PANEL_SIZES.left}
          direction={1}
          onResize={panelLayout.setLeft}
        />
        <section
          className="editor-area"
          style={{ gridTemplateRows: `minmax(0, 1fr) ${PANEL_RESIZER_SIZE}px ${panelLayout.sizes.bottom}px` }}
        >
          <PianoRoll
            project={project}
            activeVoice={activeVoice}
            tool={effectiveTool}
            gridTicks={gridTicks}
            pixelsPerBeat={pixelsPerBeat}
            selectedNoteIds={selectedNoteIds}
            selectedChordIds={selectedChordIds}
            chordBrush={chordBrush}
            diagnostics={harmonyResult.diagnostics}
            playheadTick={playheadTick}
            cancelRequest={cancelEditorRequest}
            onSetPlayhead={setPlayheadTick}
            onSetPixelsPerBeat={setPixelsPerBeat}
            onSetActiveVoice={setActiveVoice}
            onSetEditorDomain={setEditorDomain}
            onInteractionActiveChange={setEditorInteractionActive}
            onSelectNotes={handleSelectNotes}
            onPreviewNote={handlePreviewNote}
            onSelectChords={handleSelectChords}
            onAddNote={handleAddNote}
            onUpdateNote={handleUpdateNote}
            onMoveNotes={handleMoveNotes}
            onDeleteNotes={handleDeleteNotes}
            onSplitNote={handleSplitNote}
            onAddChord={handleAddChord}
            onUpdateChord={handleUpdateChord}
            onMoveChords={handleMoveChords}
            onDeleteChords={handleDeleteChords}
            onSplitChord={handleSplitChord}
          />
          <PanelResizeHandle
            orientation="horizontal"
            label="调整问题面板高度"
            value={panelLayout.sizes.bottom}
            min={panelLayout.limits.bottom.min}
            max={panelLayout.limits.bottom.max}
            defaultValue={DEFAULT_PANEL_SIZES.bottom}
            direction={-1}
            onResize={panelLayout.setBottom}
          />
          <DiagnosticsPanel project={project} result={harmonyResult} onSelect={handleDiagnostic} />
        </section>
        <PanelResizeHandle
          orientation="vertical"
          label="调整属性面板宽度"
          value={panelLayout.sizes.right}
          min={panelLayout.limits.right.min}
          max={panelLayout.limits.right.max}
          defaultValue={DEFAULT_PANEL_SIZES.right}
          direction={-1}
          onResize={panelLayout.setRight}
        />
        <Inspector
          project={project}
          activeVoice={activeVoice}
          selectedNote={selectedNote}
          selectedChord={selectedChord}
          selectedChordIds={selectedChordIds}
          selectedChordCount={selectedChordIds.size}
          chordBrush={chordBrush}
          playheadTick={playheadTick}
          audioStatus={audioMessage}
          soundFontSize={soundFontSizeBytes ? formatByteSize(soundFontSizeBytes) : undefined}
          soundFontLoad={soundFontProgress ? {
            percent: soundFontProgress.totalBytes > 0
              ? Math.round(soundFontProgress.completedBytes / soundFontProgress.totalBytes * 100)
              : 0,
            detail: [
              `文件 ${formatByteSize(soundFontProgress.fileSizeBytes)}`,
              soundFontProgress.requiredMemoryBytes
                ? `建议可用 ${formatByteSize(soundFontProgress.requiredMemoryBytes)}`
                : undefined,
              soundFontProgress.availableMemoryBytes
                ? `当前可用 ${formatByteSize(soundFontProgress.availableMemoryBytes)}`
                : undefined,
            ].filter(Boolean).join(' · '),
          } : undefined}
          onUpdateProject={handleUpdateProject}
          onUpdateInstructions={handleUpdateInstructions}
          onAddEditableRange={handleAddEditableRange}
          onUpdateEditableRange={handleUpdateEditableRange}
          onDeleteEditableRange={handleDeleteEditableRange}
          onUpdateNote={handleUpdateNote}
          onUpdateChord={handleUpdateChord}
          onDeleteChords={handleDeleteChords}
          onUpdateChordBrush={handleUpdateChordBrush}
          onUpdateChordTrack={handleUpdateChordTrack}
          onAddTimingEvent={handleAddTimingEvent}
          onUpdateTimingEvent={handleUpdateTimingEvent}
          onDeleteTimingEvent={handleDeleteTimingEvent}
          onUpdateAudio={(masterVolume) => history.commit(replaceProject(project, (draft) => { draft.audio.masterVolume = masterVolume }))}
          onUpdateTrack={handleUpdateTrack}
          onChooseSoundFont={() => void handleChooseSoundFont()}
          onUseDefaultSoundFont={() => void handleUseDefaultSoundFont()}
        />
      </div>

      {confirmation ? (
        <ConfirmDialog
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.confirmLabel}
          cancelLabel={confirmation.cancelLabel}
          onConfirm={() => answerConfirmation(true)}
          onCancel={() => answerConfirmation(false)}
        />
      ) : null}
      {settingsOpen ? (
        <ShortcutSettings
          bindings={shortcutSettings.bindings}
          onSetBinding={shortcutSettings.setBinding}
          onClearBinding={shortcutSettings.clearBinding}
          onResetBinding={shortcutSettings.resetBinding}
          onResetAll={shortcutSettings.resetAllBindings}
          ruleSeverities={harmonyRuleSettings.severities}
          onSetRuleSeverity={harmonyRuleSettings.setSeverity}
          onResetRule={harmonyRuleSettings.resetRule}
          onResetAllRules={harmonyRuleSettings.resetAllRules}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}
    </main>
  )
}

export default App
