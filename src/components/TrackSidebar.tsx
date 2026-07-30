import {
  Eye,
  EyeOff,
  Heart,
  Lock,
  LockOpen,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  VOICE_CONFIG,
  type ProjectDocument,
  type VoiceId,
} from "../domain/model";
import { IconButton } from "./IconButton";
import { SponsorDialog } from "./SponsorDialog";

interface TrackSidebarProps {
  project: ProjectDocument;
  activeVoice: VoiceId;
  onSetActive(voiceId: VoiceId): void;
  onUpdateTrack(
    voiceId: VoiceId,
    patch: Partial<ProjectDocument["tracks"][number]>,
  ): void;
}

export function TrackSidebar({
  project,
  activeVoice,
  onSetActive,
  onUpdateTrack,
}: TrackSidebarProps) {
  const [sponsorDialogOpen, setSponsorDialogOpen] = useState(false);
  const sponsorButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <aside className="track-sidebar" aria-label="四个声部">
      <div className="sidebar-heading">
        <span>声部</span>
        <span>四轨</span>
      </div>
      <div className="voice-track-list">
        {project.tracks.map((track) => {
          const config = VOICE_CONFIG[track.id];
          return (
            <section
              key={track.id}
              className={`voice-track ${activeVoice === track.id ? "is-active" : ""}`}
              style={{ "--voice-color": config.color } as React.CSSProperties}
              onClick={() => onSetActive(track.id)}
            >
              <div className="voice-track-title">
                <span className="voice-badge">{track.shortName}</span>
                <span>
                  <strong>{track.name}</strong>
                  <small>
                    {config.min}-{config.max}
                  </small>
                </span>
              </div>
              <div
                className="track-actions"
                onClick={(event) => event.stopPropagation()}
              >
                <IconButton
                  label={track.muted ? "取消静音" : "静音"}
                  icon={track.muted ? <VolumeX /> : <Volume2 />}
                  active={track.muted}
                  onClick={() =>
                    onUpdateTrack(track.id, { muted: !track.muted })
                  }
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
                  onClick={() =>
                    onUpdateTrack(track.id, { visible: !track.visible })
                  }
                />
                <IconButton
                  label={track.locked ? "解锁声部" : "锁定声部"}
                  icon={track.locked ? <Lock /> : <LockOpen />}
                  active={track.locked}
                  onClick={() =>
                    onUpdateTrack(track.id, { locked: !track.locked })
                  }
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
                  onChange={(event) =>
                    onUpdateTrack(track.id, {
                      volume: Number(event.target.value),
                    })
                  }
                />
              </label>
            </section>
          );
        })}
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
        <div className="sidebar-footnote">
          当前输入：{VOICE_CONFIG[activeVoice].name}
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
