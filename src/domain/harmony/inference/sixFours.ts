import { chordIdentityEquals, chordIdentityInversion, chordIdentityToneSpellingForDegree, primaryHarmonyInterpretation, type HarmonySemantics } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, writtenInterval } from "../../pitch";
import { fitCadentialRevoicing } from "./candidates";
import type { ChordInferenceCandidate, ChordInferenceObservation } from "./types";

type CandidateSet = readonly ChordInferenceCandidate[];
type SixFourRole = Extract<HarmonySemantics["cadenceRole"], "passing64" | "pedal64">;

function primaryTriad(candidates: CandidateSet) {
  return candidates.find(c =>
    c.semantics && !primaryHarmonyInterpretation(c.semantics).appliedTarget &&
    (c.functionalBaseId === "T" || c.functionalBaseId === "t" ||
     c.functionalBaseId === "S" || c.functionalBaseId === "s" ||
     c.functionalBaseId === "D" || c.functionalBaseId === "d") &&
    c.identity.structure.kind === "tertian" &&
    (c.identity.structure.quality === "major" || c.identity.structure.quality === "minor") &&
    c.fit.spellingConsistent && !c.fit.omittedChordDegrees.length && !c.fit.nonChordToneNoteIds.length,
  );
}

function sameKey(a: ChordInferenceObservation, b: ChordInferenceObservation) {
  return a.key.mode === b.key.mode && pitchClassEquals(a.key.tonic, b.key.tonic);
}

function rootDominant(c: ChordInferenceCandidate) {
  return c.functionalBaseId === "D" && c.semantics && !primaryHarmonyInterpretation(c.semantics).appliedTarget &&
    chordIdentityInversion(c.identity) === 0 && c.fit.spellingConsistent && !c.fit.nonChordToneNoteIds.length;
}

function resolvesToDominant(
  first: ChordInferenceObservation, last: ChordInferenceObservation, next: ChordInferenceObservation,
  candidates: CandidateSet, fullClose: boolean,
) {
  if (!first.metric || !next.metric || first.metric.confidence !== "certain" || next.metric.confidence !== "certain" ||
      first.metric.level <= next.metric.level || !last.bass || !next.bass ||
      !sameKey(first, next) || !pitchClassEquals(last.bass.pitch, next.bass.pitch)) return false;
  const dominant = candidates.find(rootDominant);
  if (!dominant) return false;
  // In a closing cadence the upper parts may redistribute or leap in the
  // resolution, and the dominant bass may move by an octave (Spasobin §9.3).
  if (fullClose) return true;
  const leading = chordIdentityToneSpellingForDegree(dominant.identity, 3);
  const fifth = chordIdentityToneSpellingForDegree(dominant.identity, 5);
  return (["soprano","alto","tenor"] as const).some(voice => {
    const a = last.activeNotes[voice]?.pitch, b = next.activeNotes[voice]?.pitch;
    if (!a || !b || !leading || !fifth) return false;
    const step = writtenInterval(a, b);
    return step.diatonicSteps === -1 && isWrittenStep(step) &&
      (pitchClassEquals(b, leading) || pitchClassEquals(b, fifth));
  });
}

function dominantContinuesToTonic(
  observations: readonly ChordInferenceObservation[], sets: readonly CandidateSet[], start: number,
) {
  const key = observations[start];
  for (let i = start; i < sets.length && sameKey(key, observations[i]); i++) {
    if (sets[i].some(rootDominant)) continue;
    return i > start && sets[i].some(c => (c.functionalBaseId === "T" || c.functionalBaseId === "t") &&
      chordIdentityInversion(c.identity) !== 2 && c.fit.spellingConsistent && !c.fit.nonChordToneNoteIds.length);
  }
  return false;
}

