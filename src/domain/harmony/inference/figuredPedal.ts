import { chordIdentityEquals, chordIdentityInversion, chordIdentityToneSpellingForDegree, primaryHarmonyInterpretation } from "../../chordModel";
import { keyDeclarationEquals, pitchClassEquals, spelledPitchEquals, toMidi } from "../../pitch";
import { readWrittenDominantSeventh } from "../facts/dominantMotion";
import { anchoredFiguration } from "../facts/anchoredFiguration";
import { crossesWrittenBoundary } from "../facts/ornamentalMotion";
import { fitContextualOrnament } from "./candidates";
import { observationNotes, resolvesTone, soundingBass, writtenFrame } from "./observations";
import { exactFit } from "./scoring";
import type { ChordInferenceCandidate as Candidate, ChordInferenceObservation as Frame } from "./types";

type SetOfCandidates = readonly Candidate[];
const isTonic = (c: Candidate) => c.functionalBaseId === "T" || c.functionalBaseId === "t";
const rootDominant = (c: Candidate) => c.functionalBaseId === "D" && chordIdentityInversion(c.identity) === 0 &&
  c.fit.spellingConsistent && c.fit.bassMatchesInversion && c.confidence !== "low";

function preparesDominant(c: Candidate) {
  if (!c.semantics || c.confidence === "low") return false;
  const reading = primaryHarmonyInterpretation(c.semantics);
  return c.identity.structure.kind === "augmented-sixth" || reading.appliedTarget?.degree === 5 ||
    reading.designation?.primaryFunction === "subdominant";
}

function authenticClose(frames: readonly Frame[], sets: readonly SetOfCandidates[], dominant: number,
  cuts: readonly number[]) {
  const first = frames[dominant];
  let writtenDominant = false;
  for (let i = dominant; frames[i] && frames[i].fromTick - first.fromTick <= (first.measureDurationTicks ?? 0); i++) {
    const frame = frames[i];
    if (!keyDeclarationEquals(first.key, frame.key) || !frame.completeSatb ||
        crossesWrittenBoundary(cuts, first.fromTick, frame.fromTick)) break;
    if (i > dominant && sets[i].some(c => isTonic(c) && chordIdentityInversion(c.identity) === 0 &&
        c.fit.bassMatchesInversion && c.confidence !== "low")) return writtenDominant;
    const candidate = sets[i].find(rootDominant);
    if (!candidate) break;
    // The identifying third can settle after a suspension at the V onset.
    // A complete V or a canonical fifth omission must sound before the tonic.
    const seventh = readWrittenDominantSeventh(frame.activeNotes);
    writtenDominant ||= exactFit(candidate) || !!seventh && seventh.inversion === 0 &&
      pitchClassEquals(seventh.root, candidate.identity.root);
  }
  return false;
}

export function descendingResolutions(source: Candidate, dominant: Candidate, from: Frame, to: Frame) {
  return ([[1, 3], [3, 5]] as const).filter(([a, b]) => {
    const left = chordIdentityToneSpellingForDegree(source.identity, a);
    const right = chordIdentityToneSpellingForDegree(dominant.identity, b);
    return left && right && resolvesTone(from, to, left, right, -1);
  }).length;
}

function pedalArrival(frames: readonly Frame[], sets: readonly SetOfCandidates[], start: number,
  cuts: readonly number[], withheld: ReadonlySet<number>) {
  const opening = frames[start];
  for (let end = start + 1; end < frames.length; end++) {
    const frame = frames[end], previous = frames[end - 1];
    const bass = frame.bass;
    if (!frame.completeSatb || !bass || !previous.bass || frame.fromTick !== previous.toTick ||
        frame.fromTick - opening.fromTick > (opening.measureDurationTicks ?? 0) ||
        !keyDeclarationEquals(opening.key, frame.key) || crossesWrittenBoundary(cuts, previous.fromTick, frame.fromTick) ||
        withheld.has(frame.fromTick) || !pitchClassEquals(bass.pitch, opening.bass!.pitch) ||
        Math.abs(toMidi(bass.pitch) - toMidi(previous.bass.pitch)) > 12 ||
        observationNotes(frame).some(({ note }) => toMidi(note.pitch) < toMidi(bass.pitch))) return;
    const dominant = sets[end].find(rootDominant);
    if (dominant) return { end, dominant };
    if (sets[end].some(c => c.semantics?.cadenceRole === "pedal64" || c.semantics?.cadenceRole === "passing64")) return;
  }
}

