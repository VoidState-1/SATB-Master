import {
  type ScaleDegree,
  chordToneSpellings,
  type KeyReference,
  chordIdentityEquals,
  chordIdentityInversion,
  semanticsFromChordDraft,
  primaryHarmonyInterpretation,
  type ChordIdentity,
} from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import {
  keyEquals,
  pitchClassEquals,
  scaleDegreePitchClass,
  writtenInterval,
  keyDeclarationEquals,
  isWrittenStep,
  toMidi,
  type SpelledPitch,
  spelledPitchEquals,
  type SpelledPitchClass,
  stepIndex,
  type Alteration,
  leadingTonePitchClass,
} from "../../pitch";
import { createFunctionalCandidate, createAbsoluteCandidate, createLoweredSupertonic } from "./candidates";
import { observationNotes, resolvesTone, soundingBass, writtenFrame } from "./observations";
import type {
  ChordInferenceCandidate,
  ChordInferenceObservation,
  ChordInferenceOptions,
  ChordInferenceCandidate as Candidate,
  ChordFitAssessment,
  ChordInferenceEvidence,
  FunctionalChordTemplate,
} from "./types";
import { compareMetricStrength } from "../../rhythm/metric";
import type { LocalKeyContext } from "./localKeys";
import { readSoundingTertianIdentity } from "../facts/writtenVoicing";
import { continuesInKey } from "./passContext";
import { fitChordObservation, identityForFunctionalTemplate } from "./scoring";

const degrees = [1, 2, 3, 4, 5, 6, 7] as const;
const raisedFourth = (degree: ScaleDegree) => degrees[(degree + 2) % degrees.length];

function writtenDiatonicStack(observation: ChordInferenceObservation) {
  const { key, soundingPitchClasses: pitches } = observation;
  if (!observation.completeSatb || (pitches.length !== 3 && pitches.length !== 4) ||
    observationNotes(observation).some(({ note }) => note.nonChordToneRole)) return undefined;

  for (const degree of degrees) {
    const tones = pitches.map((_, index) =>
      scaleDegreePitchClass(key, degrees[(degree - 1 + index * 2) % degrees.length]),
    );
    if (tones.every(tone => pitches.some(pitch => pitchClassEquals(pitch, tone))))
      return { degree, tones };
  }
  return undefined;
}

function sameKeyAndAdjacent(left: ChordInferenceObservation, right: ChordInferenceObservation) {
  return (left.toTick === right.fromTick || right.toTick === left.fromTick) &&
    keyEquals(left.key, right.key);
}

function revoicesDiatonicStack(
  observations: readonly ChordInferenceObservation[],
  stacks: readonly ReturnType<typeof writtenDiatonicStack>[],
  index: number,
  direction: -1 | 1,
) {
  const source = observations[index];
  const stack = stacks[index];
  const adjacent = observations[index + direction];
  if (!stack || !adjacent || !source.bass || !sameKeyAndAdjacent(source, adjacent)) return false;

  let otherIndex = index + direction;
  if (adjacent.completeSatb && adjacent.soundingPitchClasses.length === 3 && adjacent.attackVoiceIds.length === 1 &&
    observationNotes(adjacent).every(({ note }) => !note.nonChordToneRole &&
      stack.tones.some(tone => pitchClassEquals(tone, note.pitch)))) {
    const outer = observations[index + 2 * direction];
    if (outer && sameKeyAndAdjacent(adjacent, outer)) otherIndex += direction;
  }

  const other = stacks[otherIndex];
  const otherBass = observations[otherIndex].bass;
  return other?.tones.length === 4 && other.degree === stack.degree && !!otherBass &&
    !pitchClassEquals(source.bass.pitch, otherBass.pitch);
}

/** The lowered sixth of harmonic major supplies the diminished fifth of iiø7
 * or the diminished seventh of vii°7. Read all four written members. */
function harmonicMajorSeventh(observation: ChordInferenceObservation, options: ChordInferenceOptions) {
  if (observation.key.mode !== "major" || observation.soundingPitchClasses.length !== 4 ||
      !observation.soundingPitchClasses.some(p => pitchClassEquals(p, scaleDegreePitchClass(observation.key, 6, -1)))) return;
  const literal = readSoundingTertianIdentity(writtenFrame(observation));
  if (literal?.structure.kind !== "tertian") return;
  const quality = literal.structure.quality;
  const baseId = quality === "halfDiminished7" ? "SII" : quality === "diminished7" ? "DVII" : undefined;
  if (!baseId || !pitchClassEquals(literal.root, scaleDegreePitchClass(observation.key, baseId === "SII" ? 2 : 7))) return;
  const inversion = chordIdentityInversion(literal);
  if (inversion > 3) return;
  return createFunctionalCandidate(observation, {
    baseId, definition: { ...functionalDefinition(baseId), quality: () => quality }, form: "seventh",
    localKeyPolicy: "current-key", expectedInversion: inversion as 0 | 1 | 2 | 3,
  }, options);
}

/** Modal mixture keeps the written tonic. A second independently spelled
 * parallel-minor harmony corroborates a borrowed III, VI, or minor V7. */