function roleBetween(
  left: ChordInferenceCandidate, middle: ChordInferenceCandidate, right: ChordInferenceCandidate,
  before: ChordInferenceObservation, during: ChordInferenceObservation, after: ChordInferenceObservation,
): SixFourRole | undefined {
  if (!before.bass || !during.bass || !after.bass || !sameKey(before, during) || !sameKey(during, after)) return;
  if (left.functionalBaseId !== right.functionalBaseId || left.functionalBaseId === middle.functionalBaseId) return;
  if (!during.metric || during.metric.confidence !== "certain" || during.metric.role === "downbeat") return;
  const into = writtenInterval(before.bass.pitch, during.bass.pitch);
  const out = writtenInterval(during.bass.pitch, after.bass.pitch);
  // The same primary triad returns over its original bass or over its third.
  if (into.semitones === 0 && out.semitones === 0 && into.diatonicSteps === 0 && out.diatonicSteps === 0 &&
      chordIdentityEquals(left.identity, right.identity) && chordIdentityInversion(left.identity) === 0 &&
      before.metric && before.metric.level > during.metric.level) return "pedal64";
  const inversions = [chordIdentityInversion(left.identity), chordIdentityInversion(right.identity)];
  if (inversions.includes(0) && inversions.includes(1) && isWrittenStep(into) && isWrittenStep(out) &&
      Math.sign(into.diatonicSteps) === Math.sign(out.diatonicSteps)) return "passing64";
}

/** Recognize a complete weak six-four between two presentations of the same harmony. */
export function classifySixFours(
  observations: readonly ChordInferenceObservation[], sets: readonly CandidateSet[], acceptMedium = true,
) {
  const triads = sets.map(primaryTriad);
  const classified = sets.slice();
  for (let start = 0; start + 1 < sets.length; start++) {
    const middle = triads[start];
    if (!middle || chordIdentityInversion(middle.identity) !== 2) continue;
    let end = start;
    while (end + 1 < sets.length && triads[end + 1] && sameKey(observations[end], observations[end + 1]) &&
           chordIdentityEquals(middle.identity, triads[end + 1]!.identity) &&
           observations[end].bass?.pitch.octave === observations[end + 1].bass?.pitch.octave) end++;
    const left = triads[start - 1], right = triads[end + 1];
    const role = left && right && roleBetween(left, middle, right, observations[start - 1], observations[start], observations[end + 1]);
    if (role) {
      for (let i = start; i <= end; i++) {
        classified[i] = sets[i].filter(c => c.functionalBaseId !== "K46").map(c =>
          c === triads[i] && c.semantics
            ? { ...c, semantics: { ...c.semantics, cadenceRole: role },
                evidence: [...c.evidence, { kind: "sequence-context", code: role }] }
            : c);
      }
    } else {
      const cadential = sets[start].find(c => c.functionalBaseId === "K46");
      if (!cadential || end + 1 >= sets.length) {
        start = end;
        continue;
      }
      const revoiced = acceptMedium && !sets[end + 1].length && end + 2 < sets.length &&
        sameKey(observations[start], observations[end + 1]) && observations[end + 1].metric?.confidence === "certain" &&
        observations[end + 1].metric!.level < (observations[start].metric?.level ?? 0)
        ? fitCadentialRevoicing(cadential, observations[end + 1]) : undefined;
      const target = end + (revoiced ? 2 : 1);
      const prepared = revoiced && sets[start - 1]?.some(c => ["S", "s", "SII", "N6", "It+6", "Fr+6", "Ger+6"].includes(c.functionalBaseId ?? "") &&
        c.fit.spellingConsistent && !c.fit.nonChordToneNoteIds.length) && sameKey(observations[start - 1], observations[start]);
      if (!resolvesToDominant(observations[start], observations[target - 1], observations[target], sets[target],
          !!prepared || dominantContinuesToTonic(observations, sets, target))) {
        start = end;
        continue;
      }
      for (let i = start; i <= end; i++) {
        classified[i] = sets[i].filter(c => c !== triads[i]).map(c => c.functionalBaseId === "K46"
          ? { ...c, evidence: [...c.evidence, { kind: "sequence-context", code: "cadential64-resolution" }] }
          : c);
      }
      if (revoiced) {
        end++;
        classified[end] = [revoiced];
      }
    }
    start = end;
  }
  return classified;
}

