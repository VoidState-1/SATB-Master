import { useMemo } from "react";
import { Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import type { KeyMode, ProjectDocument } from "../../domain/project";
import {
  formatPitchClass,
  keyTonicOptions,
  serializePitchClass,
} from "../../domain/pitch";
import {
  buildMeasures,
  formatPosition,
  ticksForMeasures,
} from "../../domain/time";
import { IconButton } from "../../components/IconButton";
import { CommitField } from "./CommitField";
import { TimingSection } from "./TimingSection";
import type { ProjectInspectorProps } from "./types";

export function ProjectInspector({
  project,
  onUpdateProject,
  onUpdateInstructions,
  onAddEditableRange,
  onUpdateEditableRange,
  onDeleteEditableRange,
  onAddPhraseBoundary,
  onAddPhraseBoundaryAt,
  onDeletePhraseBoundary,
  phraseBoundaryCandidates = [],
  onUpdateChordTrack,
  onAddTimingEvent,
  onUpdateTimingEvent,
  onDeleteTimingEvent,
}: ProjectInspectorProps) {
  const projectMeasureCount = useMemo(
    () => buildMeasures(project).length,
    [project],
  );

  return (
    <>
      <section className="property-section">
        <header>工程信息</header>
        <label>
          <span>标题</span>
          <CommitField
            value={project.title}
            onCommit={(value) =>
              onUpdateProject({ title: value || "未命名练习" })
            }
          />
        </label>
        <label>
          <span>作者</span>
          <CommitField
            value={project.author}
            onCommit={(value) => onUpdateProject({ author: value })}
          />
        </label>
        <label>
          <span>总长度（小节）</span>
          <CommitField
            type="number"
            min={1}
            step={1}
            value={projectMeasureCount}
            onCommit={(value) =>
              onUpdateProject({
                lengthTicks: ticksForMeasures(project, Number(value)),
              })
            }
          />
        </label>
        <label className="stacked">
          <span>练习说明</span>
          <textarea
            value={project.exercise.instructions}
            onChange={(event) => onUpdateInstructions(event.target.value)}
            placeholder="例如：给定低音，完成其余三个声部"
          />
        </label>
      </section>

      <section className="property-section timing-section">
        <header>
          <span>乐句边界</span>
          <IconButton
            label="在播放头添加乐句边界"
            icon={<Plus />}
            onClick={onAddPhraseBoundary}
          />
        </header>
        {project.structure.phraseBoundaries.length === 0 ? (
          <p className="property-hint">当前使用工程首尾作为单个乐句。</p>
        ) : null}
        {project.structure.phraseBoundaries.map((boundary) => (
          <div className="timing-row" key={boundary.id}>
            <small>{formatPosition(project, boundary.tick)}</small>
            <span>{boundary.source === "manual" ? "人工" : "推测"}</span>
            <IconButton
              label="删除乐句边界"
              icon={<Trash2 />}
              disabled={boundary.locked}
              onClick={() => onDeletePhraseBoundary(boundary.id)}
            />
          </div>
        ))}
        {phraseBoundaryCandidates.length > 0 ? (
          <div className="property-hint">
            <strong>检测到的边界候选</strong>
            {phraseBoundaryCandidates.map((candidate) => (
              <div className="timing-row" key={candidate.tick}>
                <span>
                  {formatPosition(project, candidate.tick)} · {candidate.confidence}
                </span>
                <IconButton
                  label="确认乐句边界候选"
                  icon={<Plus />}
                  onClick={() => onAddPhraseBoundaryAt(candidate.tick)}
                />
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="property-section">
        <header>和弦轨</header>
        <label>
          <span>显示方式</span>
          <select
            value={project.chordTrack.displayMode}
            onChange={(event) =>
              onUpdateChordTrack({
                displayMode: event.target
                  .value as ProjectDocument["chordTrack"]["displayMode"],
              })
            }
          >
            <option value="functional">功能标记</option>
            <option value="roman">罗马数字</option>
            <option value="absolute">绝对和弦</option>
            <option value="functional-absolute">功能 + 绝对</option>
            <option value="roman-absolute">罗马 + 绝对</option>
          </select>
        </label>
        <label className="toggle-row">
          <span>显示和弦区域</span>
          <input
            type="checkbox"
            checked={project.chordTrack.visible}
            onChange={(event) =>
              onUpdateChordTrack({ visible: event.target.checked })
            }
          />
        </label>
        <button
          type="button"
          className="command-button"
          onClick={() =>
            onUpdateChordTrack({ locked: !project.chordTrack.locked })
          }
        >
          {project.chordTrack.locked ? <LockOpen /> : <Lock />}
          {project.chordTrack.locked ? "解锁和弦轨" : "锁定和弦轨"}
        </button>
      </section>

      <section className="property-section range-section">
        <header>
          <span>锁定时间区间</span>
          <IconButton
            label="在播放头添加锁定区间"
            icon={<Plus />}
            onClick={onAddEditableRange}
          />
        </header>
        {project.exercise.editableRanges.length === 0 ? (
          <p className="property-hint">当前没有区间限制。</p>
        ) : null}
        {project.exercise.editableRanges.map((range) => (
          <div className="range-editor" key={range.id}>
            <div className="range-editor-head">
              <small>
                {formatPosition(project, range.fromTick)} -{" "}
                {formatPosition(project, range.toTick)}
              </small>
              <IconButton
                label="删除锁定区间"
                icon={<Trash2 />}
                onClick={() => onDeleteEditableRange(range.id)}
              />
            </div>
            <label>
              <span>开始 tick</span>
              <CommitField
                type="number"
                min="0"
                value={range.fromTick}
                onCommit={(value) =>
                  onUpdateEditableRange(range.id, {
                    fromTick: Number(value),
                  })
                }
              />
            </label>
            <label>
              <span>结束 tick</span>
              <CommitField
                type="number"
                min="1"
                value={range.toTick}
                onCommit={(value) =>
                  onUpdateEditableRange(range.id, { toTick: Number(value) })
                }
              />
            </label>
            <div className="range-voices" aria-label="锁定声部">
              {project.satbTracks.map((track) => (
                <label key={track.id}>
                  <input
                    type="checkbox"
                    checked={range.voiceIds.includes(track.id)}
                    onChange={(event) =>
                      onUpdateEditableRange(range.id, {
                        voiceIds: event.target.checked
                          ? [...range.voiceIds, track.id]
                          : range.voiceIds.filter(
                              (voiceId) => voiceId !== track.id,
                            ),
                      })
                    }
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
        onAdd={() => onAddTimingEvent("tempo")}
        rows={project.tempoEvents.map((event) => ({
          id: event.id,
          tick: event.tick,
          value: event.bpm.toString(),
          protected: event.tick === 0,
          onValue: (value) =>
            onUpdateTimingEvent("tempo", event.id, { bpm: Number(value) }),
          onDelete: () => onDeleteTimingEvent("tempo", event.id),
        }))}
      />
      <TimingSection
        title="拍号变化"
        onAdd={() => onAddTimingEvent("meter")}
        rows={project.meterEvents.map((event) => ({
          id: event.id,
          tick: event.tick,
          value: `${event.numerator}/${event.denominator}`,
          protected: event.tick === 0,
          onValue: (value) => {
            const [numerator, denominator] = value.split("/").map(Number);
            onUpdateTimingEvent("meter", event.id, {
              numerator,
              denominator,
            });
          },
          onDelete: () => onDeleteTimingEvent("meter", event.id),
        }))}
      />
      <section className="property-section timing-section">
        <header>
          <span>调号变化</span>
          <IconButton
            label="在播放头添加调号"
            icon={<Plus />}
            onClick={() => onAddTimingEvent("key")}
          />
        </header>
        {project.keyEvents.map((event) => (
          <div className="timing-row" key={event.id}>
            <small>{formatPosition(project, event.tick)}</small>
            <select
              value={serializePitchClass(event.tonic)}
              onChange={(change) =>
                onUpdateTimingEvent("key", event.id, {
                  tonic: change.target.value,
                })
              }
            >
              {keyTonicOptions(event.mode).map((tonic) => (
                <option
                  key={serializePitchClass(tonic)}
                  value={serializePitchClass(tonic)}
                >
                  {formatPitchClass(tonic)}
                </option>
              ))}
            </select>
            <select
              value={event.mode}
              onChange={(change) =>
                onUpdateTimingEvent("key", event.id, {
                  mode: change.target.value as KeyMode,
                })
              }
            >
              <option value="major">大调</option>
              <option value="minor">小调</option>
            </select>
            <IconButton
              label="删除调号事件"
              icon={<Trash2 />}
              disabled={event.tick === 0}
              onClick={() => onDeleteTimingEvent("key", event.id)}
            />
          </div>
        ))}
      </section>
    </>
  );
}