function borrowedMinorHarmony(frames: readonly ChordInferenceObservation[], i: number, options: ChordInferenceOptions,
  boundaries: readonly number[]) {
  const source = frames[i];
  if (source.key.mode !== "major" || !soundingBass(source)) return;
  const parallel = { tonic: source.key.tonic, mode: "minor" as const };
  const literal = readSoundingTertianIdentity(writtenFrame(source));
  if (literal?.structure.kind !== "tertian") return;
  const quality = literal.structure.quality;
  const degree = ([3, 6, 5, 2] as const).find(n => pitchClassEquals(literal.root, scaleDegreePitchClass(parallel, n)));
  if (!degree || !(degree === 2 ? quality === "diminished" && chordIdentityInversion(literal) === 1 :
      degree === 5 ? quality === "minor7" : quality === "major" || quality === "major7")) return;
  const scale = degrees.map(n => scaleDegreePitchClass(parallel, n));
  const home = degrees.map(n => scaleDegreePitchClass(source.key, n));
  const corroborated = ([-1, 1] as const).some(direction => {
    for (let j = i + direction; frames[j]; j += direction) {
      const frame = frames[j];
      if (!soundingBass(frame) || !keyDeclarationEquals(source.key, frame.key) ||
          Math.abs(frame.fromTick - source.fromTick) > (source.measureDurationTicks ?? 0) ||
          boundaries.some(t => Math.min(frame.fromTick, source.fromTick) < t && t <= Math.max(frame.fromTick, source.fromTick))) break;
      const other = readSoundingTertianIdentity(writtenFrame(frame));
      if (!other || pitchClassEquals(other.root, literal.root)) continue;
      return frame.soundingPitchClasses.every(p => scale.some(t => pitchClassEquals(t, p))) &&
        frame.soundingPitchClasses.some(p => !home.some(t => pitchClassEquals(t, p)));
    }
    return false;
  });
  if (!corroborated) return;
  const baseId = degree === 3 ? "dtIII" : degree === 6 ? "TSVI" : degree === 2 ? "SII" : "d";
  const definition = functionalDefinition(baseId);
  const inversion = chordIdentityInversion(literal) as 0 | 1 | 2 | 3;
  return createFunctionalCandidate(source, { baseId,
    definition: { ...definition, degreeAlteration: degree === 3 || degree === 6 ? -1 : 0, quality: () => quality },
    form: quality.endsWith("7") ? "seventh" : "triad", expectedInversion: inversion, localKeyPolicy: "current-key",
  }, options);
}

/** In diatonic sequences a fully written seventh can play a local dominant-like role. */
export function withDiatonicSevenths(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
  boundaries: readonly number[] = [],
) {
  const stacks = observations.map(writtenDiatonicStack);
  return observations.map((observation, i) => {
    const existing = candidateSets[i];
    const borrowed = !existing.some(c => c.fit.spellingConsistent && !c.fit.nonChordToneNoteIds.length) &&
      (harmonicMajorSeventh(observation, options) ?? borrowedMinorHarmony(observations, i, options, boundaries));
    if (borrowed) return [borrowed];
    const stack = stacks[i];
    if (!stack || stack.tones.length !== 4 || !observation.bass || observation.attackVoiceIds.length < 2 ||
      (stack.degree !== 1 && stack.degree !== 3 && stack.degree !== 6)) return existing;

    const bass = observation.bass.pitch;
    const inversion = stack.tones.findIndex(tone => pitchClassEquals(bass, tone));
    const seventh = observationNotes(observation).find(({ note }) => pitchClassEquals(note.pitch, stack.tones[3]));
    if (!seventh || inversion < 0) return existing;

    const previous = observations[i - 1];
    const next = observations[i + 1];
    const before = previous && sameKeyAndAdjacent(previous, observation) ? stacks[i - 1] : undefined;
    const after = next && sameKeyAndAdjacent(observation, next) ? stacks[i + 1] : undefined;
    const continuation = after?.degree === raisedFourth(stack.degree)
      ? next.activeNotes[seventh.voiceId]
      : undefined;
    const motion = continuation && writtenInterval(seventh.note.pitch, continuation.pitch);
    const resolves = motion?.diatonicSteps === -1 && (motion.semitones === -1 || motion.semitones === -2);
    const predecessor = before?.tones.length === 4 && raisedFourth(before.degree) === stack.degree
      ? previous.activeNotes[seventh.voiceId]
      : undefined;
    const prepared = predecessor && after?.degree === stack.degree &&
      seventh.note.startTick === observation.fromTick &&
      pitchClassEquals(predecessor.pitch, seventh.note.pitch) &&
      predecessor.pitch.octave === seventh.note.pitch.octave;
    const revoiced = revoicesDiatonicStack(observations, stacks, i, -1) ||
      revoicesDiatonicStack(observations, stacks, i, 1);
    if (!resolves && !prepared && !revoiced) return existing;

    const major = observation.key.mode === "major";
    const baseId = stack.degree === 1 ? (major ? "T" : "t")
      : stack.degree === 3 ? (major ? "DTIII" : "dtIII") : "TSVI";
    const majorSeventh = stack.degree === 1 ? major : !major;
    const quality = majorSeventh ? "major7" : "minor7";
    const definition = functionalDefinition(baseId);
    const candidate = createFunctionalCandidate(observation, {
      baseId,
      definition: { ...definition, forms: ["seventh"], quality: () => quality },
      form: "seventh",
      localKeyPolicy: "current-key",
      expectedInversion: inversion as 0 | 1 | 2 | 3,
    }, options);
    if (!candidate || candidate.confidence !== "high") return existing;
    return [{ ...candidate, evidence: [...candidate.evidence, {
      kind: "sequence-context" as const,
      code: "diatonic-seventh-sequence",
      details: { degree: stack.degree, resolves, prepared: Boolean(prepared), revoiced: Boolean(revoiced) },
    }] }, ...existing];
  });
}

function exactPassingTonicFit(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && !candidate.fit.nonChordToneNoteIds.length &&
    !candidate.fit.omittedChordDegrees.length;
}

function descendsByStep(from: SpelledPitch, to: SpelledPitch) {
  const interval = writtenInterval(from, to);
  return interval.diatonicSteps === -1 && interval.semitones < 0 && isWrittenStep(interval);
}

/** Spasobin §38.4, ex. 38–574: a passing tone can be the written seventh
 * of the prolonged chord. Here the actual bass supplies that seventh. */
