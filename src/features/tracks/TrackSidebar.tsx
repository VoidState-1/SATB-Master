import {
  Eye,
  EyeOff,
  Heart,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { TrackPatch } from "../../domain/editing";
import {
  AUXILIARY_COLOR_PALETTE,
  VOICE_CONFIG,
  getAllPlayableTracks,
  resolveAuxiliaryTrackColor,
  type MusicalTrack,
  type ProjectDocument,
  type VoiceId,
} from "../../domain/project";
import { IconButton } from "../../components/IconButton";
import { SponsorDialog } from "./SponsorDialog";

interface TrackSidebarProps {
  project: ProjectDocument;
  activeVoice: string;
  onSetActive(voiceId: string): void;
  onUpdateTrack(voiceId: string, patch: TrackPatch): void;
  onAddAuxiliaryTrack(): void;
  onDeleteAuxiliaryTrack(trackId: string): void;
}

const VOICE_CSS_VAR: Record<VoiceId, string> = {
  soprano: "var(--voice-s)",
  alto: "var(--voice-a)",
  tenor: "var(--voice-t)",
  bass: "var(--voice-b)",
};

interface TrackCardProps extends Pick<
  TrackSidebarProps,
  "onSetActive" | "onUpdateTrack" | "onDeleteAuxiliaryTrack"
> {
  track: MusicalTrack;
  active: boolean;
  auxiliaryIndex?: number;
}

function TrackCard({
  track,
  active,
  auxiliaryIndex,
  onSetActive,
  onUpdateTrack,
  onDeleteAuxiliaryTrack,
}: TrackCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<{ name: string; color: string }>();
  const auxiliary = track.kind === "auxiliary";
  const color = auxiliary
    ? resolveAuxiliaryTrackColor(track, auxiliaryIndex)
    : VOICE_CSS_VAR[track.id];
  const config = track.kind === "satb" ? VOICE_CONFIG[track.id] : undefined;
  const subtitle = config
    ? `${config.min}-${config.max}`
    : `自由复音 · ${track.notes.length} 音符`;
  const beginEditing = () => setDraft({ name: track.name, color });
  const finishEditing = () => {
    setDraft(undefined);
    editButtonRef.current?.focus();
  };

  useEffect(() => {
    if (auxiliary && active) cardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active, auxiliary]);

  return (
    <section
      ref={cardRef}
      className={`voice-track ${active ? "is-active" : ""} ${auxiliary ? "auxiliary-track" : ""}`}
      style={{ "--voice-color": color } as CSSProperties}
      onClick={() => onSetActive(track.id)}
    >
      <div className="voice-track-title">
        <span className="voice-badge">{track.shortName}</span>
        {auxiliary ? (
          <>
            <button
              type="button"
              className="auxiliary-track-name"
              aria-pressed={active}
              title={track.name}
              onDoubleClick={beginEditing}
            >
              <strong>{track.name}</strong>
            </button>
            <small className="auxiliary-track-subtitle">{subtitle}</small>
            <div
              className="auxiliary-track-title-actions"
              onClick={(event) => event.stopPropagation()}
            >
              <IconButton
                ref={editButtonRef}
                label={`编辑 ${track.name}`}
                icon={<Pencil />}
                active={draft !== undefined}
                aria-expanded={draft !== undefined}
                onClick={draft ? finishEditing : beginEditing}
              />
              <IconButton
                label={`删除 ${track.name}`}
                title={track.locked ? "请先解锁再删除" : `删除 ${track.name}`}
                disabled={track.locked}
                icon={<Trash2 />}
                onClick={() => onDeleteAuxiliaryTrack(track.id)}
              />
            </div>
          </>
        ) : (
          <span>
            <strong>{track.name}</strong>
            <small>{subtitle}</small>
          </span>
        )}
      </div>
      {draft ? (
        <form
          className="auxiliary-track-edit"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            finishEditing();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            const name = draft.name.trim();
            if (!name) return;
            const patch: TrackPatch = {};
            if (name !== track.name) patch.name = name;
            if (draft.color.toLowerCase() !== color.toLowerCase()) patch.color = draft.color;
            if (Object.keys(patch).length) onUpdateTrack(track.id, patch);
            finishEditing();
          }}
        >
          <label className="auxiliary-track-edit-name">
            <span>名称</span>
            <input
              autoFocus
              required
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
            />
          </label>
          <div className="auxiliary-track-colors" role="group" aria-label="声部配色">
            {AUXILIARY_COLOR_PALETTE.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="auxiliary-track-swatch"
                style={{ "--swatch-color": swatch } as CSSProperties}
                aria-label={`使用颜色 ${swatch}`}
                aria-pressed={draft.color.toLowerCase() === swatch}
                title={swatch}
                onClick={() => setDraft({ ...draft, color: swatch })}
              />
            ))}
            <input
              type="color"
              aria-label="自定义颜色"
              title="自定义颜色"
              value={draft.color}
              onChange={(event) => setDraft({ ...draft, color: event.target.value })}
            />
          </div>
          <div className="auxiliary-track-edit-actions">
            <button type="button" className="command-button" onClick={finishEditing}>
              取消
            </button>
            <button type="submit" className="command-button primary" disabled={!draft.name.trim()}>
              保存
            </button>
          </div>
        </form>
      ) : null}
      <div className="track-actions" onClick={(event) => event.stopPropagation()}>
        <IconButton
          label={track.muted ? "取消静音" : "静音"}
          icon={track.muted ? <VolumeX /> : <Volume2 />}
          active={track.muted}
          onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
        />
        <button
          type="button"
          className={`solo-button ${track.solo ? "is-active" : ""}`}
          title="独奏"
          aria-label={`${track.name}独奏`}
          onClick={() => onUpdateTrack(track.id, { solo: !track.solo })}
        >
          S
        </button>
        <IconButton
          label={track.visible ? "隐藏声部" : "显示声部"}
          icon={track.visible ? <Eye /> : <EyeOff />}
          onClick={() => onUpdateTrack(track.id, { visible: !track.visible })}
        />
        <IconButton
          label={track.locked ? "解锁声部" : "锁定声部"}
          icon={track.locked ? <Lock /> : <LockOpen />}
          active={track.locked}
          onClick={() => onUpdateTrack(track.id, { locked: !track.locked })}
        />
      </div>
      <label className="track-slider">
        <span>音量</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={track.volume}
          onChange={(event) => onUpdateTrack(track.id, { volume: Number(event.target.value) })}
        />
      </label>
    </section>
  );
}