function fitPedalFrames(parts: readonly Frame[], sets: readonly SetOfCandidates[], anchor: Candidate,
  dominant: Candidate, allowOrnaments: boolean) {
  const assignments = anchoredFiguration(parts.map(writtenFrame), anchor.identity, dominant.identity);
  if (!assignments || !allowOrnaments && Object.keys(assignments).length) return;
  const restored: Candidate[] = [];
  for (const part of parts.slice(0, -1)) {
    const existing = sets[part.index].find(c => c.functionalBaseId === "K46" && chordIdentityEquals(c.identity, anchor.identity));
    const local = Object.fromEntries(observationNotes(part).flatMap(({ note }) =>
      assignments[note.id] ? [[note.id, assignments[note.id]]] : []));
    const candidate = existing ?? fitContextualOrnament(anchor, part, local, "figured-dominant-pedal");
    if (!candidate) return;
    restored.push(candidate);
  }
  return restored;
}

/** A previously proved tied preparation may precede the first complete
 * statement. Keep the role and endpoints from its own ornament proof. */
function preparedOpening(frames: readonly Frame[], sets: readonly SetOfCandidates[], i: number, anchor: Candidate,
  cuts: readonly number[], withheld: ReadonlySet<number>) {
  const prepared: Candidate[] = [];
  for (let j = i - 1; j >= 0; j--) {
    const frame = frames[j];
    if (!frame.bass || !spelledPitchEquals(frame.bass.pitch, frames[i].bass!.pitch) ||
        frame.toTick !== frames[j + 1].fromTick || !keyDeclarationEquals(frame.key, frames[i].key) ||
        withheld.has(frame.fromTick) || crossesWrittenBoundary(cuts, frame.fromTick, frames[j + 1].fromTick)) break;
    const candidate = sets[j].find(c => c.functionalBaseId === "K46" && chordIdentityEquals(c.identity, anchor.identity) &&
      c.evidence.some(e => e.code === "contextual-suspension"));
    if (!candidate) break;
    prepared.unshift(candidate);
  }
  return prepared;
}

/** Once the dominant and the ornament passes have run, revisit the pedal
 * with its actual metric onset and the first written root-position V. */
export function resolveFiguredPedals(frames: readonly Frame[], sets: readonly SetOfCandidates[],
  cuts: readonly number[], allowOrnaments: boolean, withheld: ReadonlySet<number>) {
  const result = sets.slice();
  for (let i = 0; i + 1 < frames.length; i++) {
    const anchor = sets[i].find(c => c.functionalBaseId === "K46" && exactFit(c));
    if (!anchor || !soundingBass(frames[i]) || withheld.has(frames[i].fromTick)) continue;
    const prefix = preparedOpening(frames, sets, i, anchor, cuts, withheld);
    const first = i - prefix.length, opening = frames[first], prior = frames[first - 1];
    if (opening.metric?.confidence !== "certain" || opening.metric.role === "subdivision" ||
        sets[first - 1]?.some(rootDominant)) continue;
    const target = pedalArrival(frames, sets, i, cuts, withheld);
    if (!target) continue;
    const { end, dominant } = target;
    const frame = frames[end];
    if (frame.metric?.confidence !== "certain") continue;
    const count = descendingResolutions(anchor, dominant, frames[end - 1], frame);
    const close = authenticClose(frames, sets, end, cuts);
    const approached = prior?.bass && keyDeclarationEquals(prior.key, opening.key) &&
      !crossesWrittenBoundary(cuts, prior.fromTick, opening.fromTick) &&
      !pitchClassEquals(prior.bass.pitch, opening.bass!.pitch);
    if ((opening.metric.level < frame.metric.level && !approached) ||
        (count < 2 && !(close && (count > 0 || approached && sets[first - 1].some(preparesDominant))))) continue;
    const restored = fitPedalFrames(frames.slice(i, end + 1), sets, anchor, dominant, allowOrnaments && close);
    if (!restored) continue;
    for (const candidate of [...prefix, ...restored]) {
      result[candidate.observationIndex] = [{ ...candidate, evidence: [...candidate.evidence,
        { kind: "sequence-context", code: "cadential64-resolution" }] }];
    }
    i = end - 1;
  }
  return result;
}