export function withPassingTonicSevenths(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
  phraseBoundaryTicks: readonly number[],
) {
  return sets.map((existing, i) => {
    const before = observations[i - 1];
    const middle = observations[i];
    const after = observations[i + 1];
    if (!before?.bass || !middle.bass || !after?.bass ||
        !before.completeSatb || !middle.completeSatb || !after.completeSatb ||
        before.toTick !== middle.fromTick || middle.toTick !== after.fromTick ||
        !keyDeclarationEquals(before.key, middle.key) || !keyDeclarationEquals(middle.key, after.key) ||
        phraseBoundaryTicks.some(tick => before.fromTick < tick && tick <= after.fromTick) ||
        middle.soundingPitchClasses.length !== 4 ||
        compareMetricStrength(middle.metric, before.metric) !== "weaker" ||
        before.bass.nonChordToneRole || after.bass.nonChordToneRole ||
        middle.bass.startTick !== middle.fromTick || after.bass.startTick !== after.fromTick ||
        middle.toTick - middle.fromTick > before.toTick - before.fromTick ||
        !descendsByStep(before.bass.pitch, middle.bass.pitch) ||
        !descendsByStep(middle.bass.pitch, after.bass.pitch)) return existing;

    if ([before, middle, after].some(side =>
      observationNotes(side).some(({ note }) => note.nonChordToneRole ||
        toMidi(note.pitch) < toMidi(side.bass!.pitch)))) return existing;
    if (observationNotes(middle).some(({ voiceId, note }) =>
      voiceId !== "bass" && before.activeNotes[voiceId]?.id !== note.id)) return existing;

    const major = middle.key.mode === "major";
    const baseId = major ? "T" : "t";
    const root = middle.key.tonic;
    if (!sets[i - 1].some(candidate => candidate.functionalBaseId === baseId &&
      candidate.identity.structure.kind === "tertian" &&
      candidate.identity.structure.quality === (major ? "major" : "minor") &&
      pitchClassEquals(candidate.identity.bass, root) && exactPassingTonicFit(candidate)) ||
        !sets[i + 1].some(candidate => candidate.identity.structure.kind === "tertian" &&
          candidate.semantics && exactPassingTonicFit(candidate))) return existing;

    const definition = functionalDefinition(baseId);
    const candidate = createFunctionalCandidate(middle, {
      baseId,
      definition: { ...definition, forms: ["seventh"], quality: () => major ? "major7" : "minor7" },
      form: "seventh",
      localKeyPolicy: "current-key",
      expectedInversion: 3,
    }, options);
    if (!candidate || !exactPassingTonicFit(candidate) ||
        existing.some(other => other.id === candidate.id)) return existing;
    return [...existing, {
      ...candidate,
      evidence: [...candidate.evidence, { kind: "sequence-context" as const, code: "passing-tonic-seventh" }],
    }];
  });
}

function exactThirdInversionAnchor(item: ChordInferenceObservation, tones: readonly SpelledPitchClass[], bass: SpelledPitchClass) {
  const lowest = soundingBass(item);
  return !!lowest && pitchClassEquals(lowest, bass) && item.soundingPitchClasses.length === tones.length &&
    observationNotes(item).every(({ note }) => tones.some(t => pitchClassEquals(note.pitch, t)));
}

/** §15.2. Work backwards from the actual seventh in the bass. No key
 * label, including the printed degree of the destination, enters this proof. */
export function writtenThirdInversion(source: ChordInferenceObservation, arrival: ChordInferenceObservation) {
  const bass = soundingBass(source);
  if (!bass || source.soundingPitchClasses.length !== 4 || arrival.soundingPitchClasses.length !== 3) return;
  const tonic = scaleDegreePitchClass({ tonic: bass, mode: "major" }, 5);
  const dominant = scaleDegreePitchClass({ tonic, mode: "major" }, 5);
  const [root, third, fifth, seventh] = chordToneSpellings(dominant, "dominant7");
  if (!pitchClassEquals(bass, seventh) || !resolvesTone(source, arrival, root, root, 0) ||
      !resolvesTone(source, arrival, third, tonic, 1) || !resolvesTone(source, arrival, fifth, tonic, -1)) return;
  for (const mode of ["major", "minor"] as const) {
    const triad = chordToneSpellings(tonic, mode);
    if (exactThirdInversionAnchor(arrival, triad, triad[1]) && resolvesTone(source, arrival, seventh, triad[1], -1))
      return { tonic, mode };
  }
}

function descendingBassStep(left: ChordInferenceObservation, right: ChordInferenceObservation) {
  const a = left.bass, b = right.bass;
  if (!a || !b || b.startTick !== right.fromTick) return false;
  const motion = writtenInterval(a.pitch, b.pitch);
  return isWrittenStep(motion) && motion.diatonicSteps === -1 && motion.semitones < 0;
}

function rootedDominant(middle: ChordInferenceObservation, end: ChordInferenceObservation, key: KeyReference) {
  const tonic = chordToneSpellings(key.tonic, key.mode);
  const seventh = middle.soundingPitchClasses.length === 4;
  const tones = chordToneSpellings(scaleDegreePitchClass(key, 5), seventh ? "dominant7" : "major");
  if (!exactThirdInversionAnchor(middle, tones, tones[2]) || !exactThirdInversionAnchor(end, tonic, tonic[0]) || !descendingBassStep(middle, end) ||
      !resolvesTone(middle, end, tones[0], tones[0], 0) || !resolvesTone(middle, end, tones[1], tonic[0], 1))
    return;
  if (seventh && !resolvesTone(middle, end, tones[3], tonic[1], -1)) return;
  return { tones, seventh };
}

function ascendingStep(left: ChordInferenceObservation, right: ChordInferenceObservation, from: SpelledPitchClass, to: SpelledPitchClass) {
  return observationNotes(left).some(({ voiceId, note }) => {
    const next = right.activeNotes[voiceId];
    if (!next || next.startTick !== right.fromTick || !pitchClassEquals(note.pitch, from) ||
        !pitchClassEquals(next.pitch, to)) return false;
    const motion = writtenInterval(note.pitch, next.pitch);
    return motion.diatonicSteps === 1 && motion.semitones > 0 && isWrittenStep(motion);
  });
}

/** §13.2–3 and §15.2. A second complete dominant inversion and root-position
 * tonic supply evidence independent of the initial third-inversion chord. */
