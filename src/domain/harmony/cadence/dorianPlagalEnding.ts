import type { KeyReference } from "../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval, type SpelledPitchClass } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import type { MetricPosition } from "../../rhythm/metric";
import type { AnalysisNote, AnalysisSlice } from "../analysis";
import type { CadenceCompletion, CadenceSpanFacts } from "./types";
import { hasCadentialWrittenVoicing } from "./writtenCadentialVoicing";

type MetricAt = (tick: number) => MetricPosition | undefined;
const upperVoices = ["soprano", "alto", "tenor"] as const;

function soundsRootTriad(
  fact: CadenceSpanFacts, frame: AnalysisSlice, root: SpelledPitchClass, quality: "major" | "minor",
) {
  const identity = fact.chord?.identity;
  return !!identity && identity.structure.kind === "tertian" && identity.structure.quality === quality &&
    !identity.structure.extensions.length && !identity.structure.alterations.length &&
    pitchClassEquals(identity.root, root) && pitchClassEquals(identity.bass, root) &&
    hasCadentialWrittenVoicing(frame, identity, false);
}

function endsAt(note: AnalysisNote, tick: number) {
  return note.startTick + note.durationTicks === tick;
}

function releasesInto(source: AnalysisNote, landing: AnalysisNote, tick: number) {
  return endsAt(source, tick) && landing.startTick === tick;
}

function strongPosition(metric: MetricPosition | undefined) {
  return !!metric && metric.confidence !== "ambiguous" && metric.level >= 2;
}

function sharesWrittenKey(fact: CadenceSpanFacts, slices: readonly AnalysisSlice[], keyId: string) {
  return fact.span.sliceIndices.every(index => slices[index].key.id === keyId);
}

/** Prove a minor center independently of the closing IV–i. Under the parent
 * major key, a written v–i on a strong beat must carry a real subtonic-to-tonic
 * melody and a root bass. Stop at a competing center or a break in the phrase. */
function hasWrittenModalCenter(
  facts: readonly CadenceSpanFacts[], slices: readonly AnalysisSlice[],
  writtenKey: AnalysisSlice["key"], minor: KeyReference, metricAt: MetricAt,
) {
  const dominantRoot = scaleDegreePitchClass(minor, 5);
  const subtonic = scaleDegreePitchClass(minor, 7);
  for (let index = facts.length - 3; index >= 0; index--) {
    const current = facts[index], next = facts[index + 1];
    const frame = current.boundarySlice;
    if (!frame || current.span.toTick !== next.span.fromTick || current.interpretationStatus !== "resolved" ||
        !sharesWrittenKey(current, slices, writtenKey.id) || !keyEquals(current.key, writtenKey)) return false;
    if (!strongPosition(metricAt(current.span.fromTick))) continue;
    if (current.isTonic && soundsRootTriad(current, frame, writtenKey.tonic, "major")) return false;
    const previous = facts[index - 1];
    const approach = previous && slices[previous.span.sliceIndices.at(-1)!];
    if (!approach || previous.span.toTick !== frame.tick || previous.interpretationStatus !== "resolved" ||
        !keyEquals(previous.key, writtenKey) || !sharesWrittenKey(previous, slices, writtenKey.id) ||
        !soundsRootTriad(current, frame, minor.tonic, "minor") ||
        !soundsRootTriad(previous, approach, dominantRoot, "minor")) continue;
    const bassFrom = approach.notes.bass!, bassTo = frame.notes.bass!;
    const bass = writtenInterval(bassFrom.pitch, bassTo.pitch);
    if (!releasesInto(bassFrom, bassTo, frame.tick) || (bass.semitones !== 5 && bass.semitones !== -7)) continue;
    if (upperVoices.some(voice => {
      const from = approach.notes[voice]!, to = frame.notes[voice]!;
      const step = writtenInterval(from.pitch, to.pitch);
      return pitchClassEquals(from.pitch, subtonic) && pitchClassEquals(to.pitch, minor.tonic) &&
        releasesInto(from, to, frame.tick) && step.diatonicSteps === 1 && step.semitones === 2;
    })) return true;
  }
  return false;
}

/** The actual last source frame and first tonic frame prove IV–i. A held or
 * reattacked tonic in an upper voice can accompany the root-bass motion. */
export function dorianPlagalEnding(
  facts: readonly CadenceSpanFacts[], slices: readonly AnalysisSlice[], metricAt: MetricAt,
  writtenBeatAt: (tick: number) => number | undefined,
): { completion?: CadenceCompletion; center: "local" | "sounding" } | undefined {
  const source = facts.at(-2), landing = facts.at(-1);
  if (!source || !landing || source.interpretationStatus !== "resolved" ||
      landing.interpretationStatus !== "resolved" || source.span.toTick !== landing.span.fromTick) return;
  const before = slices[source.span.sliceIndices.at(-1)!];
  const after = landing.boundarySlice;
  const release = slices[landing.span.sliceIndices.at(-1)!];
  const root = landing.chord?.identity.root;
  if (!before || !after || !release || !root) return;
  const writtenKey = after.key;
  const minor = { tonic: root, mode: "minor" } as const;
  const local = source.isSubdominant && source.degree === 4 && landing.isTonic &&
    pitchClassEquals(source.key.tonic, root) && keyEquals(landing.key, minor);
  const relative = writtenKey.mode === "major" && pitchClassEquals(root, scaleDegreePitchClass(writtenKey, 2)) &&
    source.degree === 5 && landing.degree === 2 &&
    keyEquals(source.key, writtenKey) && keyEquals(landing.key, writtenKey);
  if ((!local && !relative) || !sharesWrittenKey(source, slices, writtenKey.id) ||
      !sharesWrittenKey(landing, slices, writtenKey.id) ||
      !soundsRootTriad(source, before, scaleDegreePitchClass(minor, 4), "major") ||
      !soundsRootTriad(landing, after, root, "minor") ||
      !soundsRootTriad(landing, release, root, "minor")) return;

  const commonTonic = upperVoices.some(voice => {
    const from = before.notes[voice]!, to = after.notes[voice]!;
    return pitchClassEquals(to.pitch, root) && spelledPitchEquals(from.pitch, to.pitch) &&
      (from.id === to.id || releasesInto(from, to, after.tick));
  });
  if (!commonTonic) return;
  const bassFrom = before.notes.bass!, bassTo = after.notes.bass!;
  const bass = writtenInterval(bassFrom.pitch, bassTo.pitch);
  if (!releasesInto(bassFrom, bassTo, after.tick) || (bass.semitones !== 7 && bass.semitones !== -5)) return;

  const end = landing.span.toTick;
  const beat = writtenBeatAt(after.tick);
  const metric = metricAt(after.tick);
  if (!beat || !metric || metric.role === "subdivision" || end - after.tick < beat ||
      !endsAt(release.notes.bass!, end) ||
      !upperVoices.some(voice => endsAt(release.notes[voice]!, end))) return;

  if (!local && !hasWrittenModalCenter(facts, slices, writtenKey, minor, metricAt)) return;
  const sopranoTonic = pitchClassEquals(after.notes.soprano!.pitch, root);
  const completion = metric.confidence === "ambiguous" ? undefined
    : strongPosition(metric) && sopranoTonic ? "perfect" : "imperfect";
  return { completion, center: local ? "local" : "sounding" };
}
