import { useEffect, useMemo, useRef, useState } from 'react'
import { buildMeasures, snapTickBackward } from '../domain/time'
import {
  KEY_NAMES,
  VOICE_CONFIG,
  type ChordEvent,
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
  selectedChordId?: string
  diagnostics: HarmonyDiagnostic[]
  playheadTick: number
  onSetPlayhead(tick: number): void
  onSelectNotes(noteIds: Set<string>): void
  onSelectChord(chordId?: string): void
  onAddNote(voiceId: VoiceId, tick: number, midiNote: number, durationTicks?: number): void
  onUpdateNote(voiceId: VoiceId, noteId: string, patch: Partial<NoteEvent>): void
  onMoveNotes(noteIds: Set<string>, tickDelta: number, pitchDelta: number): void
  onDeleteNotes(noteIds: Set<string>): void
  onSplitNote(voiceId: VoiceId, noteId: string, splitTick: number): void
  onAddChord(tick: number): void
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
  originTick: number
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
  selectedChordId,
  diagnostics,
  playheadTick,
  onSetPlayhead,
  onSelectNotes,
  onSelectChord,
  onAddNote,
  onUpdateNote,
  onMoveNotes,
  onDeleteNotes,
  onSplitNote,
  onAddChord,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [interaction, setInteraction] = useState<PointerInteraction>()
  const measures = useMemo(() => buildMeasures(project), [project])
  const rollHeight = (MAX_MIDI - MIN_MIDI + 1) * ROW_HEIGHT
  const timelineWidth = Math.max(920, (project.lengthTicks / project.ppq) * pixelsPerBeat)
  const totalWidth = timelineWidth + PIANO_WIDTH
  const totalHeight = rollHeight + HEADER_HEIGHT

  const noteRects = useMemo(() => {
    return project.tracks.flatMap((track) => {
      if (!track.visible) return []
      return track.notes.map((note) => {
        const noteDrag = interaction?.kind === 'move' || interaction?.kind === 'resize' ? interaction : undefined
        const isAnchor = noteDrag?.noteId === note.id
        const isGroupMove = noteDrag?.kind === 'move' && noteDrag.selectedIds.includes(note.id)
        const startTick = isAnchor ? noteDrag.nextStartTick : isGroupMove ? note.startTick + noteDrag.tickDelta : note.startTick
        const durationTicks = isAnchor ? noteDrag.nextDurationTicks : note.durationTicks
        const midiNote = isAnchor ? noteDrag.nextMidiNote : isGroupMove ? note.midiNote + noteDrag.pitchDelta : note.midiNote
        return {
          track,
          note,
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

    noteRects.forEach(({ track, note, x, y, width, height }) => {
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
      if (note.locked || track.locked) {
        context.fillStyle = 'rgba(255,255,255,.72)'
        context.font = '10px Segoe UI'
        context.fillText('锁', x + 4, y + 12)
      } else if (width > 28) {
        context.fillStyle = '#fff'
        context.font = '600 10px Segoe UI'
        context.fillText(track.shortName, x + 5, y + 12)
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

  const snapTick = (x: number) => {
    const raw = ((x - PIANO_WIDTH) / pixelsPerBeat) * project.ppq
    return snapTickBackward(raw, gridTicks, project.lengthTicks - gridTicks)
  }

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
      const originTick = snapTick(point.x)
      event.currentTarget.setPointerCapture(event.pointerId)
      setInteraction({
        kind: 'draw',
        voiceId: activeVoice,
        midiNote: midiAtY(point.y),
        originTick,
        nextStartTick: originTick,
        nextDurationTicks: gridTicks,
      })
      return
    }
    if (tool === 'split') {
      if (hit) onSplitNote(hit.track.id, hit.note.id, snapTick(point.x))
      return
    }

    if (!hit) {
      onSelectChord(undefined)
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
    onSelectChord(undefined)
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
      const boundaryTick = snapTick(point.x)
      const nextStartTick = Math.min(interaction.originTick, boundaryTick)
      const nextEndTick = Math.min(project.lengthTicks, Math.max(interaction.originTick + gridTicks, boundaryTick + (boundaryTick <= interaction.originTick ? gridTicks : 0)))
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
      const maxDuration = project.lengthTicks - interaction.startTick
      const duration = Math.max(gridTicks, Math.min(maxDuration, interaction.durationTicks + requestedTickDelta))
      setInteraction({ ...interaction, tickDelta: duration - interaction.durationTicks, nextDurationTicks: duration })
    } else {
      const selectedRects = noteRects.filter((rect) => interaction.selectedIds.includes(rect.note.id))
      const minStart = Math.min(...selectedRects.map((rect) => rect.note.startTick))
      const maxEnd = Math.max(...selectedRects.map((rect) => rect.note.startTick + rect.note.durationTicks))
      const minPitch = Math.min(...selectedRects.map((rect) => rect.note.midiNote))
      const maxPitch = Math.max(...selectedRects.map((rect) => rect.note.midiNote))
      const tickDelta = Math.max(-minStart, Math.min(project.lengthTicks - maxEnd, requestedTickDelta))
      const pitchDelta = Math.max(MIN_MIDI - minPitch, Math.min(MAX_MIDI - maxPitch, requestedPitchDelta))
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
        onSetPlayhead(snapTick(interaction.originX))
      } else {
        noteRects.forEach((rect) => {
          if (rect.x < right && rect.x + rect.width > left && rect.y < bottom && rect.y + rect.height > top) selected.add(rect.note.id)
        })
      }
      onSelectNotes(selected)
    }
    setInteraction(undefined)
  }

  const tempoLabels = project.tempoEvents.filter((event) => event.tick > 0)
  const meterLabels = project.meterEvents.filter((event) => event.tick > 0)
  const keyLabels = project.keyEvents.filter((event) => event.tick > 0)

  return (
    <div className="piano-roll" ref={scrollRef}>
      <div className="piano-roll-inner" style={{ width: totalWidth, height: totalHeight }}>
        <div className="ruler-lane" style={{ width: totalWidth }} onDoubleClick={(event) => onSetPlayhead(snapTick(event.clientX - event.currentTarget.getBoundingClientRect().left))}>
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

        <div className="chord-lane" style={{ width: totalWidth }} onDoubleClick={(event) => onAddChord(snapTick(event.clientX - event.currentTarget.getBoundingClientRect().left))}>
          <span className="lane-sticky-label">和弦</span>
          {project.chords.map((chord: ChordEvent) => (
            <button
              type="button"
              key={chord.id}
              className={`chord-block ${selectedChordId === chord.id ? 'is-selected' : ''}`}
              style={{
                left: PIANO_WIDTH + (chord.startTick / project.ppq) * pixelsPerBeat,
                width: Math.max(34, (chord.durationTicks / project.ppq) * pixelsPerBeat - 2),
              }}
              onClick={(event) => {
                event.stopPropagation()
                onSelectChord(chord.id)
                onSelectNotes(new Set())
                onSetPlayhead(chord.startTick)
              }}
              title={`${chord.label}${chord.locked ? '（已锁定）' : ''}`}
            >
              {chord.label}
            </button>
          ))}
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