export function adjacentTonicAnchor(frames: readonly ChordInferenceObservation[], i: number, key: KeyReference,
  connected: (first: number, last: number) => boolean,
) {
  const tonic = chordToneSpellings(key.tonic, key.mode);
  const arrival = frames[i + 1];
  const arrivalBass = soundingBass(arrival);
  if (!arrivalBass) return;
  let j = i + 2;
  for (; j < frames.length; j++) {
    const frame = frames[j];
    if (!frame.bass || !spelledPitchEquals(arrivalBass, frame.bass.pitch) || !exactThirdInversionAnchor(frame, tonic, tonic[1])) break;
  }
  if (frames[j + 1] && connected(i, j + 1) && descendingBassStep(frames[j - 1], frames[j])) {
    const anchor = rootedDominant(frames[j], frames[j + 1], key);
    if (anchor?.seventh && frames[j + 1].metric?.role === "downbeat")
      return { kind: "root-position-close", dominant: j, tonic: j + 1 };
    if (anchor && !anchor.seventh) {
      const { tones } = anchor;
      const left = frames[j - 1], middle = frames[j], end = frames[j + 1];
      if ((middle.metric?.role === "weak-beat" || middle.metric?.role === "subdivision") &&
          resolvesTone(left, middle, tones[0], tones[0], 0) &&
          resolvesTone(left, middle, tonic[0], tones[1], -1) &&
          ascendingStep(left, middle, tonic[0], tones[2]) && ascendingStep(middle, end, tones[2], tonic[1]))
        return { kind: "passing-six-four", dominant: j, tonic: j + 1 };
    }
  }
  // A new ii6–V2–I6 can continue the same goal after a distinct V43–I.
  if (i >= 3 && connected(i - 3, i + 1) && frames[i - 2].metric?.role === "downbeat") {
    const ii = chordToneSpellings(scaleDegreePitchClass(key, 2), key.mode === "major" ? "minor" : "diminished");
    if (exactThirdInversionAnchor(frames[i - 1], ii, ii[1]) && rootedDominant(frames[i - 3], frames[i - 2], key)?.seventh)
      return { kind: "preceding-close-and-ii6", dominant: i - 3, tonic: i - 2 };
  }
}

type SupertonicResolutionCandidateSet = readonly Candidate[];

function needsIdentity(set: SupertonicResolutionCandidateSet) {
  return set.every(c => !c.semantics && c.confidence === "low");
}

function literalDominant(item: ChordInferenceObservation, key: KeyReference, options: ChordInferenceOptions, inversion: 2 | 3) {
  const root = scaleDegreePitchClass(key, 5);
  const candidate = createAbsoluteCandidate(item, root, "dominant7", options);
  if (!candidate) return;
  const degree = (1 + (stepIndex(root.step) - stepIndex(item.key.tonic.step) + 7) % 7) as ScaleDegree;
  const diatonicRoot = scaleDegreePitchClass(item.key, degree);
  const alteration = root.alter - diatonicRoot.alter;
  if (diatonicRoot.step !== root.step || Math.abs(alteration) > 2) return candidate;
  return { ...candidate, semantics: semanticsFromChordDraft({
    degree, degreeAlteration: alteration as Alteration, quality: "dominant7", inversion,
    localKey: item.localKey, source: "inferred", confidence: "probable",
  }) };
}

export function withThirdInversionResolutions(
  frames: readonly ChordInferenceObservation[], sets: readonly SupertonicResolutionCandidateSet[], options: ChordInferenceOptions, boundaries: readonly number[],
) {
  if (options.minConfidence === "high") return sets;
  const result = sets.slice();
  const connected = (i: number, end: number) =>
    frames.slice(i, end + 1).every((f, offset) => keyDeclarationEquals(frames[i].key, f.key) &&
      (!offset || frames[i + offset - 1].toTick === f.fromTick)) &&
    !boundaries.some(t => frames[i].fromTick < t && t <= frames[end].fromTick);
  for (let i = 0; i + 1 < frames.length; i++) {
    const source = frames[i], goal = frames[i + 1];
    if ((!needsIdentity(result[i]) && !needsIdentity(result[i + 1])) || !connected(i, i + 1)) continue;
    const key = writtenThirdInversion(source, goal);
    if (!key) continue;
    const homeSupertonic = source.key.mode === "minor" && pitchClassEquals(key.tonic, scaleDegreePitchClass(source.key, 2));
    const anchor = adjacentTonicAnchor(frames, i, key, connected);
    if (!homeSupertonic && !anchor) continue;

    // Keep the existing single-pair contract on the home minor supertonic.
    // Other targets require an independently voiced return to a root-position tonic.
    const sourceChord = literalDominant(source, key, options, 3);
    // Keep the local tonic role in the proof. A literal degree on this triad
    // would also assert home-key doubling or progression obligations.
    const tonicChord = (j: number) => createAbsoluteCandidate(frames[j], key.tonic, key.mode, options);
    const readings = [{ j: i, candidate: sourceChord, role: "D2" },
      { j: i + 1, candidate: tonicChord(i + 1), role: "T6" }];
    // Revoicing over the same bass belongs to the witnessed I6. The passing
    // V64 is evidence only: a bare 64 would leave its doubling unexplained.
    if (anchor && anchor.dominant > i) {
      for (let j = i + 2; j < anchor.dominant; j++) readings.push({ j, candidate: tonicChord(j), role: "T6" });
    }
    if (anchor && anchor.kind !== "passing-six-four") {
      readings.push({ j: anchor.dominant, candidate: literalDominant(frames[anchor.dominant], key, options, 2), role: "D43" },
        { j: anchor.tonic, candidate: tonicChord(anchor.tonic), role: "T" });
    }
    if (!readings.every(({ j, candidate }) => candidate && result[j].every(c => chordIdentityEquals(c.identity, candidate.identity)))) continue;
    for (const { j, candidate, role } of readings) {
      if (!candidate || !needsIdentity(result[j])) continue;
      const evidence = { kind: "sequence-context" as const, code: homeSupertonic ? "written-supertonic-resolution" : "written-third-inversion-return",
        details: { fromTick: source.fromTick, toTick: goal.fromTick, ...(anchor ? {
          anchor: anchor.kind, dominantTick: frames[anchor.dominant].fromTick, rootTonicTick: frames[anchor.tonic].fromTick,
          tonicStep: key.tonic.step, tonicAlter: key.tonic.alter, mode: key.mode, role,
        } : {}) } };
      result[j] = [{ ...candidate, confidence: "medium", score: { ...candidate.score, functionalTier: 3 },
        evidence: [...candidate.evidence, evidence] }];
    }
  }
  return result;
}

type Observation = ChordInferenceObservation;
type LeadingSeventhIntoConfirmedKeyCandidateSet = readonly ChordInferenceCandidate[];
const leadingSeventhInversions = [0, 1, 2, 3] as const;

function exactConfirmedKeyLeadingSeventh(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && !candidate.fit.omittedChordDegrees.length &&
    !candidate.fit.nonChordToneNoteIds.length;
}

