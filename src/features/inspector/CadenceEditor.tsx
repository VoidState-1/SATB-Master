import { Check, Trash2 } from "lucide-react";
import { useState } from "react";
import { createId, type CadenceAnnotation } from "../../domain/project";
import type { CadenceCandidate } from "../../domain/harmony";
import type { CadenceAnnotationPatch } from "../../domain/editing";
import { cadenceKindLabels, cadenceRangeKey, cadenceRangeLabel, cadencesOverlappingChord } from "../../components/cadenceRanges";

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
  const [selectedRange, selectRange] = useState("");
  const available = cadencesOverlappingChord(project.chordTrack.cadenceAnnotations, candidates,
    selectedChord.startTick, selectedChord.startTick + selectedChord.durationTicks);
  const selected = available.find(item => cadenceRangeKey(item) === selectedRange) ?? available[0];
  const annotation = selected && "source" in selected ? selected : undefined;
  const candidate = selected && "evidence" in selected ? selected : undefined;
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
      {available.length > 1 && (
        <label>
          <span>当前终止式</span>
          <select value={cadenceRangeKey(selected)} onChange={event => selectRange(event.target.value)}>
            {available.map(item => (
              <option key={item.id} value={cadenceRangeKey(item)}>{cadenceRangeLabel(project, item)}</option>
            ))}
          </select>
        </label>
      )}
      <p className="property-hint">
        {annotation
          ? `${cadenceRangeLabel(project, annotation)} · ${annotation.source === "manual" ? "人工标注" : "已确认候选"}${annotation.stale ? " · 需要复核" : ""}`
          : `检测候选 · ${cadenceRangeLabel(project, candidate!)} · ${candidate!.confidence}`}
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
                        : event.target.value === "half"
                          ? annotation.form
                          : undefined,
                  completion:
                    event.target.value === "full"
                      ? annotation.completion
                      : undefined,
                })
              }
            >
              {Object.entries(cadenceKindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {annotation.kind === "full" || annotation.kind === "half" ? (
            <label>
              <span>终止形式</span>
              <select
                value={annotation.form ?? ""}
                disabled={annotation.locked || !onUpdate}
                onChange={(event) =>
                  update({ form: (event.target.value || undefined) as CadenceAnnotation["form"] })
                }
              >
                <option value="">未指定</option>
                <option value="authentic">正格</option>
                <option value="plagal">变格</option>
              </select>
            </label>
          ) : null}
          {annotation.kind === "full" ? (
            <label>
              <span>完满性</span>
              <select
                value={annotation.completion ?? ""}
                disabled={annotation.locked || !onUpdate}
                onChange={(event) =>
                  update({ completion: (event.target.value || undefined) as CadenceAnnotation["completion"] })
                }
              >
                <option value="">未指定</option>
                <option value="perfect">完满</option>
                <option value="imperfect">不完满</option>
              </select>
            </label>
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
