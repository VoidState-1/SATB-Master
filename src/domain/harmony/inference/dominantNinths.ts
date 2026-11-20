import { chordIdentityEquals, chordIdentityToneSpellingForDegree, primaryHarmonyInterpretation } from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, type SpelledPitchClass } from "../../pitch";
import type { VoiceId } from "../../project";
import { VOICE_ORDER } from "../../project/voice";
import {
  dominantNinthTone, preparedNinthOverDominantSeventh, writtenDominantNinthResolves,
} from "../writtenDominantNinth";
import { soundsCompleteWrittenChord } from "../writtenVoicing";
import { candidateComparator, createFunctionalCandidate, fitPreparedSuspension } from "./candidates";
import { dominantNinthTemplates } from "./functionalTemplates";
import { soundingBass } from "./observations";
import type {
  ChordInferenceCandidate, ChordInferenceEvidence, ChordInferenceObservation,
  ChordInferenceOptions, ChordInferenceRegion, FunctionalChordTemplate,
} from "./types";

const seventhTemplate: FunctionalChordTemplate = {
  baseId: "D", localKeyPolicy: "current-key", definition: functionalDefinition("D"),
  form: "seventh", expectedInversion: 0,
};

function connects(a: ChordInferenceObservation, b: ChordInferenceObservation, boundaries: readonly number[]) {
  return a.toTick === b.fromTick && keyEquals(a.key, b.key) && !boundaries.some(tick => a.fromTick < tick && tick <= b.fromTick);
}

function written(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && !candidate.fit.nonChordToneNoteIds.length;
}

function suppliesPreparation(candidate: ChordInferenceCandidate) {
  if (!candidate.semantics || !written(candidate) || candidate.fit.omittedChordDegrees.length) return false;
  const reading = primaryHarmonyInterpretation(candidate.semantics);
  return !reading.appliedTarget && reading.designation?.primaryFunction === "subdominant";
}

/** Spasobin §23.3–5 supplies distinct facts about preparation and exit.
 * An accented ninth held from an exact preparation chord also permits a
 * parallel reading as a suspension over the written V7. */