function hasWrittenLowestBass(item: Observation) {
  const bass = item.bass;
  if (!bass) return false;
  const lowest = toMidi(bass.pitch);
  return observationNotes(item).every(({ note }) => toMidi(note.pitch) >= lowest);
}

function confirmLeadingSeventhArrival(
  observations: readonly Observation[],
  i: number,
  source: Observation,
  arrival: Observation,
  contexts: ReadonlyMap<number, LocalKeyContext>,
  phraseBoundaries: readonly number[],
) {
  const tonicBass = arrival.bass;
  if (!tonicBass || source.toTick !== arrival.fromTick || arrival.key.id !== source.key.id) return;
  const bassEnd = tonicBass.startTick + tonicBass.durationTicks;
  const tonicNotes = observationNotes(arrival).filter(({ note }) =>
    !note.nonChordToneRole && note.startTick + note.durationTicks >= bassEnd);
  if (tonicNotes.length < 3) return;
  let j = i + 2;
  while (j < observations.length) {
    const frame = observations[j];
    if (frame.bass?.id !== tonicBass.id) break;
    j++;
  }

  const dominantOnset = observations[j];
  const bass = dominantOnset?.bass;
  if (!bass || dominantOnset.fromTick !== bassEnd || dominantOnset.key.id !== source.key.id) return;
  // The dominant itself can begin with a written rest in the upper voice.
  // Look up the key proven by the existing pipeline within this bass event.
  let proof: LocalKeyContext | undefined;
  for (let k = j; k < observations.length && observations[k].key.id === source.key.id &&
    observations[k].bass?.id === bass.id; k++) {
    proof = contexts.get(k);
    if (proof) break;
  }
  if (!proof || proof.dominantIndex < j || proof.tonicIndex <= proof.dominantIndex ||
      observations.slice(i, proof.tonicIndex + 1).some(frame =>
        frame.key.id !== source.key.id || !hasWrittenLowestBass(frame)) ||
      phraseBoundaries.some(tick => source.fromTick < tick && tick <= observations[proof.tonicIndex].fromTick))
    return;
  // A repeated window may have started earlier, but this pivot still needs
  // a V-I witness of its own after the written diminished-seventh arrival.
  if (proof.evidence === "parallel-pivot") return;
  const key = proof.key;
  if (keyEquals(source.key, key) || (arrival.localKey && !keyEquals(arrival.localKey, key)) ||
      !pitchClassEquals(bass.pitch, scaleDegreePitchClass(key, 5))) return;

  const dominantNotes = observationNotes(dominantOnset).filter(({ note }) => !note.nonChordToneRole);
  const dominant = chordToneSpellings(bass.pitch, "major");
  if (!dominant.every(tone => dominantNotes.some(({ note }) => pitchClassEquals(note.pitch, tone))))
    return;
  const tonic = chordToneSpellings(key.tonic, key.mode);
  if (!tonic.every(tone => tonicNotes.some(({ note }) => pitchClassEquals(note.pitch, tone))) ||
      ![tonic[0], tonic[1]].some(tone => pitchClassEquals(tone, tonicBass.pitch)) ||
      observationNotes(arrival).some(({ note }) =>
        note.nonChordToneRole || !tonic.some(tone => pitchClassEquals(note.pitch, tone)))) return;
  return proof;
}

/** Spasobin §57.8a permits a written vii°7 to resolve straight to the new
 * tonic. The ensuing independently inferred V–I must confirm that key. */
export function withLeadingSeventhIntoConfirmedKey(
  observations: readonly Observation[],
  sets: readonly LeadingSeventhIntoConfirmedKeyCandidateSet[],
  options: ChordInferenceOptions,
  contexts: ReadonlyMap<number, LocalKeyContext>,
  phraseBoundaries: readonly number[],
) {
  return sets.map((existing, i) => {
    const source = observations[i], arrival = observations[i + 1];
    const sourceBass = source.bass?.pitch;
    if (!arrival || !source.completeSatb || !sourceBass || source.localKey ||
        source.soundingPitchClasses.length !== 4 || existing.some(exactConfirmedKeyLeadingSeventh) ||
        observationNotes(source).some(({ note }) => note.nonChordToneRole)) return existing;

    const proof = confirmLeadingSeventhArrival(observations, i, source, arrival, contexts, phraseBoundaries);
    if (!proof) return existing;
    const key = proof.key;

    const leading = leadingTonePitchClass(key);
    const leadingNote = observationNotes(source).find(({ note }) => pitchClassEquals(note.pitch, leading));
    const resolved = leadingNote && arrival.activeNotes[leadingNote.voiceId];
    if (!leadingNote || !resolved || leadingNote.note.startTick + leadingNote.note.durationTicks !== arrival.fromTick ||
        resolved.startTick !== arrival.fromTick || !pitchClassEquals(resolved.pitch, key.tonic)) return existing;
    const motion = writtenInterval(leadingNote.note.pitch, resolved.pitch);
    if (motion.diatonicSteps !== 1 || motion.semitones !== 1) return existing;

    const tones = chordToneSpellings(leading, "diminished7");
    const inversion = leadingSeventhInversions.find(value => pitchClassEquals(sourceBass, tones[value]));
    if (inversion === undefined) return existing;
    const candidate = createFunctionalCandidate({ ...source, key: { ...source.key, ...key }, localKey: key }, {
      baseId: "DVII",
      definition: { ...functionalDefinition("DVII"), quality: () => "diminished7" },
      form: "seventh",
      localKeyPolicy: "current-key",
      expectedInversion: inversion,
    }, options);
    if (!candidate || !exactConfirmedKeyLeadingSeventh(candidate)) return existing;
    // Every previous reading required missing or foreign tones, or contradicted
    // the spelling. All four written members and the later cadence agree here.
    return [{ ...candidate, evidence: [...candidate.evidence, {
      kind: "sequence-context" as const, code: "written-leading-seventh-into-confirmed-key",
      details: { arrivalTick: arrival.fromTick, dominantTick: observations[proof.dominantIndex].fromTick,
        tonicTick: observations[proof.tonicIndex].fromTick },
    }] }];
  });
}

const pivotSeventhInversions = [0, 1, 2, 3] as const;

