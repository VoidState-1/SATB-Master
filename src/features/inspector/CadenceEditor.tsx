import { Check, Trash2 } from "lucide-react";
import { createId, type CadenceAnnotation } from "../../domain/project";
import type { CadenceCandidate } from "../../domain/harmony";
import type { CadenceAnnotationPatch } from "../../domain/editing";

const kindLabels = {
  full: "全终止",
  half: "半终止",
  supplementary: "补充终止",
  deceptive: "阻碍终止",
} as const;

export function CadenceEditor({
  project,
  selectedChord,
  candidates = [],
  onAdd,
  onUpdate,
  onDelete,
}: {
  project: import("../../domain/project").ProjectDocument;
  selectedChord: import("../../domain/project").ChordRegion;
  candidates?: readonly CadenceCandidate[];
  onAdd?: (annotation: CadenceAnnotation) => void;
  onUpdate?: (annotationId: string, patch: CadenceAnnotationPatch) => void;
  onDelete?: (annotationId: string) => void;
}) {
  const annotation = project.chordTrack.cadenceAnnotations.find(
    (item) =>
      item.fromTick <= selectedChord.startTick &&
      selectedChord.startTick + selectedChord.durationTicks <= item.toTick,
  );
  const candidate = candidates.find(
    (item) =>
      item.fromTick <= selectedChord.startTick &&
      selectedChord.startTick + selectedChord.durationTicks <= item.toTick,
  );
  if (!annotation && !candidate) return null;

  const acceptCandidate = () => {
    if (!candidate || !onAdd) return;
    onAdd({
      id: createId("cadence"),
      phraseId: candidate.phraseId,
      fromTick: candidate.fromTick,
      toTick: candidate.toTick,
      kind: candidate.kind,
      form: candidate.form,
      completion: candidate.completion,
      source: "accepted-candidate",
      confidence: candidate.confidence === "certain" ? "certain" : "probable",
      locked: false,
    });
  };

  const update = (patch: CadenceAnnotationPatch) => {
    if (annotation && onUpdate) onUpdate(annotation.id, patch);
  };

  return (
    <section className="cadence-editor property-section">
      <header>终止式范围</header>
      <p className="property-hint">
        {annotation
          ? `${annotation.fromTick} – ${annotation.toTick} · ${annotation.source === "manual" ? "人工标注" : "已确认候选"}${annotation.stale ? " · 需要复核" : ""}`
          : `检测候选 · ${candidate!.fromTick} – ${candidate!.toTick} · ${candidate!.confidence}`}
      </p>
      {!annotation ? (
        <button type="button" className="command-button" onClick={acceptCandidate}>
          <Check />
          确认终止式
        </button>
      ) : (
        <>
          <label>
            <span>终止类型</span>
            <select
              value={annotation.kind}
              disabled={annotation.locked || !onUpdate}
              onChange={(event) =>
                update({
                  kind: event.target.value as CadenceAnnotation["kind"],
                  form:
                    event.target.value === "supplementary"
                      ? "plagal"
                      : event.target.value === "full"
                        ? annotation.form ?? "authentic"
                        : undefined,
                  completion:
                    event.target.value === "full"
                      ? annotation.completion
                      : undefined,
                })
              }
            >
              {Object.entries(kindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {annotation.kind === "full" ? (
            <>
              <label>
                <span>终止形式</span>
                <select
                  value={annotation.form ?? "authentic"}
                  disabled={annotation.locked || !onUpdate}
                  onChange={(event) =>
                    update({
                      form: event.target.value as CadenceAnnotation["form"],
                    })
                  }
                >
                  <option value="authentic">正格</option>
                  <option value="plagal">变格</option>
                </select>
              </label>
              <label>
                <span>完满性</span>
                <select
                  value={annotation.completion ?? ""}
                  disabled={annotation.locked || !onUpdate}
                  onChange={(event) =>
                    update({
                      completion: (event.target.value || undefined) as
                        | CadenceAnnotation["completion"]
                        | undefined,
                    })
                  }
                >
                  <option value="">未指定</option>
                  <option value="perfect">完满</option>
                  <option value="imperfect">不完满</option>
                </select>
              </label>
            </>
          ) : null}
          <div className="inline-commands">
            <button
              type="button"
              className="command-button danger"
              disabled={annotation.locked || !onDelete}
              onClick={() => onDelete?.(annotation.id)}
            >
              <Trash2 />
              删除终止式
            </button>
          </div>
        </>
      )}
    </section>
  );
}