export function withDominantNinths(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  boundaries: readonly number[],
  options: ChordInferenceOptions,
) {
  const result = sets.slice();
  const alternate = new Map<string, ChordInferenceCandidate>();
  for (const [index, source] of observations.entries()) {
    const bass = soundingBass(source);
    if (!bass || source.soundingPitchClasses.length !== 4 ||
        !pitchClassEquals(bass, scaleDegreePitchClass(source.key, 5))) continue;
    const candidate = dominantNinthTemplates
      .map(template => createFunctionalCandidate(source, template, {}))
      .find(item => item && written(item));
    if (!candidate) continue;
    const ninth = dominantNinthTone(candidate.identity);
    const seventh = chordIdentityToneSpellingForDegree(candidate.identity, 7);
    if (!ninth || !seventh) continue;
    const voiceWithTone = (tone: SpelledPitchClass) => VOICE_ORDER.find(voice => {
      const note = source.activeNotes[voice];
      return note && !note.nonChordToneRole && pitchClassEquals(note.pitch, tone);
    });
    const ninthVoice = voiceWithTone(ninth);
    const seventhVoice = voiceWithTone(seventh);
    const ninthNote = ninthVoice && source.activeNotes[ninthVoice];
    if (!ninthNote || !seventhVoice) continue;

    const previous = observations[index - 1], landing = observations[index + 1];
    const retainsPitch = (other: ChordInferenceObservation, voice: VoiceId) => {
      const note = other.activeNotes[voice];
      const prior = source.activeNotes[voice];
      return !!prior && !!note && !note.nonChordToneRole && spelledPitchEquals(note.pitch, prior.pitch);
    };
    const heldFromPreparation = previous && connects(previous, source, boundaries) &&
      previous.activeNotes[ninthVoice]?.id === ninthNote.id;
    const prepared = heldFromPreparation && sets[index - 1].some(suppliesPreparation) &&
      retainsPitch(previous, seventhVoice);
    const nextNote = landing && connects(source, landing, boundaries) ? landing.activeNotes[ninthVoice] : undefined;
    const arrival = nextNote && !nextNote.nonChordToneRole && nextNote.startTick === landing.fromTick &&
      ninthNote.startTick + ninthNote.durationTicks === landing.fromTick ? nextNote : undefined;
    const tonic = arrival && sets[index + 1].some(target =>
      (target.functionalBaseId === "T" || target.functionalBaseId === "t") &&
      written(target) && !target.fit.omittedChordDegrees.length &&
      writtenDominantNinthResolves(candidate.identity, target.identity, ninthNote.pitch, arrival.pitch));
    const landingBass = arrival && soundingBass(landing);
    const suspension = arrival && landingBass && pitchClassEquals(landingBass, bass) &&
      pitchClassEquals(arrival.pitch, bass) &&
      VOICE_ORDER.filter(voice => voice !== "bass" && voice !== ninthVoice).every(voice => retainsPitch(landing, voice))
      ? createFunctionalCandidate(landing, seventhTemplate, {})
      : undefined;
    const resolvedSuspension = arrival && suspension && written(suspension) &&
      writtenDominantNinthResolves(candidate.identity, suspension.identity, ninthNote.pitch, arrival.pitch);
    if (!prepared && !tonic && !resolvedSuspension) continue;

    const evidence: ChordInferenceEvidence[] = [];
    if (prepared) evidence.push({
      kind: "sequence-context", code: "dominant-ninth-preparation", noteIds: [ninthNote.id],
      details: { atTick: source.fromTick },
    });
    if (tonic && arrival) evidence.push({
      kind: "sequence-context", code: "dominant-ninth-to-tonic", noteIds: [ninthNote.id, arrival.id],
      details: { atTick: landing.fromTick },
    });
    if (resolvedSuspension && arrival) evidence.push({
      kind: "sequence-context", code: "dominant-ninth-same-root-9-8", noteIds: [ninthNote.id, arrival.id],
      details: { atTick: landing.fromTick },
    });
    const proven = {
      ...candidate,
      confidence: "high" as const,
      evidence: [...candidate.evidence, ...evidence],
    };
    const otherReadings = result[index].filter(item => item.id !== proven.id &&
      (item.semantics || !chordIdentityEquals(item.identity, proven.identity)));

    const preparationBass = previous?.bass;
    const supportedSuspension = resolvedSuspension && suspension && options.allowNonChordToneCandidates !== false &&
      heldFromPreparation && preparationBass &&
      sets[index - 1].some(anchor => soundsCompleteWrittenChord(
        anchor.identity, Object.values(previous.activeNotes).filter(note => note !== undefined), preparationBass,
      ) && !chordIdentityEquals(anchor.identity, candidate.identity)) &&
      preparedNinthOverDominantSeventh(
        suspension.identity, previous.activeNotes, source.activeNotes, landing.activeNotes,
        source.fromTick, landing.fromTick, source.metric, landing.metric,
      ) === ninthNote.id;
    const parallel = supportedSuspension
      ? fitPreparedSuspension(suspension, source, [{ noteId: ninthNote.id, figure: "9-8" }])
      : undefined;
    // The same writing supports both accounts in §23.5. Keep the choice
    // alongside the literal path so its continuity bonus cannot erase V9.
    if (parallel) alternate.set(proven.id, { ...parallel, confidence: "high" });
    result[index] = [...otherReadings, proven].sort(candidateComparator);
    if (resolvedSuspension && suspension &&
        !result[index + 1].some(existing => existing.id === suspension.id && written(existing))) {
      result[index + 1] = [...result[index + 1].filter(existing => existing.id !== suspension.id), suspension]
        .sort(candidateComparator);
    }
  }
  return { candidates: result, alternate };
}

export function addDominantNinthAlternatives(
  regions: readonly ChordInferenceRegion[],
  alternate: ReadonlyMap<string, ChordInferenceCandidate>,
) {
  if (!alternate.size) return regions;
  return Object.freeze(regions.map(region => {
    const literal = region.selected;
    const choice = literal && alternate.get(literal.id);
    if (!literal || !choice || region.observationIndices.length !== 1) return region;
    return {
      ...region,
      alternatives: Object.freeze([
        { ...choice, observationIndex: literal.observationIndex },
        ...region.alternatives.filter(item => !chordIdentityEquals(item.identity, choice.identity)),
      ].slice(0, 3)),
    };
  }));
}