function hasRespelling(before: ChordInferenceObservation, pivot: ChordInferenceObservation) {
  const notes = observationNotes(before);
  return notes.every(({ voiceId, note }) => {
    const next = pivot.activeNotes[voiceId];
    return next && toMidi(note.pitch) === toMidi(next.pitch);
  }) && notes.some(({ voiceId, note }) => {
    const next = pivot.activeNotes[voiceId];
    return next && !pitchClassEquals(note.pitch, next.pitch);
  }) && before.soundingPitchClasses.some(root =>
    chordToneSpellings(root, "diminished7").every(tone =>
      before.soundingPitchClasses.some(pitch => pitchClassEquals(tone, pitch)),
    ),
  );
}

function hasExactSpelling(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && candidate.fit.nonChordToneNoteIds.length === 0;
}

function writtenPivotLeadingTone(
  pivot: ChordInferenceObservation,
  dominant: ChordInferenceObservation,
  tonic: ChordInferenceObservation,
  key: KeyReference,
) {
  const loweredSixth = scaleDegreePitchClass(key, 6, key.mode === "major" ? -1 : 0);
  const dominantRoot = scaleDegreePitchClass(key, 5);
  const notes = observationNotes(pivot);
  if (!notes.some(({ note }) => pitchClassEquals(note.pitch, loweredSixth)) ||
      !notes.every(({ voiceId, note }) => {
        const next = dominant.activeNotes[voiceId];
        if (!next) return false;
        const motion = toMidi(next.pitch) - toMidi(note.pitch);
        return pitchClassEquals(note.pitch, loweredSixth)
          ? motion === -1 && pitchClassEquals(next.pitch, dominantRoot)
          : spelledPitchEquals(next.pitch, note.pitch);
      })) return;

  const leadingTone = leadingTonePitchClass(key);
  const leadingNote = observationNotes(dominant).find(({ note }) =>
    pitchClassEquals(note.pitch, leadingTone),
  );
  const arrival = leadingNote && tonic.activeNotes[leadingNote.voiceId];
  if (!leadingNote || !arrival || !pitchClassEquals(arrival.pitch, key.tonic) ||
      toMidi(arrival.pitch) - toMidi(leadingNote.note.pitch) !== 1) return;

  return leadingTone;
}

export function withWrittenPivotSevenths(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
) {
  return sets.map((existing, observationIndex) => {
    const before = observations[observationIndex - 1];
    const pivot = observations[observationIndex];
    const dominant = observations[observationIndex + 1];
    const tonic = observations[observationIndex + 2];
    if (!before?.completeSatb || !pivot.completeSatb || !pivot.bass ||
        !dominant?.completeSatb || !tonic?.completeSatb || pivot.key.mode !== "major" ||
        before.toTick !== pivot.fromTick || before.key.id !== pivot.key.id ||
        !continuesInKey(pivot, dominant) || !continuesInKey(dominant, tonic) ||
        !hasRespelling(before, pivot)) return existing;

    const key = pivot.key;
    const tonicThird = scaleDegreePitchClass(key, 3);
    const hasDominant = sets[observationIndex + 1].some(candidate =>
      candidate.functionalBaseId === "D" && hasExactSpelling(candidate) &&
      candidate.identity.structure.kind === "tertian" &&
      candidate.identity.structure.quality === "dominant7" &&
      candidate.fit.omittedChordDegrees.length === 0,
    );
    const hasTonic = sets[observationIndex + 2].some(candidate =>
      candidate.functionalBaseId === "T" && hasExactSpelling(candidate) &&
      candidate.identity.structure.kind === "tertian" &&
      candidate.identity.structure.quality === "major" &&
      (pitchClassEquals(candidate.identity.bass, key.tonic) ||
        pitchClassEquals(candidate.identity.bass, tonicThird)),
    );
    if (!hasDominant || !hasTonic) return existing;

    const leadingTone = writtenPivotLeadingTone(pivot, dominant, tonic, key);
    if (!leadingTone) return existing;

    const bass = pivot.bass.pitch;
    const tones = chordToneSpellings(leadingTone, "diminished7");
    const inversion = pivotSeventhInversions.find(index => pitchClassEquals(tones[index], bass));
    if (inversion === undefined) return existing;
    const candidate = createFunctionalCandidate(pivot, {
      baseId: "DVII",
      definition: { ...functionalDefinition("DVII"), quality: () => "diminished7" },
      form: "seventh",
      localKeyPolicy: "current-key",
      expectedInversion: inversion,
    }, options);
    if (candidate?.confidence !== "high" || !hasExactSpelling(candidate)) return existing;
    return [...existing, {
      ...candidate,
      id: `${candidate.id}:written-pivot-diminished7`,
      evidence: [...candidate.evidence, { kind: "sequence-context" as const, code: "written-pivot-leading-seventh" }],
    }];
  });
}

/** vii°7 and V7 may articulate one applied dominant. The seventh of
 * vii°7 drops to the root of V7 while the other voices hold, then the
 * same written leading tone resolves into the witnessed target triad. */
export function withAppliedLeadingSeventhPreparations(
  frames: readonly ChordInferenceObservation[], sets: readonly (readonly Candidate[])[], options: ChordInferenceOptions,
  boundaries: readonly number[],
) {
  return sets.map((existing, i) => {
    const source = frames[i], dominant = frames[i + 1], arrival = frames[i + 2];
    if (!arrival || source.soundingPitchClasses.length !== 4 || !soundingBass(source) ||
        !soundingBass(dominant) || !soundingBass(arrival) || !continuesInKey(source, dominant) ||
        !continuesInKey(dominant, arrival) || boundaries.some(t => source.fromTick < t && t <= arrival.fromTick) ||
        existing.some(c => hasExactSpelling(c) && c.semantics)) return existing;
    const applied = sets[i + 1].find(c => c.functionalBaseId === "D" && c.semantics &&
      c.identity.structure.kind === "tertian" && c.identity.structure.quality === "dominant7" &&
      hasExactSpelling(c) && !c.fit.omittedChordDegrees.length && primaryHarmonyInterpretation(c.semantics).appliedTarget);
    const target = applied?.semantics && primaryHarmonyInterpretation(applied.semantics).appliedTarget;
    const goal = target && readSoundingTertianIdentity(writtenFrame(arrival));
    if (!target || goal?.structure.kind !== "tertian" || (goal.structure.quality !== "major" && goal.structure.quality !== "minor") ||
        !pitchClassEquals(goal.root, scaleDegreePitchClass(source.key, target.degree))) return existing;
    const key = { tonic: goal.root, mode: goal.structure.quality };
    if (!writtenPivotLeadingTone(source, dominant, arrival, key)) return existing;
    const tones = chordToneSpellings(leadingTonePitchClass(key), "diminished7");
    const inversion = pivotSeventhInversions.find(n => pitchClassEquals(source.bass!.pitch, tones[n]));
    if (inversion === undefined) return existing;
    const candidate = createFunctionalCandidate(source, {
      baseId: "DVII", definition: { ...functionalDefinition("DVII"), quality: () => "diminished7" },
      form: "seventh", localKeyPolicy: "current-key", expectedInversion: inversion, appliedTarget: target.degree,
    }, options);
    if (!candidate || !hasExactSpelling(candidate) || candidate.confidence !== "high") return existing;
    return [{ ...candidate, evidence: [...candidate.evidence, { kind: "sequence-context" as const,
      code: "applied-leading-seventh-through-dominant", details: { target: target.degree, arrivalTick: arrival.fromTick } }] }];
  });
}

