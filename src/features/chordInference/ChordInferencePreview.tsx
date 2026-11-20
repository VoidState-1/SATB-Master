import { formatChordIdentity } from "../../domain/chords";
import type { ChordInferenceApplyOptions, ChordInferenceRegion } from "../../domain/harmony/inference";
import type { ProjectDocument } from "../../domain/project";
import { formatPosition, keyAtTick } from "../../domain/time";

interface ChordInferencePreviewProps {
  project: ProjectDocument;
  regions: readonly ChordInferenceRegion[];
  mode: ChordInferenceApplyOptions["mode"];
  choices?: ReadonlyMap<string, string>;
  onChoose(regionId: string, candidateId: string): void;
  onApplyRegion(regionId: string, candidateId: string): void;
}

export function ChordInferencePreview({
  project, regions, mode, choices, onChoose, onApplyRegion,
}: ChordInferencePreviewProps) {
  const rows = regions.flatMap(region => {
    const { selected, alternatives, reviewCandidateIds, observationIndices } = region;
    if (!selected || !reviewCandidateIds?.length || observationIndices.length !== 1) return [];
    const candidates = [selected, ...alternatives].filter(candidate => reviewCandidateIds.includes(candidate.id));
    return candidates.length ? [{ region, candidates }] : [];
  });
  if (!rows.length) return null;

  return (
    <section className="chord-inference-field" aria-labelledby="chord-inference-preview-title">
      <h3 className="chord-inference-field-label chord-inference-preview-title" id="chord-inference-preview-title">候选读法</h3>
      <div className="chord-inference-preview-list">
        {rows.map(({ region, candidates }) => {
          const { id, fromTick, toTick } = region;
          const choice = candidates.find(candidate => candidate.id === choices?.get(id)) ?? candidates[0];
          const overlapping = project.chordTrack.regions.filter(chord =>
            chord.startTick < toTick && fromTick < chord.startTick + chord.durationTicks);
          const unavailable = project.chordTrack.locked || overlapping.some(chord => chord.locked)
            ? "此段与锁定和弦重叠或和弦轨已锁定"
            : mode === "fill-gaps" && overlapping.length ? "此段已有和弦，可切换到替换未锁定和弦" : undefined;
          const single = candidates.length === 1;
          const Reading = single ? "div" : "label";
          const position = `${formatPosition(project, fromTick)} – ${formatPosition(project, toTick)}`;
          const key = keyAtTick(project.keyEvents, fromTick);
          return (
            <fieldset className="chord-inference-preview-region" key={id} disabled={Boolean(unavailable)}>
              <legend>{position}</legend>
              {candidates.map(candidate => {
                const label = formatChordIdentity(candidate.identity, candidate.semantics, key.mode);
                const suspension = candidate.evidence.some(item =>
                  item.code === "prepared-suspension" && item.details?.figure === "9-8");
                const sameRoot = candidate.evidence.some(item => item.code === "dominant-ninth-same-root-9-8");
                return (
                  <Reading className="chord-inference-reading" key={candidate.id}>
                    {!single && <input type="radio" name={id} checked={choice.id === candidate.id}
                      onChange={() => onChoose(id, candidate.id)} />}
                    <span>
                      <strong>{suspension ? `${label.functional} · 9–8 延留` : label.roman === "?" ? label.absolute : label.roman}</strong>
                      {single && <small>实写音符合这项读法，需单独确认写入</small>}
                      {suspension || sameRoot ? <small>
                        {suspension ? "同一音符延入，在原声部解决到属七根音" : "九音作为和弦音，级进解决到同根属七"}
                      </small> : null}
                    </span>
                  </Reading>
                );
              })}
              <div className="chord-inference-preview-action">
                {unavailable ? <small>{unavailable}</small> : null}
                <button className="chord-inference-btn-secondary" type="button"
                  aria-label={`仅应用此段 ${position}`}
                  onClick={() => onApplyRegion(id, choice.id)}>仅应用此段</button>
              </div>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