export function TrackSidebar({
  project,
  activeVoice,
  onSetActive,
  onUpdateTrack,
  onAddAuxiliaryTrack,
  onDeleteAuxiliaryTrack,
}: TrackSidebarProps) {
  const [sponsorDialogOpen, setSponsorDialogOpen] = useState(false);
  const sponsorButtonRef = useRef<HTMLButtonElement>(null);
  const activeTrack = getAllPlayableTracks(project).find((track) => track.id === activeVoice);
  const trackActions = { onSetActive, onUpdateTrack, onDeleteAuxiliaryTrack };

  return (
    <aside className="track-sidebar" aria-label="声部">
      <div className="sidebar-heading">
        <span>声部</span>
        <span>四轨</span>
      </div>
      <div className="voice-track-list">
        {project.satbTracks.map((track) => (
          <TrackCard key={track.id} track={track} active={track.id === activeVoice} {...trackActions} />
        ))}
        <section aria-label="额外声部">
          <div className="sidebar-heading auxiliary-track-heading">
            <span>额外声部 <span className="auxiliary-track-count">{project.auxiliaryTracks.length}</span></span>
            <button
              type="button"
              className="command-button"
              aria-label="添加额外声部"
              onClick={() => onAddAuxiliaryTrack()}
            >
              <Plus aria-hidden="true" />
              添加
            </button>
          </div>
          {project.auxiliaryTracks.length === 0 ? (
            <p className="auxiliary-track-empty">可添加多条自由复音轨，不参与和声规则检查。</p>
          ) : null}
          {project.auxiliaryTracks.map((track, index) => (
            <TrackCard
              key={track.id}
              track={track}
              active={track.id === activeVoice}
              auxiliaryIndex={index}
              {...trackActions}
            />
          ))}
        </section>
      </div>
      <div className="sidebar-footer">
        <button
          ref={sponsorButtonRef}
          type="button"
          className="sponsor-button"
          aria-label="赞助作者"
          onClick={() => setSponsorDialogOpen(true)}
        >
          <Heart aria-hidden="true" />
          <span>赞助作者</span>
        </button>
        <div className="sidebar-footnote" title={activeTrack?.name ?? VOICE_CONFIG.soprano.name}>
          当前输入：{activeTrack?.name ?? VOICE_CONFIG.soprano.name}
        </div>
      </div>
      {sponsorDialogOpen ? (
        <SponsorDialog
          returnFocusRef={sponsorButtonRef}
          onClose={() => setSponsorDialogOpen(false)}
        />
      ) : null}
    </aside>
  );
}