const appliedDegrees = [2, 3, 4, 6, 7] as const;

function exactNeapolitanPivotFit(fit: ChordFitAssessment) {
  return fit.spellingConsistent && fit.bassMatchesInversion && !fit.hardRejected &&
    fit.omittedChordDegrees.length === 0 && fit.nonChordToneNoteIds.length === 0;
}

function destinationEvidence(
  observations: readonly ChordInferenceObservation[],
  source: ChordInferenceObservation,
  pivot: ChordInferenceObservation,
  context: LocalKeyContext,
  phraseBoundaries: readonly number[],
  targetDegree: number,
): ChordInferenceEvidence | undefined {
  const { key, dominantIndex, tonicIndex } = context;
  const dominant = observations[dominantIndex], tonic = observations[tonicIndex];
  if (!dominant || !tonic || dominantIndex <= pivot.index ||
      dominant.toTick !== tonic.fromTick || dominant.key.id !== source.key.id ||
      tonic.key.id !== source.key.id || !soundingBass(dominant) || !soundingBass(tonic) ||
      phraseBoundaries.some(tick => source.fromTick < tick && tick < tonic.toTick) ||
      !resolvesTone(dominant, tonic, leadingTonePitchClass(key), key.tonic, 1)) return;

  return {
    kind: "sequence-context",
    code: "dominant-to-neapolitan-pivot",
    noteIds: [...new Set([dominant, tonic].flatMap(item => observationNotes(item).map(({ note }) => note.id)))],
    details: {
      target: targetDegree, pivotTick: pivot.fromTick, destinationDominantTick: dominant.fromTick,
      destinationTonicTick: tonic.fromTick, destinationTonicEndTick: tonic.toTick,
    },
  };
}

/** Spasobin §§53.4 and 15.2: a written D43–T or D2–T6 tonicizes the triad
 * that is subsequently heard as flat II in the same phrase's closing key. */
export function withNeapolitanPivotDominants(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
  localKeys: ReadonlyMap<number, LocalKeyContext>,
  phraseBoundaries: readonly number[],
): readonly (readonly ChordInferenceCandidate[])[] {
  return sets.map((existing, i) => {
    if (existing.length) return existing;
    const source = observations[i], pivot = observations[i + 1];
    if (!pivot || source.toTick !== pivot.fromTick || source.key.id !== pivot.key.id ||
        pivot.metric?.role !== "downbeat" || source.soundingPitchClasses.length !== 4) return existing;
    const bass = soundingBass(source), pivotBass = soundingBass(pivot);
    const destination = localKeys.get(pivot.index);
    if (!bass || !pivotBass || !destination || pitchClassEquals(source.key.tonic, destination.key.tonic)) return existing;

    const root = scaleDegreePitchClass(destination.key, 2, -1);
    const localTarget = appliedDegrees.find(degree => pitchClassEquals(scaleDegreePitchClass(source.key, degree), root));
    if (!localTarget) return existing;
    const triad = chordToneSpellings(root, "major");
    const tonicization = { tonic: root, mode: "major" } as const;
    const dominant = scaleDegreePitchClass(tonicization, 5);
    const tones = chordToneSpellings(dominant, "dominant7");
    const inversion = ([2, 3] as const).find(index => pitchClassEquals(bass, tones[index]));
    if (inversion === undefined || !pitchClassEquals(pivotBass, triad[inversion === 2 ? 0 : 1])) return existing;

    const pivotIdentity: ChordIdentity = {
      root,
      bass: { step: pivotBass.step, alter: pivotBass.alter },
      structure: { kind: "tertian", quality: "major", extensions: [], alterations: [] },
    };
    if (!exactNeapolitanPivotFit(fitChordObservation(pivot, pivotIdentity)) ||
        !resolvesTone(source, pivot, tones[0], triad[2], 0) ||
        !resolvesTone(source, pivot, tones[1], triad[0], 1) ||
        !resolvesTone(source, pivot, tones[2], triad[0], -1) ||
        !resolvesTone(source, pivot, tones[3], triad[1], -1)) return existing;
    const evidence = destinationEvidence(observations, source, pivot, destination, phraseBoundaries, localTarget);
    if (!evidence) return existing;

    const template: FunctionalChordTemplate = {
      baseId: "D", definition: functionalDefinition("D"), form: "seventh",
      expectedInversion: inversion, localKeyPolicy: "current-key",
    };
    const candidate = createFunctionalCandidate(source, { ...template, appliedTarget: localTarget }, options);
    if (!candidate?.semantics || candidate.confidence !== "high" || !exactNeapolitanPivotFit(candidate.fit)) return existing;

    // Keep the brief tonicization as a possible reading of this chord only.
    // The applied reading remains primary, with no new local-key span.
    const tonicized = identityForFunctionalTemplate(template, { ...source.key, ...tonicization }, tonicization);
    const alternative = primaryHarmonyInterpretation(tonicized.semantics);
    return [{
      ...candidate,
      semantics: { ...candidate.semantics, alternatives: [{ ...alternative, confidence: "ambiguous" }] },
      evidence: [...candidate.evidence, evidence],
    }];
  });
}

