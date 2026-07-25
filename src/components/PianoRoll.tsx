import { useEffect, useMemo, useRef, useState } from 'react'
import { formatChord, formatChordRegion } from '../domain/chords'
import type { ChordRegionPatch } from '../domain/editing'
import { buildMeasures, keyAtTick, snapTickBackward, snapTickForward } from '../domain/time'
import {
  KEY_NAMES,
  VOICE_CONFIG,
  type ChordRegion,
  type ChordAnalysis,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from '../domain/model'
import type { HarmonyDiagnostic } from '../domain/harmony'

export type EditorTool = 'select' | 'pencil' | 'eraser' | 'split'

interface PianoRollProps {
  project: ProjectDocument
  activeVoice: VoiceId
  tool: EditorTool
  gridTicks: number
  pixelsPerBeat: number
  selectedNoteIds: Set<string>
  selectedChordIds: Set<string>
  chordBrush: ChordAnalysis
  diagnostics: HarmonyDiagnostic[]
  playheadTick: number
  onSetPlayhead(tick: number): void
  onSelectNotes(noteIds: Set<string>): void
  onPreviewNote(voiceId: VoiceId, midiNote: number): void
  onSelectChords(chordIds: Set<string>): void
  onAddNote(voiceId: VoiceId, tick: number, midiNote: number, durationTicks?: number): void
  onUpdateNote(voiceId: VoiceId, noteId: string, patch: Partial<NoteEvent>): void
  onMoveNotes(noteIds: Set<string>, tickDelta: number, pitchDelta: number): void
  onDeleteNotes(noteIds: Set<string>): void
  onSplitNote(voiceId: VoiceId, noteId: string, splitTick: number): void
  onAddChord(tick: number, durationTicks: number): void
  onUpdateChord(chordId: string, patch: ChordRegionPatch): void
  onMoveChords(chordIds: Set<string>, tickDelta: number): void
  onDeleteChords(chordIds: Set<string>): void
  onSplitChord(chordId: string, splitTick: number): void
}

const MIN_MIDI = 36
const MAX_MIDI = 84
const ROW_HEIGHT = 22
const PIANO_WIDTH = 58
const HEADER_HEIGHT = 72

interface NoteInteraction {
  kind: 'move' | 'resize'
  voiceId: VoiceId
  noteId: string
  selectedIds: string[]
  originX: number
  originY: number
  startTick: number
  durationTicks: number
  midiNote: number
  tickDelta: number
  pitchDelta: number
  nextStartTick: number
  nextDurationTicks: number
  nextMidiNote: number
}

interface MarqueeInteraction {
  kind: 'marquee'
  originX: number
  originY: number
  currentX: number
  currentY: number
  append: boolean
}

interface DrawInteraction {
  kind: 'draw'
  voiceId: VoiceId
  midiNote: number
  originRawTick: number
  nextStartTick: number
  nextDurationTicks: number
}

interface EraseInteraction {
  kind: 'erase'
  noteIds: Set<string>
}

interface PanInteraction {
  kind: 'pan'
  originClientX: number
  originClientY: number
  originScrollLeft: number
  originScrollTop: number
}

type PointerInteraction = NoteInteraction | MarqueeInteraction | DrawInteraction | EraseInteraction | PanInteraction

interface ChordDrawInteraction {
  kind: 'draw'
  originRawTick: number
  nextStartTick: number
  nextDurationTicks: number
}

interface ChordMoveInteraction {
  kind: 'move'
  chordId: string
  selectedIds: string[]
  originX: number
  tickDelta: number
}

interface ChordResizeInteraction {
  kind: 'resize-left' | 'resize-right'
  chordId: string
  originStartTick: number
  originDurationTicks: number
  nextStartTick: number
  nextDurationTicks: number
}

interface ChordEraseInteraction {
  kind: 'erase'
  chordIds: Set<string>
}

interface ChordMarqueeInteraction {
  kind: 'marquee'
  originX: number
  currentX: number
  append: boolean
}

interface ChordPanInteraction extends Omit<PanInteraction, 'kind'> {
  kind: 'pan'
}

type ChordInteraction = ChordDrawInteraction | ChordMoveInteraction | ChordResizeInteraction | ChordEraseInteraction | ChordMarqueeInteraction | ChordPanInteraction

function isBlackKey(midiNote: number) {
  return [1, 3, 6, 8, 10].includes(((midiNote % 12) + 12) % 12)
}

function noteName(midiNote: number) {
  const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
  return `${names[midiNote % 12]}${Math.floor(midiNote / 12) - 1}`
}

export function PianoRoll({
  project,
  activeVoice,
  tool,
  gridTicks,
  pixelsPerBeat,
  selectedNoteIds,
  selectedChordIds,
  chordBrush,
  diagnostics,
  playheadTick,
  onSetPlayhead,
  onSelectNotes,
  onPreviewNote,
  onSelectChords,
  onAddNote,
  onUpdateNote,
  onMoveNotes,
  onDeleteNotes,
  onSplitNote,
  onAddChord,
  onUpdateChord,
  onMoveChords,
  onDeleteChords,
  onSplitChord,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [interaction, setInteraction] = useState<PointerInteraction>()
  const [chordInteraction, setChordInteraction] = useState<ChordInteraction>()
  const measures = useMemo(() => buildMeasures(project), [project])
  const rollHeight = (MAX_MIDI - MIN_MIDI + 1) * ROW_HEIGHT
  const timelineWidth = Math.max(920, (project.lengthTicks / project.ppq) * pixelsPerBeat)
  const totalWidth = timelineWidth + PIANO_WIDTH
  const totalHeight = rollHeight + HEADER_HEIGHT

  const noteRects = useMemo(() => {
    const erasedNoteIds = interaction?.kind === 'erase' ? interaction.noteIds : undefined
    return project.tracks.flatMap((track) => {
      if (!track.visible) return []
      return track.notes.filter((note) => !erasedNoteIds?.has(note.id)).map((note) => {
        const noteDrag = interaction?.kind === 'move' || interaction?.kind === 'resize' ? interaction : undefined
        const isAnchor = noteDrag?.noteId === note.id
        const isGroupMove = noteDrag?.kind === 'move' && noteDrag.selectedIds.includes(note.id)
        const startTick = isAnchor ? noteDrag.nextStartTick : isGroupMove ? note.startTick + noteDrag.tickDelta : note.startTick
        const durationTicks = isAnchor ? noteDrag.nextDurationTicks : note.durationTicks
        const midiNote = isAnchor ? noteDrag.nextMidiNote : isGroupMove ? note.midiNote + noteDrag.pitchDelta : note.midiNote
        return {
          track,
          note,
          midiNote,
          x: PIANO_WIDTH + (startTick / project.ppq) * pixelsPerBeat,
          y: HEADER_HEIGHT + (MAX_MIDI - midiNote) * ROW_HEIGHT + 2,
          width: Math.max(5, (durationTicks / project.ppq) * pixelsPerBeat - 1),
          height: ROW_HEIGHT - 4,
        }
      })
    })
  }, [interaction, pixelsPerBeat, project])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.ceil(totalWidth * ratio)
    canvas.height = Math.ceil(totalHeight * ratio)
    canvas.style.width = `${totalWidth}px`
    canvas.style.height = `${totalHeight}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, totalWidth, totalHeight)

    context.fillStyle = '#f7f7f3'
    context.fillRect(0, HEADER_HEIGHT, totalWidth, rollHeight)
    for (let midi = MAX_MIDI; midi >= MIN_MIDI; midi -= 1) {
      const y = HEADER_HEIGHT + (MAX_MIDI - midi) * ROW_HEIGHT
      if (isBlackKey(midi)) {
        context.fillStyle = '#eeeee9'
        context.fillRect(PIANO_WIDTH, y, timelineWidth, ROW_HEIGHT)
      }
      context.strokeStyle = midi % 12 === 0 ? '#c4c5be' : '#dedfd9'
      context.lineWidth = midi % 12 === 0 ? 1.2 : 1
      context.beginPath()
      context.moveTo(PIANO_WIDTH, y + ROW_HEIGHT)
      context.lineTo(totalWidth, y + ROW_HEIGHT)
      context.stroke()
    }

    measures.forEach((measure) => {
      measure.beatTicks.forEach((tick, beatIndex) => {
        const x = PIANO_WIDTH + (tick / project.ppq) * pixelsPerBeat
        context.strokeStyle = beatIndex === 0 ? '#aeb0a8' : '#d6d7d1'
        context.lineWidth = beatIndex === 0 ? 1.25 : 1
        context.beginPath()
        context.moveTo(x, HEADER_HEIGHT)
        context.lineTo(x, totalHeight)
        context.stroke()

        for (let subdivision = 1; subdivision < 4; subdivision += 1) {
          const subTick = tick + (project.ppq * 4 / measure.denominator) * (subdivision / 4)
          if (subTick >= measure.endTick) continue
          const subX = PIANO_WIDTH + (subTick / project.ppq) * pixelsPerBeat
          context.strokeStyle = '#e8e8e3'
          context.beginPath()
          context.moveTo(subX, HEADER_HEIGHT)
          context.lineTo(subX, totalHeight)
          context.stroke()
        }
      })
    })

    // 共享卷帘无法按声部分栏着色，因此用轻量时间带提示锁定区间，并在顶部标明受限声部。
    project.exercise.editableRanges.filter((range) => !range.editable).forEach((range) => {
      const x = PIANO_WIDTH + (range.fromTick / project.ppq) * pixelsPerBeat
      const width = ((range.toTick - range.fromTick) / project.ppq) * pixelsPerBeat
      context.fillStyle = 'rgba(52, 57, 50, 0.055)'
      context.fillRect(x, HEADER_HEIGHT, width, rollHeight)
      context.save()
      context.setLineDash([4, 3])
      context.strokeStyle = 'rgba(52, 57, 50, 0.38)'
      context.strokeRect(x + 0.5, HEADER_HEIGHT + 0.5, Math.max(0, width - 1), rollHeight - 1)
      context.restore()
      context.fillStyle = 'rgba(52, 57, 50, 0.7)'
      context.font = '10px Segoe UI'
      context.fillText(`锁定 ${range.voiceIds.map((voiceId) => VOICE_CONFIG[voiceId].shortName).join('/')}`, x + 5, HEADER_HEIGHT + 13)
    })

    const diagnosticsByNote = new Map<string, HarmonyDiagnostic>()
    diagnostics.forEach((item) => item.noteIds.forEach((noteId) => {
      const existing = diagnosticsByNote.get(noteId)
      if (!existing || item.severity === 'error') diagnosticsByNote.set(noteId, item)
    }))

    noteRects.forEach(({ track, note, midiNote, x, y, width, height }) => {
      const config = VOICE_CONFIG[track.id]
      context.fillStyle = track.id === activeVoice ? config.color : `${config.color}b8`
      context.beginPath()
      context.roundRect(x, y, width, height, 3)
      context.fill()

      if (selectedNoteIds.has(note.id)) {
        context.strokeStyle = '#171914'
        context.lineWidth = 2
        context.stroke()
      }
      const issue = diagnosticsByNote.get(note.id)
      if (issue) {
        context.fillStyle = issue.severity === 'error' ? '#c93f34' : '#d49324'
        context.fillRect(x, y + height - 3, width, 3)
      }
      if (width > 25) {
        context.fillStyle = '#fff'
        context.font = '600 10px Segoe UI'
        context.fillText(noteName(midiNote), x + 5, y + 12)
      }
      if ((note.locked || track.locked) && width > 48) {
        context.fillStyle = 'rgba(255,255,255,.72)'
        context.font = '10px Segoe UI'
        context.fillText('锁', x + width - 15, y + 12)
      }
    })

    if (interaction?.kind === 'draw') {
      const x = PIANO_WIDTH + (interaction.nextStartTick / project.ppq) * pixelsPerBeat
      const y = HEADER_HEIGHT + (MAX_MIDI - interaction.midiNote) * ROW_HEIGHT + 2
      const width = Math.max(5, (interaction.nextDurationTicks / project.ppq) * pixelsPerBeat - 1)
      context.fillStyle = `${VOICE_CONFIG[interaction.voiceId].color}70`
      context.fillRect(x, y, width, ROW_HEIGHT - 4)
      context.strokeStyle = VOICE_CONFIG[interaction.voiceId].darkColor
      context.strokeRect(x + 0.5, y + 0.5, width - 1, ROW_HEIGHT - 5)
      if (width > 25) {
        context.fillStyle = '#fff'
        context.font = '600 10px Segoe UI'
        context.fillText(noteName(interaction.midiNote), x + 5, y + 12)
      }
    }

    if (interaction?.kind === 'marquee') {
      const left = Math.min(interaction.originX, interaction.currentX)
      const top = Math.min(interaction.originY, interaction.currentY)
      const width = Math.abs(interaction.currentX - interaction.originX)
      const height = Math.abs(interaction.currentY - interaction.originY)
      context.fillStyle = 'rgba(47, 119, 100, 0.11)'
      context.fillRect(left, top, width, height)
      context.save()
      context.setLineDash([4, 3])
      context.strokeStyle = '#2f7764'
      context.strokeRect(left + 0.5, top + 0.5, width, height)
      context.restore()
    }

    const playheadX = PIANO_WIDTH + (playheadTick / project.ppq) * pixelsPerBeat
    context.strokeStyle = '#c84132'
    context.lineWidth = 1.5
    context.beginPath()
    context.moveTo(playheadX, HEADER_HEIGHT)
    context.lineTo(playheadX, totalHeight)
    context.stroke()
    context.fillStyle = '#c84132'
    context.beginPath()
    context.moveTo(playheadX - 5, HEADER_HEIGHT)
    context.lineTo(playheadX + 5, HEADER_HEIGHT)
    context.lineTo(playheadX, HEADER_HEIGHT + 7)
    context.fill()
  }, [activeVoice, diagnostics, interaction, measures, noteRects, pixelsPerBeat, playheadTick, project.exercise.editableRanges, project.ppq, rollHeight, selectedNoteIds, timelineWidth, totalHeight, totalWidth])

  useEffect(() => {
    const scroll = scrollRef.current
    if (scroll && scroll.scrollTop === 0) {
      scroll.scrollTop = (MAX_MIDI - 72) * ROW_HEIGHT
    }
  }, [])

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const hitTest = (x: number, y: number) => [...noteRects].reverse().find((rect) => (
    x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
  ))

  const rawTickAtX = (x: number) => {
    const raw = ((x - PIANO_WIDTH) / pixelsPerBeat) * project.ppq
    return Math.max(0, Math.min(project.lengthTicks, raw))
  }

  const snapStartTick = (x: number) => snapTickBackward(rawTickAtX(x), gridTicks, project.lengthTicks - gridTicks)

  const chordAtX = (x: number) => {
    if (!project.chordTrack.visible) return undefined
    const tick = rawTickAtX(x)
    return [...project.chordTrack.regions].reverse().find((region) => (
      region.startTick <= tick && region.startTick + region.durationTicks > tick
    ))
  }

  const keyBoundsAtTick = (tick: number) => {
    let startTick = 0
    let endTick = project.lengthTicks
    for (const event of project.keyEvents) {
      if (event.tick <= tick) startTick = event.tick
      else {
        endTick = event.tick
        break
      }
    }
    return { startTick, endTick }
  }

  const chordSlotAtTick = (tick: number) => {
    const keyBounds = keyBoundsAtTick(tick)
    let startTick = keyBounds.startTick
    let endTick = keyBounds.endTick
    project.chordTrack.regions.forEach((region) => {
      const regionEnd = region.startTick + region.durationTicks
      if (regionEnd <= tick) startTick = Math.max(startTick, regionEnd)
      if (region.startTick > tick) endTick = Math.min(endTick, region.startTick)
    })
    return { startTick, endTick }
  }

  const chordMoveBounds = (ids: Set<string>) => {
    let minimum = Number.NEGATIVE_INFINITY
    let maximum = Number.POSITIVE_INFINITY
    const fixed = project.chordTrack.regions.filter((region) => !ids.has(region.id))
    project.chordTrack.regions.filter((region) => ids.has(region.id)).forEach((region) => {
      const endTick = region.startTick + region.durationTicks
      const keyBounds = keyBoundsAtTick(region.startTick)
      let leftBoundary = keyBounds.startTick
      let rightBoundary = keyBounds.endTick
      fixed.forEach((candidate) => {
        const candidateEnd = candidate.startTick + candidate.durationTicks
        if (candidateEnd <= region.startTick) leftBoundary = Math.max(leftBoundary, candidateEnd)
        if (candidate.startTick >= endTick) rightBoundary = Math.min(rightBoundary, candidate.startTick)
      })
      minimum = Math.max(minimum, leftBoundary - region.startTick)
      maximum = Math.min(maximum, rightBoundary - endTick)
    })
    return {
      minimum: Number.isFinite(minimum) ? minimum : 0,
      maximum: Number.isFinite(maximum) ? maximum : 0,
    }
  }

  const chordRects = (project.chordTrack.visible ? project.chordTrack.regions : [])
    .filter((region) => chordInteraction?.kind !== 'erase' || !chordInteraction.chordIds.has(region.id))
    .map((region) => {
      const moving = chordInteraction?.kind === 'move' && chordInteraction.selectedIds.includes(region.id)
      const resizing = (chordInteraction?.kind === 'resize-left' || chordInteraction?.kind === 'resize-right')
        && chordInteraction.chordId === region.id
      const startTick = moving
        ? region.startTick + chordInteraction.tickDelta
        : resizing ? chordInteraction.nextStartTick : region.startTick
      const durationTicks = resizing ? chordInteraction.nextDurationTicks : region.durationTicks
      return {
        region,
        startTick,
        durationTicks,
        x: PIANO_WIDTH + (startTick / project.ppq) * pixelsPerBeat,
        width: Math.max(5, (durationTicks / project.ppq) * pixelsPerBeat - 2),
      }
    })

  const midiAtY = (y: number) => Math.max(MIN_MIDI, Math.min(MAX_MIDI, MAX_MIDI - Math.floor((y - HEADER_HEIGHT) / ROW_HEIGHT)))

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button === 1) {
      const scroll = scrollRef.current
      if (!scroll) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setInteraction({
        kind: 'pan',
        originClientX: event.clientX,
        originClientY: event.clientY,
        originScrollLeft: scroll.scrollLeft,
        originScrollTop: scroll.scrollTop,
      })
      return
    }
    if (event.button !== 0) return
    const point = localPoint(event)
    if (point.y < HEADER_HEIGHT || point.x < PIANO_WIDTH) return
    const hit = hitTest(point.x, point.y)

    if (tool === 'eraser') {
      event.currentTarget.setPointerCapture(event.pointerId)
      setInteraction({ kind: 'erase', noteIds: new Set(hit ? [hit.note.id] : []) })
      return
    }
    if (tool === 'pencil') {
      const originRawTick = rawTickAtX(point.x)
      const originTick = snapTickBackward(originRawTick, gridTicks, project.lengthTicks - gridTicks)
      event.currentTarget.setPointerCapture(event.pointerId)
      setInteraction({
        kind: 'draw',
        voiceId: activeVoice,
        midiNote: midiAtY(point.y),
        originRawTick,
        nextStartTick: originTick,
        nextDurationTicks: gridTicks,
      })
      return
    }
    if (tool === 'split') {
      if (hit) onSplitNote(hit.track.id, hit.note.id, snapStartTick(point.x))
      return
    }

    if (!hit) {
      onSelectChords(new Set())
      event.currentTarget.setPointerCapture(event.pointerId)
      setInteraction({
        kind: 'marquee',
        originX: point.x,
        originY: point.y,
        currentX: point.x,
        currentY: point.y,
        append: event.shiftKey,
      })
      return
    }

    const nextSelection = selectedNoteIds.has(hit.note.id) ? new Set(selectedNoteIds) : event.shiftKey ? new Set(selectedNoteIds) : new Set<string>()
    if (event.shiftKey && nextSelection.has(hit.note.id)) nextSelection.delete(hit.note.id)
    else nextSelection.add(hit.note.id)
    onSelectNotes(nextSelection)
    onSelectChords(new Set())
    if (!nextSelection.has(hit.note.id)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const resize = point.x >= hit.x + hit.width - 7
    setInteraction({
      kind: resize ? 'resize' : 'move',
      voiceId: hit.track.id,
      noteId: hit.note.id,
      selectedIds: resize ? [hit.note.id] : [...nextSelection],
      originX: point.x,
      originY: point.y,
      startTick: hit.note.startTick,
      durationTicks: hit.note.durationTicks,
      midiNote: hit.note.midiNote,
      tickDelta: 0,
      pitchDelta: 0,
      nextStartTick: hit.note.startTick,
      nextDurationTicks: hit.note.durationTicks,
      nextMidiNote: hit.note.midiNote,
    })
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interaction) return
    if (interaction.kind === 'pan') {
      const scroll = scrollRef.current
      if (scroll) {
        scroll.scrollLeft = interaction.originScrollLeft - (event.clientX - interaction.originClientX)
        scroll.scrollTop = interaction.originScrollTop - (event.clientY - interaction.originClientY)
      }
      return
    }
    const point = localPoint(event)
    if (interaction.kind === 'marquee') {
      setInteraction({ ...interaction, currentX: point.x, currentY: point.y })
      return
    }
    if (interaction.kind === 'draw') {
      const currentRawTick = rawTickAtX(point.x)
      // 拖绘跨过的原始区间两端分别向外吸附，避免右边界也向前取整而多拖一格。
      const nextStartTick = snapTickBackward(
        Math.min(interaction.originRawTick, currentRawTick),
        gridTicks,
        project.lengthTicks - gridTicks,
      )
      const nextEndTick = Math.max(
        nextStartTick + gridTicks,
        snapTickForward(Math.max(interaction.originRawTick, currentRawTick), gridTicks, project.lengthTicks),
      )
      setInteraction({ ...interaction, nextStartTick, nextDurationTicks: Math.max(gridTicks, nextEndTick - nextStartTick) })
      return
    }
    if (interaction.kind === 'erase') {
      const hit = hitTest(point.x, point.y)
      if (hit && !interaction.noteIds.has(hit.note.id)) {
        const noteIds = new Set(interaction.noteIds)
        noteIds.add(hit.note.id)
        setInteraction({ ...interaction, noteIds })
      }
      return
    }

    const requestedTickDelta = Math.round((((point.x - interaction.originX) / pixelsPerBeat) * project.ppq) / gridTicks) * gridTicks
    const requestedPitchDelta = -Math.round((point.y - interaction.originY) / ROW_HEIGHT)
    if (interaction.kind === 'resize') {
      // 缩放使用绝对结束位置向后吸附；鼠标一旦进入下一格，时值立即延长到该格末端。
      const requestedEndTick = snapTickForward(rawTickAtX(point.x), gridTicks, project.lengthTicks)
      const maxDuration = project.lengthTicks - interaction.startTick
      const duration = Math.max(Math.min(gridTicks, maxDuration), Math.min(maxDuration, requestedEndTick - interaction.startTick))
      setInteraction({ ...interaction, tickDelta: duration - interaction.durationTicks, nextDurationTicks: duration })
    } else {
      const selectedRects = noteRects.filter((rect) => interaction.selectedIds.includes(rect.note.id))
      const minStart = Math.min(...selectedRects.map((rect) => rect.note.startTick))
      const maxEnd = Math.max(...selectedRects.map((rect) => rect.note.startTick + rect.note.durationTicks))
      const minPitch = Math.min(...selectedRects.map((rect) => rect.note.midiNote))
      const maxPitch = Math.max(...selectedRects.map((rect) => rect.note.midiNote))
      const tickDelta = Math.max(-minStart, Math.min(project.lengthTicks - maxEnd, requestedTickDelta))
      const pitchDelta = Math.max(MIN_MIDI - minPitch, Math.min(MAX_MIDI - maxPitch, requestedPitchDelta))
      if (interaction.selectedIds.length === 1 && pitchDelta !== interaction.pitchDelta) {
        onPreviewNote(interaction.voiceId, interaction.midiNote + pitchDelta)
      }
      setInteraction({
        ...interaction,
        tickDelta,
        pitchDelta,
        nextStartTick: interaction.startTick + tickDelta,
        nextMidiNote: interaction.midiNote + pitchDelta,
      })
    }
  }

  const finishInteraction = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interaction) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (interaction.kind === 'pan') {
      setInteraction(undefined)
      return
    } else if (interaction.kind === 'resize' && interaction.nextDurationTicks !== interaction.durationTicks) {
      onUpdateNote(interaction.voiceId, interaction.noteId, { durationTicks: interaction.nextDurationTicks })
    } else if (interaction.kind === 'move' && (interaction.tickDelta !== 0 || interaction.pitchDelta !== 0)) {
      onMoveNotes(new Set(interaction.selectedIds), interaction.tickDelta, interaction.pitchDelta)
    } else if (interaction.kind === 'draw') {
      onAddNote(interaction.voiceId, interaction.nextStartTick, interaction.midiNote, interaction.nextDurationTicks)
    } else if (interaction.kind === 'erase' && interaction.noteIds.size > 0) {
      onDeleteNotes(interaction.noteIds)
    } else if (interaction.kind === 'marquee') {
      const left = Math.min(interaction.originX, interaction.currentX)
      const right = Math.max(interaction.originX, interaction.currentX)
      const top = Math.min(interaction.originY, interaction.currentY)
      const bottom = Math.max(interaction.originY, interaction.currentY)
      const selected = interaction.append ? new Set(selectedNoteIds) : new Set<string>()
      if (right - left < 4 && bottom - top < 4) {
        onSetPlayhead(snapStartTick(interaction.originX))
      } else {
        noteRects.forEach((rect) => {
          if (rect.x < right && rect.x + rect.width > left && rect.y < bottom && rect.y + rect.height > top) selected.add(rect.note.id)
        })
      }
      onSelectNotes(selected)
    }
    setInteraction(undefined)
  }

  const chordPointX = (event: React.PointerEvent<HTMLDivElement>) => (
    event.clientX - event.currentTarget.getBoundingClientRect().left
  )

  const handleChordPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      const scroll = scrollRef.current
      if (!scroll) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setChordInteraction({
        kind: 'pan',
        originClientX: event.clientX,
        originClientY: event.clientY,
        originScrollLeft: scroll.scrollLeft,
        originScrollTop: scroll.scrollTop,
      })
      return
    }
    if (event.button !== 0) return
    const x = chordPointX(event)
    const hit = chordAtX(x)

    if (tool === 'eraser') {
      event.currentTarget.setPointerCapture(event.pointerId)
      setChordInteraction({ kind: 'erase', chordIds: new Set(hit && !hit.locked && !project.chordTrack.locked ? [hit.id] : []) })
      return
    }
    if (tool === 'pencil') {
      if (hit || project.chordTrack.locked) return
      const originRawTick = rawTickAtX(x)
      const slot = chordSlotAtTick(originRawTick)
      const startTick = Math.max(slot.startTick, snapTickBackward(originRawTick, gridTicks, project.lengthTicks - gridTicks))
      const endTick = Math.min(slot.endTick, startTick + gridTicks)
      if (endTick <= startTick) return
      event.currentTarget.setPointerCapture(event.pointerId)
      setChordInteraction({ kind: 'draw', originRawTick, nextStartTick: startTick, nextDurationTicks: endTick - startTick })
      return
    }
    if (tool === 'split') {
      if (hit) onSplitChord(hit.id, snapStartTick(x))
      return
    }

    if (!hit) {
      event.currentTarget.setPointerCapture(event.pointerId)
      setChordInteraction({ kind: 'marquee', originX: x, currentX: x, append: event.shiftKey })
      return
    }

    const nextSelection = selectedChordIds.has(hit.id)
      ? new Set(selectedChordIds)
      : event.shiftKey ? new Set(selectedChordIds) : new Set<string>()
    if (event.shiftKey && nextSelection.has(hit.id)) nextSelection.delete(hit.id)
    else nextSelection.add(hit.id)
    onSelectChords(nextSelection)
    onSetPlayhead(hit.startTick)
    if (!nextSelection.has(hit.id) || hit.locked || project.chordTrack.locked) return

    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = chordRects.find((candidate) => candidate.region.id === hit.id)
    const nearLeft = nextSelection.size === 1 && rect && x <= rect.x + 7
    const nearRight = nextSelection.size === 1 && rect && x >= rect.x + rect.width - 7
    if (nearLeft || nearRight) {
      setChordInteraction({
        kind: nearLeft ? 'resize-left' : 'resize-right',
        chordId: hit.id,
        originStartTick: hit.startTick,
        originDurationTicks: hit.durationTicks,
        nextStartTick: hit.startTick,
        nextDurationTicks: hit.durationTicks,
      })
    } else {
      setChordInteraction({ kind: 'move', chordId: hit.id, selectedIds: [...nextSelection], originX: x, tickDelta: 0 })
    }
  }

  const handleChordPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!chordInteraction) return
    if (chordInteraction.kind === 'pan') {
      const scroll = scrollRef.current
      if (scroll) {
        scroll.scrollLeft = chordInteraction.originScrollLeft - (event.clientX - chordInteraction.originClientX)
        scroll.scrollTop = chordInteraction.originScrollTop - (event.clientY - chordInteraction.originClientY)
      }
      return
    }
    const x = chordPointX(event)
    if (chordInteraction.kind === 'erase') {
      const hit = chordAtX(x)
      if (hit && !hit.locked && !project.chordTrack.locked && !chordInteraction.chordIds.has(hit.id)) {
        const chordIds = new Set(chordInteraction.chordIds)
        chordIds.add(hit.id)
        setChordInteraction({ ...chordInteraction, chordIds })
      }
      return
    }
    if (chordInteraction.kind === 'marquee') {
      setChordInteraction({ ...chordInteraction, currentX: x })
      return
    }
    if (chordInteraction.kind === 'draw') {
      const currentRawTick = rawTickAtX(x)
      const slot = chordSlotAtTick(chordInteraction.originRawTick)
      const startTick = Math.max(slot.startTick, snapTickBackward(
        Math.min(chordInteraction.originRawTick, currentRawTick), gridTicks, project.lengthTicks - gridTicks,
      ))
      const endTick = Math.min(slot.endTick, Math.max(
        startTick + gridTicks,
        snapTickForward(Math.max(chordInteraction.originRawTick, currentRawTick), gridTicks, project.lengthTicks),
      ))
      setChordInteraction({ ...chordInteraction, nextStartTick: startTick, nextDurationTicks: Math.max(0, endTick - startTick) })
      return
    }
    if (chordInteraction.kind === 'move') {
      const requested = Math.round((((x - chordInteraction.originX) / pixelsPerBeat) * project.ppq) / gridTicks) * gridTicks
      const bounds = chordMoveBounds(new Set(chordInteraction.selectedIds))
      setChordInteraction({ ...chordInteraction, tickDelta: Math.max(bounds.minimum, Math.min(bounds.maximum, requested)) })
      return
    }

    const region = project.chordTrack.regions.find((candidate) => candidate.id === chordInteraction.chordId)
    if (!region) return
    const keyBounds = keyBoundsAtTick(region.startTick)
    const previous = [...project.chordTrack.regions]
      .filter((candidate) => candidate.id !== region.id && candidate.startTick + candidate.durationTicks <= region.startTick)
      .at(-1)
    const next = project.chordTrack.regions.find((candidate) => candidate.id !== region.id && candidate.startTick >= region.startTick + region.durationTicks)
    const originalEnd = region.startTick + region.durationTicks
    if (chordInteraction.kind === 'resize-left') {
      const minimum = Math.max(keyBounds.startTick, previous ? previous.startTick + previous.durationTicks : 0)
      const maximum = originalEnd - gridTicks
      const startTick = Math.max(minimum, Math.min(maximum, snapTickBackward(rawTickAtX(x), gridTicks, maximum)))
      setChordInteraction({ ...chordInteraction, nextStartTick: startTick, nextDurationTicks: originalEnd - startTick })
    } else {
      const maximum = Math.min(keyBounds.endTick, next?.startTick ?? project.lengthTicks)
      const endTick = Math.max(region.startTick + gridTicks, Math.min(maximum, snapTickForward(rawTickAtX(x), gridTicks, maximum)))
      setChordInteraction({ ...chordInteraction, nextStartTick: region.startTick, nextDurationTicks: endTick - region.startTick })
    }
  }

  const finishChordInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!chordInteraction) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (chordInteraction.kind === 'draw' && chordInteraction.nextDurationTicks > 0) {
      onAddChord(chordInteraction.nextStartTick, chordInteraction.nextDurationTicks)
    } else if (chordInteraction.kind === 'erase' && chordInteraction.chordIds.size > 0) {
      onDeleteChords(chordInteraction.chordIds)
    } else if (chordInteraction.kind === 'move' && chordInteraction.tickDelta !== 0) {
      onMoveChords(new Set(chordInteraction.selectedIds), chordInteraction.tickDelta)
    } else if ((chordInteraction.kind === 'resize-left' || chordInteraction.kind === 'resize-right')
      && (chordInteraction.nextStartTick !== chordInteraction.originStartTick
        || chordInteraction.nextDurationTicks !== chordInteraction.originDurationTicks)) {
      onUpdateChord(chordInteraction.chordId, {
        startTick: chordInteraction.nextStartTick,
        durationTicks: chordInteraction.nextDurationTicks,
      })
    } else if (chordInteraction.kind === 'marquee') {
      const left = Math.min(chordInteraction.originX, chordInteraction.currentX)
      const right = Math.max(chordInteraction.originX, chordInteraction.currentX)
      const selected = chordInteraction.append ? new Set(selectedChordIds) : new Set<string>()
      if (right - left < 4) {
        onSetPlayhead(snapStartTick(chordInteraction.originX))
      } else {
        chordRects.forEach((rect) => {
          if (rect.x < right && rect.x + rect.width > left) selected.add(rect.region.id)
        })
      }
      onSelectChords(selected)
    }
    setChordInteraction(undefined)
  }

  const tempoLabels = project.tempoEvents.filter((event) => event.tick > 0)
  const meterLabels = project.meterEvents.filter((event) => event.tick > 0)
  const keyLabels = project.keyEvents.filter((event) => event.tick > 0)

  return (
    <div className="piano-roll" ref={scrollRef}>
      <div className="piano-roll-inner" style={{ width: totalWidth, height: totalHeight }}>
        <div className="ruler-lane" style={{ width: totalWidth }} onDoubleClick={(event) => onSetPlayhead(snapStartTick(event.clientX - event.currentTarget.getBoundingClientRect().left))}>
          <span className="lane-sticky-label">小节</span>
          {measures.map((measure) => (
            <span
              key={measure.startTick}
              className="measure-number"
              style={{ left: PIANO_WIDTH + (measure.startTick / project.ppq) * pixelsPerBeat }}
            >
              {measure.number}
            </span>
          ))}
          {tempoLabels.map((event) => (
            <span key={event.id} className="timeline-marker tempo" style={{ left: PIANO_WIDTH + (event.tick / project.ppq) * pixelsPerBeat }}>♩={event.bpm}</span>
          ))}
          {meterLabels.map((event) => (
            <span key={event.id} className="timeline-marker meter" style={{ left: PIANO_WIDTH + (event.tick / project.ppq) * pixelsPerBeat }}>{event.numerator}/{event.denominator}</span>
          ))}
          {keyLabels.map((event) => (
            <span key={event.id} className="timeline-marker key" style={{ left: PIANO_WIDTH + (event.tick / project.ppq) * pixelsPerBeat }}>{KEY_NAMES[event.tonic]}{event.mode === 'major' ? '大' : '小'}</span>
          ))}
        </div>

        <div
          className={`chord-lane tool-${tool} ${chordInteraction?.kind === 'pan' ? 'is-panning' : ''}`}
          style={{ width: totalWidth }}
          onPointerDown={handleChordPointerDown}
          onPointerMove={handleChordPointerMove}
          onPointerUp={finishChordInteraction}
          onPointerCancel={() => setChordInteraction(undefined)}
          onAuxClick={(event) => event.preventDefault()}
        >
          <span className="lane-sticky-label">和弦</span>
          {chordRects.map(({ region: chord, startTick, durationTicks, x, width }) => {
            const formatted = formatChordRegion(project, { ...chord, startTick, durationTicks })
            const issue = diagnostics.find((item) => item.chordIds.includes(chord.id))
            const display = project.chordTrack.displayMode === 'roman'
              ? formatted.roman
              : project.chordTrack.displayMode === 'absolute' ? formatted.absolute : `${formatted.roman}  ${formatted.absolute}`
            return (
            <button
              type="button"
              key={chord.id}
              tabIndex={-1}
              className={`chord-block ${selectedChordIds.has(chord.id) ? 'is-selected' : ''} ${chord.locked ? 'is-locked' : ''} ${issue ? `has-${issue.severity}` : ''}`}
              style={{
                left: x,
                width,
              }}
              title={`${formatted.roman} · ${formatted.absolute}${chord.locked ? '（已锁定）' : ''}`}
            >
              <span className="chord-resize-handle left" />
              <span className="chord-label">{display}</span>
              <span className="chord-resize-handle right" />
            </button>
            )
          })}
          {chordInteraction?.kind === 'draw' ? (
            <div
              className="chord-block chord-preview"
              style={{
                left: PIANO_WIDTH + (chordInteraction.nextStartTick / project.ppq) * pixelsPerBeat,
                width: Math.max(5, (chordInteraction.nextDurationTicks / project.ppq) * pixelsPerBeat - 2),
              }}
            >{formatChord(chordBrush, keyAtTick(project.keyEvents, chordInteraction.nextStartTick)).roman}</div>
          ) : null}
          {chordInteraction?.kind === 'marquee' ? (
            <div
              className="chord-marquee"
              style={{
                left: Math.min(chordInteraction.originX, chordInteraction.currentX),
                width: Math.abs(chordInteraction.currentX - chordInteraction.originX),
              }}
            />
          ) : null}
        </div>

        <canvas
          ref={canvasRef}
          className={`roll-canvas tool-${tool} ${interaction?.kind === 'pan' ? 'is-panning' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishInteraction}
          onPointerCancel={() => setInteraction(undefined)}
          onAuxClick={(event) => event.preventDefault()}
        />

        <div className="piano-keys" style={{ height: rollHeight }}>
          {Array.from({ length: MAX_MIDI - MIN_MIDI + 1 }, (_, index) => MAX_MIDI - index).map((midi) => (
            <div key={midi} className={`piano-key ${isBlackKey(midi) ? 'black' : ''}`} style={{ height: ROW_HEIGHT }}>
              {midi % 12 === 0 ? noteName(midi) : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
