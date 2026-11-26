import { chordIdentityInversion, chordIdentityToneSpellings } from "../../chordModel";
import { isWrittenStep, keyEquals, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval } from "../../pitch";
import type { ChordRegion } from "../../project/types";
import type { MetricTimeline } from "../../rhythm/metric";
import { resolvedTonalInterpretation } from "../facts/localTonality";
import { confirmedFullCadences, measureAt } from "./timelineEvidence";
import type { PhraseAnalysisInput, PhraseEvidence } from "./types";

type Track = NonNullable<PhraseAnalysisInput["satbTracks"]>[number];
type Note = Track["notes"][number];
type Articulation = { attack?: Note; release?: Note };

function articulationIndex(tracks: readonly Track[]) {
  const voices = new Map(tracks.map(track => [track.id, {
    starts: new Map(track.notes.map(note => [note.startTick, note])),
    ends: new Map(track.notes.map(note => [note.startTick + note.durationTicks, note])),
  }]));
  return (voice: string, tick: number): Articulation => ({
    attack: voices.get(voice)?.starts.get(tick), release: voices.get(voice)?.ends.get(tick),
  });
}

function degree(region: ChordRegion, expected: number) {
  const { interpretation } = resolvedTonalInterpretation(region.semantics);
  return interpretation?.degree === expected && !interpretation.appliedTarget && !interpretation.degreeAlteration;
}

function contiguous(left: ChordRegion, right: ChordRegion) {
  const a = resolvedTonalInterpretation(left.semantics).interpretation?.localKey;
  const b = resolvedTonalInterpretation(right.semantics).interpretation?.localKey;
  return left.startTick + left.durationTicks === right.startTick && ((!a && !b) || (!!a && !!b && keyEquals(a, b)));
}

type At = ReturnType<typeof articulationIndex>;
type Measure = MetricTimeline["measures"][number];

function dominantPickup(before: ChordRegion, entry: ChordRegion, after: ChordRegion, at: At, measure: Measure) {
  if (!degree(before, 5) || !degree(entry, 5) || !degree(after, 1) ||
      before.identity.structure.kind !== "tertian" || before.identity.structure.quality !== "major" ||
      entry.identity.structure.kind !== "tertian" || entry.identity.structure.quality !== "dominant7" ||
      chordIdentityInversion(before.identity) !== 0 || chordIdentityInversion(entry.identity) !== 1 ||
      chordIdentityInversion(after.identity) !== 0 || !pitchClassEquals(before.identity.root, entry.identity.root) ||
      !pitchClassEquals(entry.identity.root, scaleDegreePitchClass({ tonic: after.identity.root, mode: "major" }, 5))) return false;

  const tick = entry.startTick, beat = measure.beatLength;
  const melody = at("soprano", tick), bass = at("bass", tick);
  if (!bass.release?.pitch || !bass.attack?.pitch || !pitchClassEquals(bass.release.pitch, before.identity.root) ||
      !pitchClassEquals(bass.attack.pitch, entry.identity.bass) || !melody.release?.pitch || !melody.attack?.pitch ||
      spelledPitchEquals(melody.attack.pitch, melody.release.pitch) || entry.durationTicks > beat) return false;
  const voices = [melody, at("alto", tick), at("tenor", tick), bass];
  const seventh = chordIdentityToneSpellings(entry.identity)[3];
  if (!voices.every(v => v.attack && v.release) ||
      !voices.some(v => v.attack?.pitch && pitchClassEquals(v.attack.pitch, seventh))) return false;

  const heldUpper = voices.slice(0, 3).filter(v => v.release!.durationTicks >= 2 * beat);
  const onPeriod = tick === measure.startTick && (measure.number - 1) % 4 === 0;
  const anticipatesDownbeat = after.startTick === measure.endTick && melody.attack.durationTicks > entry.durationTicks;
  return heldUpper.length >= 2 && ((onPeriod && before.durationTicks >= 2 * beat) || anticipatesDownbeat);
}

function deceptivePickup(regions: readonly ChordRegion[], i: number, at: At, beat: number) {
  const entry = regions[i], tick = entry.startTick;
  if (!degree(entry, 6) || chordIdentityInversion(entry.identity) !== 0 ||
      !degree(regions[i - 1], 5) || !degree(regions[i + 1], 4)) return;
  const { attack: bass, release } = at("bass", tick), melody = at("soprano", tick).attack;
  if (!bass?.pitch || !release?.pitch || !pitchClassEquals(release.pitch, regions[i - 1].identity.root) ||
      !pitchClassEquals(bass.pitch, entry.identity.root) || !melody?.pitch ||
      !pitchClassEquals(melody.pitch, chordIdentityToneSpellings(entry.identity)[1]) || melody.durationTicks < beat) return;
  const arrival = writtenInterval(release.pitch, bass.pitch);
  if (!isWrittenStep(arrival) || arrival.diatonicSteps !== 1) return;
  const pickup = tick + melody.durationTicks;
  const next = at("soprano", pickup).attack;
  if (!next?.pitch || spelledPitchEquals(next.pitch, melody.pitch) || next.durationTicks >= beat ||
      pickup >= regions[i + 1].startTick || pickup >= tick + bass.durationTicks ||
      !["alto", "tenor"].some(voice => {
        const inner = at(voice, pickup);
        return inner.attack && inner.release?.startTick === tick;
      })) return;

  let v = i - 1;
  while (v > 0 && degree(regions[v - 1], 5) && contiguous(regions[v - 1], regions[v])) v--;
  const prep = regions[v - 1];
  if (prep?.semantics?.cadenceRole === "cadential64" && contiguous(prep, regions[v]))
    return { tick: pickup, start: prep, value: "终止四六经属落六级，持续低音上两个上声部在弱位收束并重起" };
}

/** A new attack may coincide with a harmony change or occur inside a held VI. */
export function articulatedReleases(project: PhraseAnalysisInput, regions: readonly ChordRegion[], timeline: MetricTimeline) {
  const result = new Map<number, PhraseEvidence>();
  const at = articulationIndex(project.satbTracks ?? []);
  const anchors = project.structure?.phraseBoundaries?.filter(mark => mark.source === "manual" || mark.locked) ?? [];
  const cadences = confirmedFullCadences(project);
  for (let i = 1; i + 1 < regions.length; i++) {
    const before = regions[i - 1], entry = regions[i], after = regions[i + 1];
    if (!contiguous(before, entry) || !contiguous(entry, after)) continue;
    const measure = measureAt(timeline, entry.startTick);
    if (!measure) continue;
    const found = dominantPickup(before, entry, after, at, measure)
      ? { tick: entry.startTick, start: before, value: "长属和声齐收，四声重起的属六五引向原位主和弦" }
      : deceptivePickup(regions, i, at, measure.beatLength);
    if (!found) continue;
    const start = found.start.startTick, end = after.startTick + after.durationTicks;
    if (anchors.some(mark => start < mark.tick && mark.tick < end) ||
        cadences.some(mark => mark.fromTick < found.tick && found.tick < mark.toTick) ||
        project.keyEvents?.some((key, index, keys) => start < key.tick && key.tick < end &&
          (!index || !keyEquals(keys[index - 1], key)))) continue;
    result.set(found.tick, { code: "articulated-release", value: found.value, refs: [found.start.id, entry.id, after.id] });
  }
  return result;
}