// The closing V7 or tonic may omit its fifth. Both tendency tones must resolve
// in their original registers and voices.
function authenticResolution(source: ChordInferenceObservation, target: ChordInferenceObservation, key: KeyReference) {
  const dominant = chordToneSpellings(scaleDegreePitchClass(key, 5), "dominant7");
  const tonic = chordToneSpellings(key.tonic, key.mode);
  return source.soundingPitchClasses.every(p => dominant.some(t => pitchClassEquals(p, t))) &&
    source.soundingPitchClasses.some(p => pitchClassEquals(p, dominant[0])) &&
    target.soundingPitchClasses.every(p => tonic.some(t => pitchClassEquals(p, t))) &&
    !!target.bass && pitchClassEquals(target.bass.pitch, tonic[0]) &&
    resolvesTone(source, target, dominant[1], tonic[0], 1) &&
    resolvesTone(source, target, dominant[3], tonic[1], -1);
}

function homeCadenceBefore(frames: readonly ChordInferenceObservation[], pivot: ChordInferenceObservation, boundaries: readonly number[]) {
  for (let i = pivot.index; i > 0; i--) {
    const target = frames[i], source = frames[i - 1];
    if (source.key !== pivot.key || source.localKey || source.toTick !== target.fromTick ||
        !soundingBass(source) || boundaries.some(t => source.fromTick < t && t <= target.fromTick)) break;
    if (target.soundingPitchClasses.length === 3 && source.soundingPitchClasses.length === 4 &&
        authenticResolution(source, target, pivot.key)) return source;
  }
}

function pivotReading(frame: ChordInferenceObservation, set: readonly Candidate[], key: KeyReference) {
  const old = set[0];
  if (set.length !== 1 || frame.localKey || !soundingBass(frame) || !old.semantics ||
      old.semantics.interpretations.length !== 1 || old.semantics.alternatives?.length ||
      old.confidence !== "high" || (old.functionalBaseId !== "T" && old.functionalBaseId !== "S" &&
        old.functionalBaseId !== "D")) return;
  const local = { ...frame, key: { ...frame.key, ...key }, localKey: key };
  const root = scaleDegreePitchClass(key, 2, -1);
  const candidate = pitchClassEquals(frame.bass!.pitch, root)
    ? createLoweredSupertonic(local, "major", 0)
    : createFunctionalCandidate(local, {
        baseId: "N6", definition: functionalDefinition("N6"),
        form: "triad", expectedInversion: 1, localKeyPolicy: "current-key",
      }, {});
  if (candidate?.semantics && candidate.confidence === "high" &&
      chordIdentityEquals(old.identity, candidate.identity))
    return { candidate, semantics: candidate.semantics, source: primaryHarmonyInterpretation(old.semantics) };
}

/** §53.4. One revoiced common major triad connects two independently heard
 * keys. Its first inversion leads by step into the destination K64–V7–I. */
export function withNeapolitanPivotSixths(
  frames: readonly ChordInferenceObservation[], sets: readonly (readonly Candidate[])[],
  localKeys: ReadonlyMap<number, LocalKeyContext>, boundaries: readonly number[],
) {
  const result = sets.slice();
  for (let i = 1; i + 3 < frames.length; i++) {
    const first = frames[i - 1], sixth = frames[i], k64 = frames[i + 1];
    const context = localKeys.get(k64.index);
    if (!context || context.dominantIndex !== i + 2 || context.tonicIndex !== i + 3 ||
        sets[i + 1].length !== 1 || sets[i + 1][0].functionalBaseId !== "K46") continue;
    const { key } = context, dominant = frames[i + 2], tonic = frames[i + 3];
    const cadence = [k64, dominant, tonic];
    if (first.key !== sixth.key || first.toTick !== sixth.fromTick ||
        cadence.some((item, n) => localKeys.get(item.index) !== context || item.key.id !== first.key.id ||
          frames[i + n].toTick !== item.fromTick || !soundingBass(item)) ||
        boundaries.some(t => first.fromTick < t && t < tonic.toTick) ||
        !spelledPitchEquals(k64.bass!.pitch, dominant.bass!.pitch) ||
        !pitchClassEquals(k64.bass!.pitch, scaleDegreePitchClass(key, 5)) ||
        !resolvesTone(k64, dominant, key.tonic, leadingTonePitchClass(key), -1) ||
        !authenticResolution(dominant, tonic, key)) continue;

    const start = pivotReading(first, sets[i - 1], key);
    const end = pivotReading(sixth, sets[i], key);
    if (!start || !end || end.candidate.functionalBaseId !== "N6" ||
        observationNotes(first).filter(({ voiceId, note }) => sixth.activeNotes[voiceId]?.id === note.id).length !== 3)
      continue;
    const tones = chordToneSpellings(end.candidate.identity.root, "major");
    const bassStep = writtenInterval(sixth.bass!.pitch, k64.bass!.pitch);
    if (bassStep.diatonicSteps !== 1 || bassStep.semitones !== 2 ||
        !resolvesTone(sixth, k64, tones[0], key.tonic, -1) ||
        !resolvesTone(sixth, k64, tones[1], scaleDegreePitchClass(key, 3), -1) ||
        !resolvesTone(sixth, k64, tones[2], k64.bass!.pitch, -1)) continue;
    const home = homeCadenceBefore(frames, first, boundaries);
    if (!home) continue;
    const evidence = { kind: "sequence-context" as const, code: "neapolitan-pivot-to-cadential-six-four",
      details: { homeDominantTick: home.fromTick, pivotTick: first.fromTick, tonicTick: tonic.fromTick },
      noteIds: [...new Set([home, frames[home.index + 1], first, sixth, ...cadence]
        .flatMap(item => observationNotes(item).map(({ note }) => note.id)))],
    };
    // The entry is the common chord. A different inversion continues in the
    // destination key; writing another pivot would assert a second modulation.
    const sameInversion = chordIdentityEquals(start.candidate.identity, end.candidate.identity);
    for (const [frame, reading] of [[first, start], [sixth, end]] as const) {
      const semantics = frame === first || sameInversion
        ? { ...reading.semantics, interpretations: [...reading.semantics.interpretations, reading.source] }
        : reading.semantics;
      result[frame.index] = [{ ...reading.candidate, semantics, evidence: [...reading.candidate.evidence, evidence] }];
    }
  }
  return result;
}
