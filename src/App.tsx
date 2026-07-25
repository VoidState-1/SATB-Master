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
  MousePointer2,
  Pause,
  Pencil,
  Play,
  Repeat2,
  Redo2,
  Save,
  SaveAll,
  SkipBack,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
  Scissors,
} from 'lucide-react'
import { audioEngine, type AudioEngineState } from './audio/audioEngine'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { IconButton } from './components/IconButton'
import { Inspector } from './components/Inspector'
import { PianoRoll, type EditorTool } from './components/PianoRoll'
import { TrackSidebar } from './components/TrackSidebar'
import { addNote, deleteNotes, replaceProject, splitNote, transformNotes, updateNote } from './domain/editing'
import { checkHarmony, type HarmonyDiagnostic } from './domain/harmony'
import { buildMidi, midiFileName } from './domain/midi'
import {
  createEmptyProject,
  createId,
  getTrack,
  normalizeProject,
  type ChordEvent,
  type EditableRange,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from './domain/model'
import { buildMeasures, eventAtTick, formatPosition, ticksPerBeat } from './domain/time'
import { useProjectHistory } from './hooks/useProjectHistory'
import {
  autosaveProject,
  discardRecovery,
  exportMidi,
  findRecovery,
  loadDefaultSoundFont,
  openProject,
  saveProject,
} from './services/desktop'

interface ClipboardNote {
  voiceId: VoiceId
  note: NoteEvent
  offset: number
}

const GRID_OPTIONS = [
  { label: '1/4', ticks: 960 },
  { label: '1/8', ticks: 480 },
  { label: '1/16', ticks: 240 },
  { label: '1/32', ticks: 120 },
]

function App() {
  const initialProject = useMemo(() => createEmptyProject(), [])
  const history = useProjectHistory(initialProject)
  const project = history.project
  const [filePath, setFilePath] = useState<string>()
  const [activeVoice, setActiveVoice] = useState<VoiceId>('soprano')
  const [tool, setTool] = useState<EditorTool>('pencil')
  const [gridTicks, setGridTicks] = useState(480)
  const [pixelsPerBeat, setPixelsPerBeat] = useState(72)
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [selectedChordId, setSelectedChordId] = useState<string>()
  const [playheadTick, setPlayheadTick] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [metronomeEnabled, setMetronomeEnabled] = useState(false)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [loopStartTick, setLoopStartTick] = useState(0)
  const [loopEndTick, setLoopEndTick] = useState(initialProject.ppq * 4)
  const [audioState, setAudioState] = useState<AudioEngineState>('idle')
  const [audioMessage, setAudioMessage] = useState('尚未启动音频')
  const [notice, setNotice] = useState<string>()
  const clipboardRef = useRef<ClipboardNote[]>([])
  const recoveryCheckedRef = useRef(false)
  const playSessionRef = useRef(0)

  const harmonyResult = useMemo(() => checkHarmony(project), [project])
  const selectedNote = useMemo(() => {
    const id = selectedNoteIds.values().next().value as string | undefined
    if (!id) return undefined
    for (const track of project.tracks) {
      const note = track.notes.find((candidate) => candidate.id === id)
      if (note) return { voiceId: track.id, note }
    }
    return undefined
  }, [project, selectedNoteIds])
  const selectedChord = project.chords.find((chord) => chord.id === selectedChordId)

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => current === message ? undefined : current), 2800)
  }, [])

  useEffect(() => {
    audioEngine.onState((state, message) => {
      setAudioState(state)
      if (message) setAudioMessage(message)
    })
    return () => audioEngine.stop(false)
  }, [])

  useEffect(() => {
    if (recoveryCheckedRef.current) return
    recoveryCheckedRef.current = true
    void findRecovery().then(async (recovery) => {
      if (!recovery) return
      const savedAt = new Date(recovery.savedAt).toLocaleString('zh-CN')
      const source = recovery.sourcePath ? `\n原工程：${recovery.sourcePath}` : ''
      if (window.confirm(`发现 ${savedAt} 的自动恢复内容。${source}\n\n是否恢复？`)) {
        history.recover(recovery.project)
        setFilePath(recovery.sourcePath)
        showNotice('已恢复未保存内容')
      } else {
        await discardRecovery()
      }
    }).catch((error) => console.warn('读取自动恢复文件失败', error))
  }, [history, showNotice])

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

  const handleSplitNote = useCallback((voiceId: VoiceId, noteId: string, splitTick: number) => {
    commitResult(splitNote(project, voiceId, noteId, splitTick))
  }, [commitResult, project])

  const handleUpdateNote = useCallback((voiceId: VoiceId, noteId: string, patch: Partial<NoteEvent>) => {
    const result = updateNote(project, voiceId, noteId, patch)
    if (commitResult(result) && typeof patch.midiNote === 'number') void audioEngine.previewNote(patch.midiNote, voiceId)
  }, [commitResult, project])

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
        ...project.chords.map((chord) => chord.startTick + chord.durationTicks),
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

  const handleAddChord = useCallback((tick: number) => {
    if (project.chords.some((chord) => chord.startTick <= tick && chord.startTick + chord.durationTicks > tick)) {
      showNotice('该位置已经存在和弦')
      return
    }
    const key = eventAtTick(project.keyEvents, tick)
    const duration = Math.min(project.ppq, project.lengthTicks - tick)
    const chord: ChordEvent = {
      id: createId('chord'),
      startTick: tick,
      durationTicks: duration,
      degree: 1,
      accidental: 0,
      quality: key.mode === 'major' ? 'major' : 'minor',
      inversion: 0,
      label: 'I',
      locked: false,
    }
    history.commit(replaceProject(project, (draft) => {
      draft.chords.push(chord)
      draft.chords.sort((a, b) => a.startTick - b.startTick)
    }))
    setSelectedChordId(chord.id)
    setSelectedNoteIds(new Set())
  }, [history, project, showNotice])

  const handleUpdateChord = useCallback((chordId: string, patch: Partial<ChordEvent>) => {
    const current = project.chords.find((chord) => chord.id === chordId)
    if (!current) return
    if (current.locked && patch.locked !== false) {
      showNotice('该和弦已锁定')
      return
    }
    const updated = { ...current, ...patch }
    if (updated.startTick < 0 || updated.durationTicks <= 0 || updated.startTick + updated.durationTicks > project.lengthTicks) {
      showNotice('和弦超出工程范围')
      return
    }
    if (project.chords.some((chord) => chord.id !== chordId && chord.startTick < updated.startTick + updated.durationTicks && updated.startTick < chord.startTick + chord.durationTicks)) {
      showNotice('和弦事件不能重叠')
      return
    }
    history.commit(replaceProject(project, (draft) => {
      draft.chords = draft.chords.map((chord) => chord.id === chordId ? updated : chord).sort((a, b) => a.startTick - b.startTick)
    }))
  }, [history, project, showNotice])

  const handleDeleteChord = useCallback((chordId: string) => {
    const chord = project.chords.find((item) => item.id === chordId)
    if (chord?.locked) return showNotice('该和弦已锁定')
    history.commit(replaceProject(project, (draft) => {
      draft.chords = draft.chords.filter((item) => item.id !== chordId)
    }))
    setSelectedChordId(undefined)
  }, [history, project, showNotice])

  const timingTick = useCallback((type: 'tempo' | 'meter' | 'key') => {
    if (type === 'tempo') return Math.round(playheadTick / gridTicks) * gridTicks
    return buildMeasures(project).find((measure) => playheadTick >= measure.startTick && playheadTick < measure.endTick)?.startTick ?? 0
  }, [gridTicks, playheadTick, project])

  const handleAddTimingEvent = useCallback((type: 'tempo' | 'meter' | 'key') => {
    const tick = timingTick(type)
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

  const handleNew = useCallback(() => {
    if (history.isDirty && !window.confirm('当前工程尚未保存，仍要新建吗？')) return
    audioEngine.stop()
    history.load(createEmptyProject())
    setFilePath(undefined)
    setSelectedNoteIds(new Set())
    setSelectedChordId(undefined)
    setPlayheadTick(0)
    setLoopStartTick(0)
    setLoopEndTick(initialProject.ppq * 4)
  }, [history])

  const handleOpen = useCallback(async () => {
    if (history.isDirty && !window.confirm('当前工程尚未保存，仍要打开其他工程吗？')) return
    try {
      const result = await openProject()
      if (!result) return
      audioEngine.stop()
      history.load(result.project)
      setFilePath(result.filePath)
      setSelectedNoteIds(new Set())
      setSelectedChordId(undefined)
      setPlayheadTick(0)
      setLoopStartTick(0)
      setLoopEndTick(Math.min(result.project.lengthTicks, result.project.ppq * 4))
      showNotice('工程已打开')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '打开工程失败')
    }
  }, [history, showNotice])

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
    try {
      let name: string
      let path: string | undefined
      let hash: string | undefined
      let bytes: Uint8Array
      if (window.desktop) {
        const result = await window.desktop.soundFont.open()
        if (result.canceled || !result.bytes || !result.name) return
        name = result.name
        path = result.filePath
        hash = result.hash
        bytes = result.bytes
      } else {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.sf2,.sf3'
        const file = await new Promise<File | undefined>((resolve) => {
          input.onchange = () => resolve(input.files?.[0])
          input.click()
        })
        if (!file) return
        name = file.name
        bytes = new Uint8Array(await file.arrayBuffer())
      }

      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      await audioEngine.loadSoundFont(buffer, `user-${Date.now()}`)
      history.commit(replaceProject(project, (draft) => {
        draft.audio.soundFont = { kind: 'user', name, path, hash }
      }))
      showNotice('SoundFont 已加载')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'SoundFont 加载失败')
    }
  }, [history, project, showNotice])

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
      if (project.audio.soundFont.kind === 'default' && !audioEngine.isSoundFontLoaded('default')) {
        try {
          const soundFont = await loadDefaultSoundFont()
          const buffer = soundFont.bytes.buffer.slice(
            soundFont.bytes.byteOffset,
            soundFont.bytes.byteOffset + soundFont.bytes.byteLength,
          ) as ArrayBuffer
          await audioEngine.loadSoundFont(buffer, 'default')
        } catch (error) {
          // 默认资源损坏或安装路径异常时必须清掉旧音色，确保工程仍可用回退合成器播放。
          await audioEngine.unloadSoundFont()
          console.warn('默认 SoundFont 加载失败，继续使用回退音色。', error)
          showNotice('默认音色不可用，已切换到回退音色')
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
  }, [handleStop, isPlaying, loopEnabled, loopEndTick, loopStartTick, metronomeEnabled, playheadTick, project, showNotice])

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
    const selected: ClipboardNote[] = []
    let earliest = Number.POSITIVE_INFINITY
    project.tracks.forEach((track) => track.notes.forEach((note) => {
      if (selectedNoteIds.has(note.id)) {
        earliest = Math.min(earliest, note.startTick)
        selected.push({ voiceId: track.id, note, offset: 0 })
      }
    }))
    if (selected.length === 0) return showNotice('没有选中的音符')
    clipboardRef.current = selected.map((item) => ({ ...item, offset: item.note.startTick - earliest }))
    showNotice(`已复制 ${selected.length} 个音符`)
  }, [project, selectedNoteIds, showNotice])

  const pasteSelection = useCallback(() => {
    if (clipboardRef.current.length === 0) return showNotice('剪贴板中没有音符')
    let nextProject = project
    const newIds = new Set<string>()
    for (const item of clipboardRef.current) {
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
    setSelectedNoteIds(newIds)
  }, [history, playheadTick, project, showNotice])

  const transformSelection = useCallback((tickDelta: number, pitchDelta: number, quantize = false) => {
    const result = transformNotes(project, selectedNoteIds, (note) => ({
      ...note,
      startTick: quantize ? Math.round(note.startTick / gridTicks) * gridTicks : note.startTick + tickDelta,
      midiNote: Math.max(0, Math.min(127, note.midiNote + pitchDelta)),
    }))
    commitResult(result)
  }, [commitResult, gridTicks, project, selectedNoteIds])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const control = event.ctrlKey || event.metaKey
      if (control && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave(event.shiftKey)
      } else if (control && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void handleOpen()
      } else if (control && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) history.redo(); else history.undo()
      } else if (control && event.key.toLowerCase() === 'y') {
        event.preventDefault(); history.redo()
      } else if (control && event.key.toLowerCase() === 'c') {
        event.preventDefault(); copySelection()
      } else if (control && event.key.toLowerCase() === 'v') {
        event.preventDefault(); pasteSelection()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault(); handleDeleteNotes(selectedNoteIds)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault(); transformSelection(0, event.shiftKey ? 12 : 1)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault(); transformSelection(0, event.shiftKey ? -12 : -1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault(); transformSelection(-gridTicks, 0)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault(); transformSelection(gridTicks, 0)
      } else if (event.key.toLowerCase() === 'q') {
        event.preventDefault(); transformSelection(0, 0, true)
      } else if (event.code === 'Space') {
        event.preventDefault(); void handlePlay()
      } else if (event.key === '1') setTool('select')
      else if (event.key === '2') setTool('pencil')
      else if (event.key === '3') setTool('eraser')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [copySelection, gridTicks, handleDeleteNotes, handleOpen, handlePlay, handleSave, history, pasteSelection, selectedNoteIds, transformSelection])

  const handleDiagnostic = (diagnostic: HarmonyDiagnostic) => {
    setPlayheadTick(diagnostic.tick)
    setSelectedNoteIds(new Set(diagnostic.noteIds))
    setSelectedChordId(undefined)
  }

  const measureCount = buildMeasures(project).length

  return (
    <main className="app-shell">
      <header className="app-titlebar">
        <div className="brand-mark">SM</div>
        <strong>SATB Master</strong>
        <span className="project-title">{project.title}{history.isDirty ? ' *' : ''}</span>
        <span className="file-path">{filePath ?? '未保存工程'}</span>
        <span className={`engine-status ${audioState}`}><i />{audioMessage}</span>
      </header>

      <div className="main-toolbar">
        <div className="toolbar-group">
          <IconButton label="新建工程" icon={<FilePlus2 />} onClick={handleNew} />
          <IconButton label="打开工程" icon={<FolderOpen />} onClick={() => void handleOpen()} />
          <IconButton label="保存" icon={<Save />} onClick={() => void handleSave(false)} />
          <IconButton label="另存为" icon={<SaveAll />} onClick={() => void handleSave(true)} />
          <IconButton label="导出 MIDI" icon={<Download />} onClick={() => void handleExportMidi()} />
        </div>
        <div className="toolbar-group">
          <IconButton label="撤销" icon={<Undo2 />} disabled={!history.canUndo} onClick={history.undo} />
          <IconButton label="重做" icon={<Redo2 />} disabled={!history.canRedo} onClick={history.redo} />
          <IconButton label="复制音符" icon={<Copy />} onClick={copySelection} />
          <IconButton label="粘贴音符" icon={<Clipboard />} onClick={pasteSelection} />
          <IconButton label="删除选中音符" icon={<Trash2 />} onClick={() => handleDeleteNotes(selectedNoteIds)} />
        </div>
        <div className="toolbar-group tool-selector">
          <IconButton label="选择工具（1）" icon={<MousePointer2 />} active={tool === 'select'} onClick={() => setTool('select')} />
          <IconButton label="铅笔工具（2）" icon={<Pencil />} active={tool === 'pencil'} onClick={() => setTool('pencil')} />
          <IconButton label="擦除工具（3）" icon={<Eraser />} active={tool === 'eraser'} onClick={() => setTool('eraser')} />
          <IconButton label="切分工具（4）" icon={<Scissors />} active={tool === 'split'} onClick={() => setTool('split')} />
        </div>
        <div className="transport-group">
          <IconButton label="回到开头" icon={<SkipBack />} onClick={() => handleStop(true)} />
          <IconButton label={isPlaying ? '暂停' : '播放'} icon={isPlaying ? <Pause /> : <Play />} active={isPlaying} onClick={() => void handlePlay()} />
          <IconButton label="停止" icon={<Square />} onClick={() => handleStop()} />
          <IconButton label="循环播放" icon={<Repeat2 />} active={loopEnabled} onClick={() => setLoopEnabled((value) => !value)} />
          <button type="button" className="loop-boundary" title="将循环起点设为播放头" onClick={() => setLoopBoundary('start')}>起 {formatPosition(project, loopStartTick)}</button>
          <button type="button" className="loop-boundary" title="将循环终点设为播放头" onClick={() => setLoopBoundary('end')}>止 {formatPosition(project, loopEndTick)}</button>
          <IconButton label="节拍器" icon={<BellRing />} active={metronomeEnabled} onClick={() => setMetronomeEnabled((value) => !value)} />
          <span className="position-readout">{formatPosition(project, playheadTick)}</span>
          <span className="transport-meta">{measureCount} 小节</span>
        </div>
        <div className="toolbar-group toolbar-right">
          <label className="grid-control" title="编辑吸附网格"><Magnet /><select value={gridTicks} onChange={(event) => setGridTicks(Number(event.target.value))}>{GRID_OPTIONS.map((option) => <option key={option.ticks} value={option.ticks}>{option.label}</option>)}</select></label>
          <IconButton label="缩小时间轴" icon={<ZoomOut />} onClick={() => setPixelsPerBeat((value) => Math.max(42, value - 10))} />
          <span className="zoom-value">{pixelsPerBeat}</span>
          <IconButton label="放大时间轴" icon={<ZoomIn />} onClick={() => setPixelsPerBeat((value) => Math.min(140, value + 10))} />
        </div>
      </div>

      <div className="workspace">
        <TrackSidebar project={project} activeVoice={activeVoice} onSetActive={setActiveVoice} onUpdateTrack={handleUpdateTrack} />
        <section className="editor-area">
          <PianoRoll
            project={project}
            activeVoice={activeVoice}
            tool={tool}
            gridTicks={gridTicks}
            pixelsPerBeat={pixelsPerBeat}
            selectedNoteIds={selectedNoteIds}
            selectedChordId={selectedChordId}
            diagnostics={harmonyResult.diagnostics}
            playheadTick={playheadTick}
            onSetPlayhead={setPlayheadTick}
            onSelectNotes={setSelectedNoteIds}
            onSelectChord={setSelectedChordId}
            onAddNote={handleAddNote}
            onUpdateNote={handleUpdateNote}
            onMoveNotes={handleMoveNotes}
            onDeleteNotes={handleDeleteNotes}
            onSplitNote={handleSplitNote}
            onAddChord={handleAddChord}
          />
          <DiagnosticsPanel project={project} result={harmonyResult} onSelect={handleDiagnostic} />
        </section>
        <Inspector
          project={project}
          activeVoice={activeVoice}
          selectedNote={selectedNote}
          selectedChord={selectedChord}
          playheadTick={playheadTick}
          audioStatus={audioMessage}
          onUpdateProject={handleUpdateProject}
          onUpdateInstructions={handleUpdateInstructions}
          onAddEditableRange={handleAddEditableRange}
          onUpdateEditableRange={handleUpdateEditableRange}
          onDeleteEditableRange={handleDeleteEditableRange}
          onUpdateNote={handleUpdateNote}
          onUpdateChord={handleUpdateChord}
          onDeleteChord={handleDeleteChord}
          onAddTimingEvent={handleAddTimingEvent}
          onUpdateTimingEvent={handleUpdateTimingEvent}
          onDeleteTimingEvent={handleDeleteTimingEvent}
          onUpdateAudio={(masterVolume) => history.commit(replaceProject(project, (draft) => { draft.audio.masterVolume = masterVolume }))}
          onUpdateTrack={handleUpdateTrack}
          onChooseSoundFont={() => void handleChooseSoundFont()}
        />
      </div>

      {notice ? <div className="notice" role="status">{notice}</div> : null}
    </main>
  )
}

export default App
