import { useEffect, useState, type InputHTMLAttributes } from 'react'
import { FolderOpen, Lock, LockOpen, Plus, Trash2 } from 'lucide-react'
import {
  KEY_NAMES,
  VOICE_CONFIG,
  type ChordEvent,
  type ChordQuality,
  type EditableRange,
  type KeyMode,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from '../domain/model'
import { formatPosition } from '../domain/time'
import { IconButton } from './IconButton'

type InspectorTab = 'selection' | 'project' | 'sound'

interface CommitFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string | number
  onCommit(value: string): void
}

function CommitField({ value, onCommit, ...props }: CommitFieldProps) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(String(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

interface InspectorProps {
  project: ProjectDocument
  activeVoice: VoiceId
  selectedNote?: { voiceId: VoiceId; note: NoteEvent }
  selectedChord?: ChordEvent
  playheadTick: number
  audioStatus: string
  onUpdateProject(patch: Partial<Pick<ProjectDocument, 'title' | 'author' | 'notes' | 'lengthTicks'>>): void
  onUpdateInstructions(instructions: string): void
  onAddEditableRange(): void
  onUpdateEditableRange(rangeId: string, patch: Partial<EditableRange>): void
  onDeleteEditableRange(rangeId: string): void
  onUpdateNote(voiceId: VoiceId, noteId: string, patch: Partial<NoteEvent>): void
  onUpdateChord(chordId: string, patch: Partial<ChordEvent>): void
  onDeleteChord(chordId: string): void
  onAddTimingEvent(type: 'tempo' | 'meter' | 'key'): void
  onUpdateTimingEvent(type: 'tempo' | 'meter' | 'key', id: string, patch: Record<string, string | number>): void
  onDeleteTimingEvent(type: 'tempo' | 'meter' | 'key', id: string): void
  onUpdateAudio(masterVolume: number): void
  onUpdateTrack(voiceId: VoiceId, patch: Partial<ProjectDocument['tracks'][number]>): void
  onChooseSoundFont(): void
}

const qualityOptions: Array<{ value: ChordQuality; label: string }> = [
  { value: 'major', label: '大三和弦' },
  { value: 'minor', label: '小三和弦' },
  { value: 'diminished', label: '减三和弦' },
  { value: 'augmented', label: '增三和弦' },
  { value: 'dominant7', label: '属七和弦' },
  { value: 'major7', label: '大七和弦' },
  { value: 'minor7', label: '小七和弦' },
  { value: 'halfDiminished7', label: '半减七和弦' },
  { value: 'diminished7', label: '减七和弦' },
]

export function Inspector({
  project,
  activeVoice,
  selectedNote,
  selectedChord,
  playheadTick,
  audioStatus,
  onUpdateProject,
  onUpdateInstructions,
  onAddEditableRange,
  onUpdateEditableRange,
  onDeleteEditableRange,
  onUpdateNote,
  onUpdateChord,
  onDeleteChord,
  onAddTimingEvent,
  onUpdateTimingEvent,
  onDeleteTimingEvent,
  onUpdateAudio,
  onUpdateTrack,
  onChooseSoundFont,
}: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('selection')
  const activeTrack = project.tracks.find((track) => track.id === activeVoice)!

  return (
    <aside className="inspector">
      <div className="inspector-tabs" role="tablist">
        <button type="button" className={tab === 'selection' ? 'is-active' : ''} onClick={() => setTab('selection')}>属性</button>
        <button type="button" className={tab === 'project' ? 'is-active' : ''} onClick={() => setTab('project')}>工程</button>
        <button type="button" className={tab === 'sound' ? 'is-active' : ''} onClick={() => setTab('sound')}>音源</button>
      </div>

      <div className="inspector-content">
        {tab === 'selection' && selectedNote ? (
          <section className="property-section">
            <header><span className="voice-dot" style={{ background: VOICE_CONFIG[selectedNote.voiceId].color }} />音符 · {VOICE_CONFIG[selectedNote.voiceId].name}</header>
            <label><span>音高（MIDI）</span><CommitField type="number" min="0" max="127" value={selectedNote.note.midiNote} onCommit={(value) => onUpdateNote(selectedNote.voiceId, selectedNote.note.id, { midiNote: Number(value) })} /></label>
            <label><span>起点（tick）</span><CommitField type="number" min="0" value={selectedNote.note.startTick} onCommit={(value) => onUpdateNote(selectedNote.voiceId, selectedNote.note.id, { startTick: Number(value) })} /></label>
            <label><span>时值（tick）</span><CommitField type="number" min="1" value={selectedNote.note.durationTicks} onCommit={(value) => onUpdateNote(selectedNote.voiceId, selectedNote.note.id, { durationTicks: Number(value) })} /></label>
            <label><span>力度</span><CommitField type="number" min="1" max="127" value={selectedNote.note.velocity} onCommit={(value) => onUpdateNote(selectedNote.voiceId, selectedNote.note.id, { velocity: Number(value) })} /></label>
            <button type="button" className="command-button" onClick={() => onUpdateNote(selectedNote.voiceId, selectedNote.note.id, { locked: !selectedNote.note.locked })}>
              {selectedNote.note.locked ? <LockOpen /> : <Lock />}{selectedNote.note.locked ? '解锁音符' : '锁定音符'}
            </button>
          </section>
        ) : null}

        {tab === 'selection' && selectedChord ? (
          <section className="property-section">
            <header>和弦 · {selectedChord.label}</header>
            <label><span>显示名称</span><CommitField value={selectedChord.label} onCommit={(value) => onUpdateChord(selectedChord.id, { label: value || 'I' })} /></label>
            <label><span>级数</span>
              <select value={selectedChord.degree} onChange={(event) => onUpdateChord(selectedChord.id, { degree: Number(event.target.value) as ChordEvent['degree'] })}>
                {[1, 2, 3, 4, 5, 6, 7].map((degree) => <option key={degree} value={degree}>{degree}</option>)}
              </select>
            </label>
            <label><span>性质</span>
              <select value={selectedChord.quality} onChange={(event) => onUpdateChord(selectedChord.id, { quality: event.target.value as ChordQuality })}>
                {qualityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label><span>转位</span>
              <select value={selectedChord.inversion} onChange={(event) => onUpdateChord(selectedChord.id, { inversion: Number(event.target.value) as ChordEvent['inversion'] })}>
                <option value="0">原位</option><option value="1">第一转位</option><option value="2">第二转位</option><option value="3">第三转位</option>
              </select>
            </label>
            <label><span>起点</span><CommitField type="number" min="0" value={selectedChord.startTick} onCommit={(value) => onUpdateChord(selectedChord.id, { startTick: Number(value) })} /></label>
            <label><span>时值</span><CommitField type="number" min="1" value={selectedChord.durationTicks} onCommit={(value) => onUpdateChord(selectedChord.id, { durationTicks: Number(value) })} /></label>
            <div className="inline-commands">
              <button type="button" className="command-button" onClick={() => onUpdateChord(selectedChord.id, { locked: !selectedChord.locked })}>
                {selectedChord.locked ? <LockOpen /> : <Lock />}{selectedChord.locked ? '解锁' : '锁定'}
              </button>
              <button type="button" className="command-button danger" disabled={selectedChord.locked} onClick={() => onDeleteChord(selectedChord.id)}><Trash2 />删除</button>
            </div>
          </section>
        ) : null}

        {tab === 'selection' && !selectedNote && !selectedChord ? (
          <section className="empty-inspector">
            <span>{formatPosition(project, playheadTick)}</span>
            <strong>未选择事件</strong>
            <p>在卷帘中选择音符，或选择和弦轨事件。</p>
          </section>
        ) : null}

        {tab === 'project' ? (
          <>
            <section className="property-section">
              <header>工程信息</header>
              <label><span>标题</span><CommitField value={project.title} onCommit={(value) => onUpdateProject({ title: value || '未命名练习' })} /></label>
              <label><span>作者</span><CommitField value={project.author} onCommit={(value) => onUpdateProject({ author: value })} /></label>
              <label><span>总长度（tick）</span><CommitField type="number" min={project.ppq * 4} value={project.lengthTicks} onCommit={(value) => onUpdateProject({ lengthTicks: Number(value) })} /></label>
              <label className="stacked"><span>练习说明</span><textarea value={project.exercise.instructions} onChange={(event) => onUpdateInstructions(event.target.value)} placeholder="例如：给定低音，完成其余三个声部" /></label>
            </section>

            <section className="property-section range-section">
              <header><span>锁定时间区间</span><IconButton label="在播放头添加锁定区间" icon={<Plus />} onClick={onAddEditableRange} /></header>
              {project.exercise.editableRanges.length === 0 ? <p className="property-hint">当前没有区间限制。</p> : null}
              {project.exercise.editableRanges.map((range) => (
                <div className="range-editor" key={range.id}>
                  <div className="range-editor-head">
                    <small>{formatPosition(project, range.fromTick)} - {formatPosition(project, range.toTick)}</small>
                    <IconButton label="删除锁定区间" icon={<Trash2 />} onClick={() => onDeleteEditableRange(range.id)} />
                  </div>
                  <label><span>开始 tick</span><CommitField type="number" min="0" value={range.fromTick} onCommit={(value) => onUpdateEditableRange(range.id, { fromTick: Number(value) })} /></label>
                  <label><span>结束 tick</span><CommitField type="number" min="1" value={range.toTick} onCommit={(value) => onUpdateEditableRange(range.id, { toTick: Number(value) })} /></label>
                  <div className="range-voices" aria-label="锁定声部">
                    {project.tracks.map((track) => (
                      <label key={track.id}>
                        <input
                          type="checkbox"
                          checked={range.voiceIds.includes(track.id)}
                          onChange={(event) => onUpdateEditableRange(range.id, {
                            voiceIds: event.target.checked
                              ? [...range.voiceIds, track.id]
                              : range.voiceIds.filter((voiceId) => voiceId !== track.id),
                          })}
                        />
                        <span>{track.shortName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <TimingSection
              title="速度变化"
              onAdd={() => onAddTimingEvent('tempo')}
              rows={project.tempoEvents.map((event) => ({
                id: event.id,
                tick: event.tick,
                value: event.bpm.toString(),
                protected: event.tick === 0,
                onValue: (value) => onUpdateTimingEvent('tempo', event.id, { bpm: Number(value) }),
                onDelete: () => onDeleteTimingEvent('tempo', event.id),
              }))}
            />
            <TimingSection
              title="拍号变化"
              onAdd={() => onAddTimingEvent('meter')}
              rows={project.meterEvents.map((event) => ({
                id: event.id,
                tick: event.tick,
                value: `${event.numerator}/${event.denominator}`,
                protected: event.tick === 0,
                onValue: (value) => {
                  const [numerator, denominator] = value.split('/').map(Number)
                  onUpdateTimingEvent('meter', event.id, { numerator, denominator })
                },
                onDelete: () => onDeleteTimingEvent('meter', event.id),
              }))}
            />
            <section className="property-section timing-section">
              <header><span>调号变化</span><IconButton label="在播放头添加调号" icon={<Plus />} onClick={() => onAddTimingEvent('key')} /></header>
              {project.keyEvents.map((event) => (
                <div className="timing-row" key={event.id}>
                  <small>{formatPosition(project, event.tick)}</small>
                  <select value={event.tonic} onChange={(change) => onUpdateTimingEvent('key', event.id, { tonic: Number(change.target.value) })}>
                    {KEY_NAMES.map((key, index) => <option key={key} value={index}>{key}</option>)}
                  </select>
                  <select value={event.mode} onChange={(change) => onUpdateTimingEvent('key', event.id, { mode: change.target.value as KeyMode })}>
                    <option value="major">大调</option><option value="minor">小调</option>
                  </select>
                  <IconButton label="删除调号事件" icon={<Trash2 />} disabled={event.tick === 0} onClick={() => onDeleteTimingEvent('key', event.id)} />
                </div>
              ))}
            </section>
          </>
        ) : null}

        {tab === 'sound' ? (
          <>
            <section className="property-section soundfont-section">
              <header>SoundFont</header>
              <strong>{project.audio.soundFont.name}</strong>
              <small>{audioStatus}</small>
              <button type="button" className="command-button primary" onClick={onChooseSoundFont}><FolderOpen />选择本地 SF2</button>
            </section>
            <section className="property-section">
              <header>主输出</header>
              <label className="stacked"><span>主音量 {Math.round(project.audio.masterVolume * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={project.audio.masterVolume} onChange={(event) => onUpdateAudio(Number(event.target.value))} /></label>
            </section>
            <section className="property-section">
              <header>{activeTrack.name}音源</header>
              <label><span>GM Program</span><CommitField type="number" min="0" max="127" value={activeTrack.program} onCommit={(value) => onUpdateTrack(activeVoice, { program: Number(value) })} /></label>
              <label className="stacked"><span>声像 {Math.round(activeTrack.pan * 100)}</span><input type="range" min="-1" max="1" step="0.01" value={activeTrack.pan} onChange={(event) => onUpdateTrack(activeVoice, { pan: Number(event.target.value) })} /></label>
            </section>
          </>
        ) : null}
      </div>
    </aside>
  )
}

interface TimingRow {
  id: string
  tick: number
  value: string
  protected: boolean
  onValue(value: string): void
  onDelete(): void
}

function TimingSection({ title, onAdd, rows }: { title: string; onAdd(): void; rows: TimingRow[] }) {
  return (
    <section className="property-section timing-section">
      <header><span>{title}</span><IconButton label={`在播放头添加${title}`} icon={<Plus />} onClick={onAdd} /></header>
      {rows.map((row) => (
        <div className="timing-row" key={row.id}>
          <small>tick {row.tick}</small>
          <CommitField value={row.value} onCommit={row.onValue} />
          <IconButton label={`删除${title}事件`} icon={<Trash2 />} disabled={row.protected} onClick={row.onDelete} />
        </div>
      ))}
    </section>
  )
}
