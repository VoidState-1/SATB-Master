import {
  chordIdentityInversion,
  chordIdentityToneSpellings,
  type ChordIdentity,
  type ChordQuality,
  chordToneSpellings,
  type KeyReference,
  chordIdentityEquals,
  harmonySemanticsConfidence,
  primaryHarmonyInterpretation,
} from "../../chordModel";
import {
  keyEquals,
  isWrittenStep,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  toMidi,
  writtenInterval,
  type SpelledPitchClass,
} from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { compareMetricStrength, type MetricPosition } from "../../rhythm/metric";
import type { AnalysisSlice } from "../analysis";
import { leadingToneDescendsToTonicFifth } from "../facts/dominantMotion";
import { sameKey } from "../segments";
import { resolvesInVoice } from "../facts/tendencyResolution";
import { hasCompleteWrittenTertianVoicing, soundsCompleteWrittenChord } from "../facts/writtenVoicing";
import type { CadenceEvidence, CadenceSpanFacts } from "./model";
import { writtenNeighborsOverHeldBass } from "../facts/prolongation";

const decorationUpperVoices = ["soprano", "alto", "tenor"] as const;
const endOf = (note: { startTick: number; durationTicks: number }) => note.startTick + note.durationTicks;

function ordinaryRootChord(facts: CadenceSpanFacts, degree: 1 | 5, quality: ChordQuality) {
  const identity = facts.chord?.identity;
  const semantics = facts.span.semantics;
  return facts.degree === degree && facts.interpretationStatus === "resolved" &&
    identity?.structure.kind === "tertian" && identity.structure.quality === quality &&
    !identity.structure.extensions.length && !identity.structure.alterations.length &&
    !semantics?.cadenceRole && !semantics?.pedalContext && !semantics?.mixture &&
    pitchClassEquals(identity.root, scaleDegreePitchClass(facts.key, degree)) &&
    chordIdentityInversion(identity) === 0 ? identity : undefined;
}

function writtenArrival(before: AnalysisSlice, dominant: ChordIdentity, onset: AnalysisSlice, tonic: ChordIdentity) {
  if (!hasCadentialWrittenVoicing(before, dominant, true) ||
      !hasCadentialWrittenVoicing(onset, tonic, true) ||
      VOICE_ORDER.some(voice => onset.notes[voice]!.startTick !== onset.tick)) return false;

  const bass = writtenInterval(before.notes.bass!.pitch, onset.notes.bass!.pitch);
  if (!(bass.diatonicSteps === 3 && bass.semitones === 5 || bass.diatonicSteps === -4 && bass.semitones === -7)) return false;
  const [, leading, , seventh] = chordIdentityToneSpellings(dominant);
  const [root, third, fifth] = chordIdentityToneSpellings(tonic);
  return decorationUpperVoices.every(voice => {
    const from = before.notes[voice]!, to = onset.notes[voice]!;
    if (pitchClassEquals(from.pitch, leading)) {
      return resolvesInVoice(before, onset, voice, root, 1) ||
        (voice !== "soprano" && endOf(from) === onset.tick &&
          leadingToneDescendsToTonicFifth(from.pitch, to.pitch, leading, fifth));
    }
    return !pitchClassEquals(from.pitch, seventh) || resolvesInVoice(before, onset, voice, third, -1);
  });
}

/** A single weak cut in an already established final tonic. Keep the
 * audible arrival as the structural landing and the next tonic as release. */
export function closingTonicDecorationEvidence(
  dominant: CadenceSpanFacts,
  arrival: CadenceSpanFacts,
  terminal: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  metricAt: (tick: number) => MetricPosition | undefined,
  beatTicks: number,
): CadenceEvidence | undefined {
  if (!arrival.isTonic || !terminal.isTonic || !keyEquals(terminal.key, arrival.key)) return;
  const d = ordinaryRootChord(dominant, 5, "dominant7");
  const t = ordinaryRootChord(arrival, 1, arrival.key.mode);
  const finish = ordinaryRootChord(terminal, 1, arrival.key.mode);
  const before = slices[dominant.span.sliceIndices.at(-1)!];
  const onset = arrival.boundarySlice;
  const left = slices[arrival.span.sliceIndices.at(-1)!];
  const gap = left && slices[left.index + 1];
  const right = terminal.boundarySlice;
  const release = slices[terminal.span.sliceIndices.at(-1)!];
  if (!d || !t || !finish || !before || !onset || !left || !gap?.completeSatb || !right || !release ||
      before.endTick !== onset.tick || left.endTick !== gap.tick || gap.index >= right.index ||
      right.tick - gap.tick > beatTicks / 2 || !writtenArrival(before, d, onset, t)) return;
  // Repeating a key signature can split one sustained set of notes into several slices.
  if (slices.slice(gap.index, right.index).some(slice => slice.chord ||
      VOICE_ORDER.some(voice => slice.notes[voice]?.id !== gap.notes[voice]!.id))) return;
  const position = metricAt(gap.tick);
  if (position?.role !== "subdivision" || position.confidence !== "certain" ||
      compareMetricStrength(metricAt(right.tick), position) !== "stronger") return;
  if (slices.slice(before.index, release.index + 1).some(slice => !sameKey(slice.key, before.key)) ||
      !arrival.span.sliceIndices.every(index => hasCadentialWrittenVoicing(slices[index], t, true)) ||
      !terminal.span.sliceIndices.every(index => hasCadentialWrittenVoicing(slices[index], finish, false)) ||
      VOICE_ORDER.some(voice => endOf(release.notes[voice]!) !== terminal.span.toTick)) return;

  const bass = onset.notes.bass!, resumedBass = right.notes.bass!;
  if (left.notes.bass?.id !== bass.id || gap.notes.bass!.id !== bass.id ||
      !pitchClassEquals(resumedBass.pitch, bass.pitch)) return;
  if (resumedBass.id !== bass.id) {
    const motion = writtenInterval(bass.pitch, resumedBass.pitch);
    if (endOf(bass) !== right.tick || resumedBass.startTick !== right.tick ||
        Math.abs(motion.diatonicSteps) !== 7 || Math.abs(motion.semitones) !== 12) return;
  }

  const moving = decorationUpperVoices.filter(voice => gap.notes[voice]!.id !== left.notes[voice]!.id);
  const held = decorationUpperVoices.find(voice => !moving.includes(voice));
  if (moving.length !== 2 || !held || right.notes[held]!.id !== gap.notes[held]!.id) return;
  const notes = VOICE_ORDER.map(voice => gap.notes[voice]!);
  if (notes.some(note => toMidi(note.pitch) < toMidi(bass.pitch) || toMidi(note.pitch) > toMidi(gap.notes.soprano!.pitch)) ||
      hasCompleteWrittenTertianVoicing(notes.map(note => note.pitch))) return;

  const tones = chordIdentityToneSpellings(t);
  let stepwisePreparation = false;
  for (const voice of moving) {
    const from = left.notes[voice]!, decoration = gap.notes[voice]!, to = right.notes[voice]!;
    const entry = writtenInterval(from.pitch, decoration.pitch), exit = writtenInterval(decoration.pitch, to.pitch);
    if (tones.some(tone => pitchClassEquals(tone, decoration.pitch)) ||
        endOf(from) !== gap.tick || decoration.startTick !== gap.tick ||
        endOf(decoration) !== right.tick || to.startTick !== right.tick ||
        !isWrittenStep(exit) || exit.diatonicSteps !== Math.sign(exit.semitones)) return;
    const entersByStep = isWrittenStep(entry) && entry.diatonicSteps === Math.sign(entry.semitones);
    const role = decoration.nonChordToneRole;
    if (role && !(role === "neighbor" && spelledPitchEquals(from.pitch, to.pitch)) &&
        !(role === "passing" && entersByStep && entry.diatonicSteps === exit.diatonicSteps)) return;
    stepwisePreparation ||= entersByStep;
  }
  if (!stepwisePreparation) return;

  return {
    code: "closing-tonic-decoration",
    value: "属七实奏落主后，主低音和一个上声部保持，两个弱位装饰音级进回到主和弦",
    refs: [bass.id, gap.notes[held]!.id, ...moving.flatMap(voice => [gap.notes[voice]!.id, right.notes[voice]!.id])],
  };
}

export function writtenAttack(facts: CadenceSpanFacts, required: readonly SpelledPitchClass[]) {
  const slice = facts.boundarySlice;
  const bass = slice?.notes.bass;
  const soprano = slice?.notes.soprano;
  if (!slice || !bass || !soprano || !facts.chord || slice.endTick !== facts.span.toTick ||
      !pitchClassEquals(bass.pitch, facts.chord.identity.bass)) return false;
  const tones = chordIdentityToneSpellings(facts.chord.identity);
  const notes = Object.values(slice.notes);
  return required.every(tone => notes.some(note => pitchClassEquals(note.pitch, tone))) &&
    notes.every(note => note.startTick === slice.tick && note.startTick + note.durationTicks === slice.endTick &&
      !note.nonChordToneRole && toMidi(note.pitch) >= toMidi(bass.pitch) && toMidi(note.pitch) <= toMidi(soprano.pitch) &&
      tones.some(tone => pitchClassEquals(tone, note.pitch)));
}

export function sameDetachedRhythm(
  pre: AnalysisSlice, attack: AnalysisSlice, arrival: AnalysisSlice, slices: readonly AnalysisSlice[], beatTicks: number,
) {
  if (attack.index !== pre.index + 2 || arrival.index !== attack.index + 2) return false;
  const firstRest = slices[pre.index + 1], secondRest = slices[attack.index + 1];
  const duration = attack.endTick - attack.tick, gap = arrival.tick - attack.endTick;
  return duration <= beatTicks && gap > 0 && gap <= beatTicks && pre.endTick - pre.tick === duration &&
    attack.tick - pre.endTick === gap && !firstRest.chord && !secondRest.chord &&
    Object.keys(firstRest.notes).length === 0 && Object.keys(secondRest.notes).length === 0 &&
    [pre, firstRest, attack, secondRest].every(slice => slice.key.id === arrival.key.id);
}

function hasDetachedAuthenticApproach(
  preparation: CadenceSpanFacts, dominant: CadenceSpanFacts, arrival: AnalysisSlice, key: KeyReference,
  slices: readonly AnalysisSlice[], beatTicks: number | undefined, downbeat: number | undefined,
) {
  if (!preparation.isSubdominant || !preparation.chord || !dominant.chord || !beatTicks || downbeat !== arrival.tick ||
      chordIdentityInversion(dominant.chord.identity) !== 0) return false;
  const source = dominant.chord.identity.structure;
  if (source.kind !== "tertian" || source.quality !== "dominant7" || source.extensions.length || source.alterations.length) return false;

  const pre = preparation.boundarySlice, attack = dominant.boundarySlice;
  if (!pre?.notes.bass || !attack || !arrival.notes.soprano || !pitchClassEquals(arrival.notes.soprano.pitch, key.tonic) ||
      !keyEquals(preparation.key, key) ||
      !sameDetachedRhythm(pre, attack, arrival, slices, beatTicks)) return false;

  const [root, third, , seventh] = chordIdentityToneSpellings(dominant.chord.identity);
  return writtenAttack(preparation, chordIdentityToneSpellings(preparation.chord.identity)) &&
    writtenAttack(dominant, [root, third, seventh]) &&
    !slices.slice(arrival.index + 1).some(slice => Object.keys(slice.notes).length);
}

/** A rest can belong to an ongoing cadence when the predominant and dominant
 * use the same detached rhythm through the final downbeat. */
export function detachedAuthenticEvidence(
  preparation: CadenceSpanFacts | undefined, dominant: CadenceSpanFacts, tonic: CadenceSpanFacts,
  slices: readonly AnalysisSlice[], beatTicks: number | undefined, downbeat: number | undefined,
): CadenceEvidence | undefined {
  const arrival = tonic.boundarySlice, identity = tonic.chord?.identity;
  if (!preparation || !arrival || !identity || !tonic.isTonic || tonic.span.semantics?.cadenceRole ||
      downbeat !== tonic.span.fromTick || !pitchClassEquals(identity.root, tonic.key.tonic) ||
      chordIdentityInversion(identity) !== 0) return;
  const target = identity.structure;
  if (target.kind !== "tertian" || target.quality !== tonic.key.mode || target.extensions.length || target.alterations.length ||
      !hasDetachedAuthenticApproach(preparation, dominant, arrival, tonic.key, slices, beatTicks, downbeat) ||
      !writtenAttack(tonic, chordIdentityToneSpellings(identity).slice(0, 2))) return;
  return {
    code: "detached-dominant-to-tonic", value: "下属准备与属七以相同节奏起奏、全休，末端强拍落主",
    refs: [preparation.span.id, dominant.span.id, tonic.span.id],
  };
}

/** Mozart, Spasobin 20–277. Score only the cadence on the three sounding
 * notes; the rest pattern establishes the landing without a chord label. */
export function detachedSparseTonicEvidence(
  preparation: CadenceSpanFacts, dominant: CadenceSpanFacts, arrival: AnalysisSlice,
  slices: readonly AnalysisSlice[], beatTicks: number | undefined, downbeat: number | undefined,
): CadenceEvidence | undefined {
  const { bass, soprano, alto, tenor } = arrival.notes;
  const inner = alto ?? tenor;
  const sourceBass = dominant.boundarySlice?.notes.bass;
  if (arrival.chord || !bass || !soprano || !inner || (alto && tenor) || !sourceBass || !beatTicks ||
      arrival.endTick - arrival.tick < beatTicks ||
      !keyEquals(dominant.key, arrival.key)) return;
  const [root, third] = chordToneSpellings(arrival.key.tonic, arrival.key.mode);
  const notes = [bass, inner, soprano];
  if (!pitchClassEquals(bass.pitch, root) || !pitchClassEquals(soprano.pitch, root) || !pitchClassEquals(inner.pitch, third) ||
      toMidi(bass.pitch) >= toMidi(inner.pitch) || toMidi(inner.pitch) >= toMidi(soprano.pitch) ||
      notes.some(note => note.nonChordToneRole || note.startTick !== arrival.tick ||
        note.startTick + note.durationTicks !== arrival.endTick)) return;
  const motion = writtenInterval(sourceBass.pitch, bass.pitch);
  if (!((motion.diatonicSteps === 3 && motion.semitones === 5) ||
        (motion.diatonicSteps === -4 && motion.semitones === -7)) ||
      !hasDetachedAuthenticApproach(preparation, dominant, arrival, dominant.key, slices, beatTicks, downbeat)) return;
  return {
    code: "detached-sparse-tonic",
    value: "同型顿奏与全休之后，外声实奏主音，内声实奏三音，三个声部同步收束",
    refs: [preparation.span.id, dominant.span.id, ...notes.map(note => note.id)],
  };
}

function seventhResolutionId(
  before: AnalysisSlice,
  landing: AnalysisSlice,
  tonic: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  voice: (typeof VOICE_ORDER)[number],
  beatTicks: number,
) {
  const seventh = before.notes[voice]!;
  const tones = chordIdentityToneSpellings(tonic.chord!.identity);
  for (const index of tonic.span.sliceIndices) {
    const part = slices[index];
    const resolution = part.notes[voice];
    if (!part.completeSatb || part.tick > landing.tick + beatTicks ||
        part.key.id !== landing.key.id || part.notes.bass?.id !== landing.notes.bass?.id ||
        !resolution || resolution.nonChordToneRole) return;
    if (resolution.id === seventh.id) {
      // A later resolution cannot bridge a different harmony heard over the same bass.
      if (VOICE_ORDER.some(id => id !== voice && (part.notes[id]!.nonChordToneRole ||
          !tones.some(tone => pitchClassEquals(part.notes[id]!.pitch, tone))))) return;
      continue;
    }
    const motion = writtenInterval(seventh.pitch, resolution.pitch);
    const notes = VOICE_ORDER.map(voiceId => part.notes[voiceId]!);
    const resolves = resolution.startTick === part.tick && seventh.startTick + seventh.durationTicks === part.tick &&
      pitchClassEquals(resolution.pitch, tones[1]) && motion.diatonicSteps === -1 &&
      motion.semitones < 0 && isWrittenStep(motion) &&
      soundsCompleteWrittenChord(tonic.chord!.identity, notes, part.notes.bass!);
    return resolves ? resolution.id : undefined;
  }
}

/** Bridge one weak soprano attack between a fully voiced V7 and its
 * written tonic landing. The gap contributes evidence, not a chord region. */
export function dominantLandingGapEvidence(
  dominant: CadenceSpanFacts,
  tonic: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  metricAt: (tick: number) => MetricPosition | undefined,
  beatTicks: number,
): CadenceEvidence | undefined {
  const source = dominant.chord?.identity;
  const target = tonic.chord?.identity;
  if (!source || !target || source.structure.kind !== "tertian" ||
      source.structure.quality !== "dominant7" || source.structure.extensions.length || source.structure.alterations.length ||
      target.structure.kind !== "tertian" || target.structure.quality !== tonic.key.mode ||
      target.structure.extensions.length || target.structure.alterations.length ||
      !pitchClassEquals(target.root, tonic.key.tonic) || tonic.span.semantics?.cadenceRole) return;
  const sourceInversion = chordIdentityInversion(source);
  const targetInversion = chordIdentityInversion(target);
  if (!((sourceInversion === 0 && targetInversion === 0) ||
        (sourceInversion === 3 && targetInversion === 1))) return;

  const before = slices[dominant.span.sliceIndices.at(-1)!];
  const middle = before && slices[before.index + 1];
  const landing = tonic.boundarySlice;
  if (!before?.completeSatb || !middle?.completeSatb || !landing?.completeSatb || middle.chord ||
      landing.index !== middle.index + 1 || before.endTick !== dominant.span.toTick ||
      middle.tick !== before.endTick || middle.endTick !== tonic.span.fromTick || landing.tick !== middle.endTick ||
      before.key.id !== middle.key.id || middle.key.id !== landing.key.id ||
      middle.endTick - middle.tick > beatTicks / 2) return;
  const metric = metricAt(middle.tick);
  if (metric?.confidence !== "certain" || metric.role !== "subdivision" ||
      compareMetricStrength(metricAt(landing.tick), metric) !== "stronger") return;

  const origin = before.notes.soprano!;
  const surface = middle.notes.soprano!;
  const arrival = landing.notes.soprano!;
  const sourceTones = chordIdentityToneSpellings(source);
  const targetTones = chordIdentityToneSpellings(target);
  const beforeNotes = VOICE_ORDER.map(voice => before.notes[voice]!);
  const landingTop = toMidi(arrival.pitch);
  const landingBass = toMidi(landing.notes.bass!.pitch);
  if (!soundsCompleteWrittenChord(source, beforeNotes, before.notes.bass!) ||
      VOICE_ORDER.some(voice => {
        const pitch = toMidi(landing.notes[voice]!.pitch);
        return pitch < landingBass || pitch > landingTop;
      }) ||
      !pitchClassEquals(landing.notes.bass!.pitch, target.bass) ||
      landing.notes.bass!.startTick !== landing.tick || !pitchClassEquals(origin.pitch, sourceTones[2]) ||
      surface.startTick !== middle.tick || surface.startTick + surface.durationTicks !== landing.tick ||
      origin.id === surface.id || surface.nonChordToneRole || arrival.nonChordToneRole ||
      arrival.startTick !== landing.tick || !pitchClassEquals(arrival.pitch, target.root) ||
      VOICE_ORDER.some(voice => voice !== "soprano" && middle.notes[voice]?.id !== before.notes[voice]?.id) ||
      hasCompleteWrittenTertianVoicing(VOICE_ORDER.map(voice => middle.notes[voice]!.pitch))) return;

  const into = writtenInterval(origin.pitch, surface.pitch);
  const out = writtenInterval(surface.pitch, arrival.pitch);
  // Revoice the established dominant, or leave an upper auxiliary by a
  // contrary third directly to the tonic (Spasobin §43.1–2).
  if (!sourceTones.some(tone => pitchClassEquals(surface.pitch, tone)) &&
      !(into.diatonicSteps === 1 && isWrittenStep(into) && into.semitones > 0 &&
        out.diatonicSteps === -2 && (out.semitones === -3 || out.semitones === -4))) return;

  const leadingVoice = VOICE_ORDER.find(voice => pitchClassEquals(before.notes[voice]!.pitch, sourceTones[1]))!;
  const seventhVoice = VOICE_ORDER.find(voice => pitchClassEquals(before.notes[voice]!.pitch, sourceTones[3]))!;
  const leading = landing.notes[leadingVoice]!;
  const step = writtenInterval(before.notes[leadingVoice]!.pitch, leading.pitch);
  const leadingAscends = pitchClassEquals(leading.pitch, target.root) && step.diatonicSteps === 1 && step.semitones === 1;
  const leadingFallsToFifth = sourceInversion === 0 && pitchClassEquals(leading.pitch, targetTones[2]) &&
    step.diatonicSteps === -2 && step.semitones === -4;
  if (leading.startTick !== landing.tick || leading.nonChordToneRole || !(leadingAscends || leadingFallsToFifth)) return;
  const resolvedSeventh = seventhResolutionId(before, landing, tonic, slices, seventhVoice, beatTicks);
  if (!resolvedSeventh) return;

  return {
    code: "dominant-before-tonic-gap",
    value: "属七低音及两个内声部保持，弱位女高换音后实奏落主",
    refs: [...new Set([surface.id, before.notes.bass!.id, leading.id, before.notes[seventhVoice]!.id, resolvedSeventh])],
  };
}

/** Spasobin §§40.1–2, 40.4. Recognize two returning upper neighbors within one stationary dominant. */
export function dominantNeighborEvidence(
  left: CadenceSpanFacts,
  right: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  metricAt: (tick: number) => MetricPosition | undefined,
): CadenceEvidence | undefined {
  const identity = left.chord?.identity;
  if (!identity || !right.chord || !chordIdentityEquals(identity, right.chord.identity) ||
      identity.structure.kind !== "tertian" || identity.structure.alterations.length ||
      identity.structure.extensions.length ||
      (identity.structure.quality !== "major" && identity.structure.quality !== "dominant7")) return;

  const before = slices[left.span.sliceIndices.at(-1)!];
  const after = slices[right.span.sliceIndices[0]];
  const middle = before && slices[before.index + 1];
  if (!middle || !after || after.index !== middle.index + 1 || middle.chord ||
      before.endTick !== left.span.toTick || middle.tick !== before.endTick ||
      middle.endTick !== right.span.fromTick || after.tick !== middle.endTick ||
      before.key.id !== middle.key.id || middle.key.id !== after.key.id ||
      !before.completeSatb || !middle.completeSatb || !after.completeSatb) return;
  const metric = metricAt(middle.tick);
  if (metric?.confidence !== "certain" || metric.level >= 2) return;

  if (!pitchClassEquals(middle.notes.bass!.pitch, identity.root)) return;
  const neighbors = writtenNeighborsOverHeldBass(identity, before, middle, after);
  if (neighbors?.length !== 2) return;

  return {
    code: "dominant-neighbor-prolongation",
    value: "持续属低音上的两个弱位辅助音同声部折回，属功能连续",
    refs: neighbors,
  };
}

/** Spasobin 8–92. The terminal tonic is a written arrival in several
 * registers. The visible attack and release do not establish a work’s end. */
export function octaveTonicEndingEvidence(
  dominant: CadenceSpanFacts,
  before: AnalysisSlice | undefined,
  arrival: AnalysisSlice,
): CadenceEvidence | undefined {
  const source = before?.chord?.identity;
  const structure = source?.structure;
  if (!before?.completeSatb || !arrival.completeSatb || arrival.chord ||
      before.endTick !== arrival.tick || before.key.id !== arrival.key.id ||
      !keyEquals(dominant.key, arrival.key) ||
      !source || structure?.kind !== "tertian" || structure.quality !== "major" ||
      structure.extensions.length || structure.alterations.length || chordIdentityInversion(source) !== 0 ||
      !pitchClassEquals(source.root, scaleDegreePitchClass(arrival.key, 5))) return;

  const bass = before.notes.bass!;
  const soprano = before.notes.soprano!;
  const sourceNotes = VOICE_ORDER.map(voice => before.notes[voice]!);
  if (!soundsCompleteWrittenChord(source, sourceNotes, bass) ||
      sourceNotes.some(note => toMidi(note.pitch) > toMidi(soprano.pitch))) return;

  const notes = VOICE_ORDER.map(voice => arrival.notes[voice]!);
  const floor = toMidi(arrival.notes.bass!.pitch), ceiling = toMidi(arrival.notes.soprano!.pitch);
  if (new Set(notes.map(note => toMidi(note.pitch))).size < 3 || notes.some(note =>
    note.startTick !== arrival.tick || note.startTick + note.durationTicks !== arrival.endTick ||
    note.nonChordToneRole || !pitchClassEquals(note.pitch, arrival.key.tonic) ||
    toMidi(note.pitch) < floor || toMidi(note.pitch) > ceiling)) return;

  const bassMotion = writtenInterval(bass.pitch, arrival.notes.bass!.pitch);
  if (!((bassMotion.diatonicSteps === 3 && bassMotion.semitones === 5) ||
        (bassMotion.diatonicSteps === -4 && bassMotion.semitones === -7))) return;

  const leading = chordIdentityToneSpellings(source)[1];
  if (!pitchClassEquals(soprano.pitch, leading)) return;
  for (const voice of VOICE_ORDER) {
    const prior = before.notes[voice]!;
    if (!pitchClassEquals(prior.pitch, leading)) continue;
    const motion = writtenInterval(prior.pitch, arrival.notes[voice]!.pitch);
    if (motion.diatonicSteps !== 1 || motion.semitones !== 1) return;
  }
  return {
    code: "octave-tonic-ending",
    value: "原位属三和弦后四部同时落到不同八度的主音，齐奏收束",
    refs: [...sourceNotes.map(note => note.id), ...notes.map(note => note.id)],
  };
}

const stagedArrivalUpperVoices = ["soprano", "alto", "tenor"] as const;

/** The tonic bass arrives before the whole chord. Written tendency tones
 * connect the short sounding slice to both harmonies (§§36.4, 42.1–2). */
export function stagedTonicArrivalEvidence(
  dominant: CadenceSpanFacts,
  tonic: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  metricAt: (tick: number) => MetricPosition | undefined,
  beatTicks: number | undefined,
): CadenceEvidence | undefined {
  const source = dominant.chord?.identity;
  const target = tonic.chord?.identity;
  if (!source || !target || !beatTicks ||
      source.structure.kind !== "tertian" || source.structure.quality !== "dominant7" ||
      source.structure.extensions.length || source.structure.alterations.length ||
      target.structure.kind !== "tertian" || target.structure.quality !== tonic.key.mode ||
      target.structure.extensions.length || target.structure.alterations.length ||
      !pitchClassEquals(target.root, tonic.key.tonic) || tonic.span.semantics?.cadenceRole ||
      chordIdentityInversion(target) !== 0) return;
  const inversion = chordIdentityInversion(source);
  if (inversion !== 0 && inversion !== 2) return;

  const frames = tonicBassGapFrames(dominant, tonic, slices, beatTicks);
  if (!frames) return;
  const { before, suspension: early, landing } = frames;
  if (!hasCadentialWrittenVoicing(before, source, inversion === 0) ||
      !hasCadentialWrittenVoicing(landing, target, false)) return;

  const earlyBass = early.notes.bass!;
  const landingBass = landing.notes.bass!;
  if (earlyBass.startTick !== early.tick ||
      (earlyBass.nonChordToneRole && earlyBass.nonChordToneRole !== "anticipation") ||
      !spelledPitchEquals(earlyBass.pitch, landingBass.pitch)) return;

  const bassMotion = writtenInterval(before.notes.bass!.pitch, earlyBass.pitch);
  const bassResolves = inversion === 0
    ? (bassMotion.diatonicSteps === 3 && bassMotion.semitones === 5) ||
      (bassMotion.diatonicSteps === -4 && bassMotion.semitones === -7)
    : bassMotion.diatonicSteps === -1 && bassMotion.semitones === -2;
  if (!bassResolves) return;

  const onset = metricAt(early.tick);
  const resolution = metricAt(landing.tick);
  const anticipates = onset?.confidence === "certain" && onset.role === "subdivision" &&
    compareMetricStrength(resolution, onset) === "stronger";
  const sustains = onset?.role === "downbeat" && earlyBass.id === landingBass.id &&
    compareMetricStrength(onset, resolution) === "stronger";
  if (!anticipates && !sustains) return;

  const [, leading, fifth, seventh] = chordIdentityToneSpellings(source);
  const tonicTones = chordIdentityToneSpellings(target);
  const [root, third] = tonicTones;
  const heldTendencies: string[] = [];

  for (const voice of stagedArrivalUpperVoices) {
    const old = before.notes[voice]!, middle = early.notes[voice]!, next = landing.notes[voice]!;
    if (toMidi(middle.pitch) < toMidi(earlyBass.pitch)) return;
    if (tonicTones.some(tone => pitchClassEquals(middle.pitch, tone))) continue;

    if (next.startTick !== landing.tick || middle.startTick + middle.durationTicks !== landing.tick) return;
    const motion = writtenInterval(middle.pitch, next.pitch);
    const isLeading = pitchClassEquals(middle.pitch, leading);
    const isSeventh = pitchClassEquals(middle.pitch, seventh);
    if (isLeading || isSeventh) {
      const resolves = isLeading
        ? pitchClassEquals(next.pitch, root) && motion.diatonicSteps === 1 && motion.semitones === 1
        : pitchClassEquals(next.pitch, third) && motion.diatonicSteps === -1 &&
          motion.semitones < 0 && isWrittenStep(motion);
      if (old.id !== middle.id || !resolves) return;
      heldTendencies.push(middle.id, next.id);
    } else if (!pitchClassEquals(middle.pitch, fifth) || !pitchClassEquals(next.pitch, root) ||
        motion.diatonicSteps !== -1 || motion.semitones >= 0 || !isWrittenStep(motion)) {
      return;
    }
  }
  // The separate three-suspension proof handles all three upper notes held unchanged.
  if (!heldTendencies.length || !stagedArrivalUpperVoices.some(voice => before.notes[voice]!.id !== early.notes[voice]!.id))
    return;

  return {
    code: "staged-tonic-arrival",
    value: "主低音先到，属和弦的持续趋向音在原声部解决后完整落主",
    refs: [earlyBass.id, ...heldTendencies],
  };
}

/** One sounding, unlabelled slice between two chord spans in the same written key. */
export function tonicBassGapFrames(
  dominant: CadenceSpanFacts,
  tonic: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  beatTicks: number,
) {
  const before = slices[dominant.span.sliceIndices.at(-1)!];
  const suspension = before && slices[before.index + 1];
  const landing = tonic.boundarySlice;
  if (!before?.completeSatb || !suspension?.completeSatb || !landing?.completeSatb || suspension.chord ||
      before.endTick !== dominant.span.toTick || suspension.tick !== before.endTick ||
      suspension.endTick !== tonic.span.fromTick || landing.tick !== suspension.endTick ||
      landing.index !== suspension.index + 1 ||
      before.key.id !== suspension.key.id || suspension.key.id !== landing.key.id ||
      suspension.endTick - suspension.tick > beatTicks) return;
  return { before, suspension, landing };
}

const bassSuspensionUpperVoices = ["soprano", "alto", "tenor"] as const;

/** Spasobin §§37.1–2 and 14.4: a root-position V7 resolves over a tonic
 * bass that arrives before the three prepared upper-voice suspensions. */
export function tonicBassSuspensionEvidence(
  dominant: CadenceSpanFacts,
  tonic: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  metricAt: (tick: number) => MetricPosition | undefined,
  beatTicks: number | undefined,
): CadenceEvidence | undefined {
  const source = dominant.chord?.identity;
  const target = tonic.chord?.identity;
  if (!source || !target || !beatTicks ||
      source.structure.kind !== "tertian" || source.structure.quality !== "dominant7" ||
      source.structure.extensions.length || source.structure.alterations.length ||
      target.structure.kind !== "tertian" || target.structure.quality !== tonic.key.mode ||
      target.structure.extensions.length || target.structure.alterations.length ||
      tonic.span.semantics?.cadenceRole || !pitchClassEquals(target.root, tonic.key.tonic) ||
      chordIdentityInversion(source) !== 0 || chordIdentityInversion(target) !== 0) return;

  const frames = tonicBassGapFrames(dominant, tonic, slices, beatTicks);
  if (!frames) return;
  const { before, suspension, landing } = frames;

  const onset = metricAt(suspension.tick);
  if (onset?.role !== "downbeat" ||
      compareMetricStrength(onset, metricAt(before.tick)) !== "stronger" ||
      compareMetricStrength(onset, metricAt(landing.tick)) !== "stronger") return;

  const prepared = VOICE_ORDER.map(voice => before.notes[voice]!);
  const bass = suspension.notes.bass!;
  const bassMotion = writtenInterval(before.notes.bass!.pitch, bass.pitch);
  const bassResolves =
    bassMotion.diatonicSteps === 3 && bassMotion.semitones === 5 ||
    bassMotion.diatonicSteps === -4 && bassMotion.semitones === -7;
  if (!soundsCompleteWrittenChord(source, prepared, before.notes.bass!) ||
      bass.nonChordToneRole || bass.startTick !== suspension.tick || bass.id !== landing.notes.bass!.id ||
      !pitchClassEquals(bass.pitch, target.bass) || !bassResolves ||
      hasCompleteWrittenTertianVoicing(VOICE_ORDER.map(voice => suspension.notes[voice]!.pitch))) return;

  const [, leading, fifth, seventh] = chordIdentityToneSpellings(source);
  const [root, third] = chordIdentityToneSpellings(target);
  const bassMidi = toMidi(bass.pitch);
  const topMidi = toMidi(landing.notes.soprano!.pitch);
  for (const voice of bassSuspensionUpperVoices) {
    const origin = before.notes[voice]!;
    const held = suspension.notes[voice]!;
    const resolved = landing.notes[voice]!;
    if (held.id !== origin.id || toMidi(held.pitch) < bassMidi ||
        resolved.nonChordToneRole || resolved.startTick !== landing.tick ||
        origin.startTick + origin.durationTicks !== landing.tick ||
        toMidi(resolved.pitch) < bassMidi || toMidi(resolved.pitch) > topMidi) return;
    const interval = writtenInterval(origin.pitch, resolved.pitch);
    if (!isWrittenStep(interval)) return;
    if (pitchClassEquals(origin.pitch, leading)) {
      if (interval.diatonicSteps !== 1 || interval.semitones !== 1 ||
          !pitchClassEquals(resolved.pitch, root)) return;
    } else if (interval.diatonicSteps !== -1 ||
        !(pitchClassEquals(origin.pitch, fifth) && pitchClassEquals(resolved.pitch, root) ||
          pitchClassEquals(origin.pitch, seventh) && pitchClassEquals(resolved.pitch, third))) return;
  }

  return {
    code: "tonic-bass-suspension",
    value: "强拍低音先落主音，持续的属七三、五、七音在同声部解决",
    refs: [bass.id, ...bassSuspensionUpperVoices.flatMap(voice => [before.notes[voice]!.id, landing.notes[voice]!.id])],
  };
}

const inner = ["alto", "tenor"] as const;

function plainChord(facts: CadenceSpanFacts, root: SpelledPitchClass, quality: "major" | "minor" | "dominant7", inversion: number) {
  const identity = facts.chord?.identity;
  const structure = identity?.structure;
  return identity && structure?.kind === "tertian" && structure.quality === quality &&
    !structure.extensions.length && !structure.alterations.length && pitchClassEquals(identity.root, root) &&
    chordIdentityInversion(identity) === inversion ? identity : undefined;
}

function resolvedSource(dominant: ChordIdentity, before: AnalysisSlice, landing: AnalysisSlice, tonic: ChordIdentity) {
  if (!hasCadentialWrittenVoicing(before, dominant, false) ||
      !hasCadentialWrittenVoicing(landing, tonic, true) ||
      VOICE_ORDER.some(voice => landing.notes[voice]!.startTick !== landing.tick)) return false;
  const [, leading, , seventh] = chordIdentityToneSpellings(dominant);
  const [root, third] = chordIdentityToneSpellings(tonic);
  const bass = writtenInterval(before.notes.bass!.pitch, landing.notes.bass!.pitch);
  return ((bass.diatonicSteps === 3 && bass.semitones === 5) ||
          (bass.diatonicSteps === -4 && bass.semitones === -7)) &&
    (["soprano", ...inner] as const).every(voice => {
      const old = before.notes[voice]!, next = landing.notes[voice]!;
      const motion = writtenInterval(old.pitch, next.pitch);
      if (pitchClassEquals(old.pitch, leading)) {
        return pitchClassEquals(next.pitch, root) && motion.diatonicSteps === 1 && motion.semitones === 1;
      }
      return !pitchClassEquals(old.pitch, seventh) ||
        (pitchClassEquals(next.pitch, third) && motion.diatonicSteps === -1 &&
          motion.semitones === (tonic.structure.kind === "tertian" && tonic.structure.quality === "minor" ? -2 : -1));
    });
}

/** A single terminal tonic articulation contains the local V7/iv–iv–i
 * extension under the same written outside notes (Spasobin §48.2–6). */
export function closingTonicPedalEvidence(
  dominant: CadenceSpanFacts,
  arrival: CadenceSpanFacts,
  applied: CadenceSpanFacts,
  subdominant: CadenceSpanFacts,
  terminal: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  beatTicks: number,
): CadenceEvidence | undefined {
  const key = arrival.key;
  const sequence = [dominant, arrival, applied, subdominant, terminal];
  if (key.mode !== "minor" || !arrival.isTonic || !terminal.isTonic || subdominant.degree !== 4 ||
      !subdominant.isSubdominant || applied.span.status !== "complete" ||
      [applied, subdominant].some(item => item.span.toTick - item.span.fromTick > beatTicks) ||
      sequence.some((item, i) => !keyEquals(item.key, key) ||
        (i > 0 && sequence[i - 1].span.toTick !== item.span.fromTick))) return;
  const semantics = applied.span.semantics;
  if (!semantics || !["certain", "probable"].includes(harmonySemanticsConfidence(semantics))) return;
  const meaning = primaryHarmonyInterpretation(semantics);
  if (meaning.degree !== 5 || meaning.degreeAlteration !== 0 || meaning.appliedTarget?.degree !== 4 ||
      meaning.designation?.kind !== "applied-dominant") return;

  const root = key.tonic, fourth = scaleDegreePitchClass(key, 4);
  const d = plainChord(dominant, scaleDegreePitchClass(key, 5), "dominant7", 0);
  const t = plainChord(arrival, root, "minor", 0);
  const dOfS = plainChord(applied, root, "dominant7", 0);
  const s = plainChord(subdominant, fourth, "minor", 2);
  const end = plainChord(terminal, root, "minor", 0);
  const before = slices[dominant.span.sliceIndices.at(-1)!];
  const start = arrival.boundarySlice, source = applied.boundarySlice,
    target = subdominant.boundarySlice, finish = terminal.boundarySlice;
  if (!d || !t || !dOfS || !s || !end || !before?.completeSatb || !start?.completeSatb ||
      !source?.completeSatb || !target?.completeSatb || !finish?.completeSatb ||
      before.endTick !== start.tick || !resolvedSource(d, before, start, t)) return;
  const bass = start.notes.bass!, soprano = start.notes.soprano!;
  if (!pitchClassEquals(soprano.pitch, root) ||
      [bass, soprano].some(note => note.startTick + note.durationTicks !== terminal.span.toTick)) return;

  const voicings = [[arrival, t, true], [applied, dOfS, true], [subdominant, s, false], [terminal, end, false]] as const;
  for (const [facts, identity, allowOmittedFifth] of voicings) {
    for (const index of facts.span.sliceIndices) {
      const part = slices[index];
      if (part.key.id !== before.key.id || part.notes.bass?.id !== bass.id || part.notes.soprano?.id !== soprano.id ||
          !hasCadentialWrittenVoicing(part, identity, allowOmittedFifth)) return;
    }
  }

  const [, appliedLeading, , appliedSeventh] = chordIdentityToneSpellings(dOfS);
  const [, subdominantThird] = chordIdentityToneSpellings(s);
  const resolvesInsidePedal = inner.every(voice => {
    const old = source.notes[voice]!, middle = target.notes[voice]!, next = finish.notes[voice]!;
    const into = writtenInterval(old.pitch, middle.pitch);
    const out = writtenInterval(middle.pitch, next.pitch);
    return old.startTick === source.tick && middle.startTick === target.tick && next.startTick === finish.tick &&
      out.diatonicSteps === -1 && isWrittenStep(out) &&
      ((pitchClassEquals(old.pitch, appliedLeading) && pitchClassEquals(middle.pitch, fourth) &&
        into.diatonicSteps === 1 && into.semitones === 1) ||
       (pitchClassEquals(old.pitch, appliedSeventh) && pitchClassEquals(middle.pitch, subdominantThird) &&
        into.diatonicSteps === -1 && into.semitones === -2));
  });
  if (!resolvesInsidePedal) return;
  return {
    code: "closing-tonic-pedal",
    value: "落主后两个外声部持续同一主音，内声经下属回主至共同释放",
    refs: [bass.id, soprano.id, ...inner.flatMap(voice =>
      [source.notes[voice]!.id, target.notes[voice]!.id, finish.notes[voice]!.id])],
  };
}

/** Recover a resolved seventh-to-tonic landing whose held outside notes
 * carry a short subdominant revoicing to their joint release (§48.3–6). */
export function closingTonicRevoicingEvidence(
  dominant: CadenceSpanFacts,
  arrival: CadenceSpanFacts,
  subdominant: CadenceSpanFacts,
  terminal: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  beatTicks: number,
): CadenceEvidence | undefined {
  const key = arrival.key;
  const start = arrival.span.fromTick, release = terminal.span.toTick;
  if (!arrival.isTonic || !terminal.isTonic || !subdominant.isSubdominant || subdominant.degree !== 4 ||
      [subdominant, terminal].some(facts => !keyEquals(facts.key, key)) ||
      subdominant.span.toTick - subdominant.span.fromTick > beatTicks) return;

  const gaps = [
    subdominant.span.fromTick - arrival.span.toTick,
    terminal.span.fromTick - subdominant.span.toTick,
  ];
  if (gaps.some(length => length < 0 || length > beatTicks)) return;

  const root = key.tonic, fourth = scaleDegreePitchClass(key, 4);
  const d = plainChord(dominant, scaleDegreePitchClass(key, 5), "dominant7", 0);
  const t = plainChord(arrival, root, key.mode, 0);
  const s = plainChord(subdominant, fourth, key.mode, 2);
  const end = plainChord(terminal, root, key.mode, 0);
  const before = slices[dominant.span.sliceIndices.at(-1)!];
  const landing = arrival.boundarySlice;
  const lastIndex = terminal.span.sliceIndices.at(-1)!;
  const last = slices[lastIndex];
  if (!d || !t || !s || !end || !before?.completeSatb || !landing?.completeSatb || !last?.completeSatb ||
      before.endTick !== start || !resolvedSource(d, before, landing, t) ||
      VOICE_ORDER.some(voice => {
        const note = last.notes[voice]!;
        return note.startTick + note.durationTicks !== release;
      })) return;

  const bass = landing.notes.bass!, soprano = landing.notes.soprano!;
  if (!pitchClassEquals(soprano.pitch, root)) return;

  const voicings = [[arrival, t, true], [subdominant, s, false], [terminal, end, false]] as const;
  for (const slice of slices.slice(landing.index, lastIndex + 1)) {
    if (slice.key.id !== before.key.id || !slice.completeSatb ||
        slice.notes.bass?.id !== bass.id || slice.notes.soprano?.id !== soprano.id) return;
    const named = voicings.find(([facts]) => facts.span.fromTick <= slice.tick && slice.tick < facts.span.toTick);
    if (named) {
      const [, identity, allowOmission] = named;
      if (!hasCadentialWrittenVoicing(slice, identity, allowOmission)) return;
    } else {
      const notes = VOICE_ORDER.map(voice => slice.notes[voice]!);
      if (slice.chord || hasCompleteWrittenTertianVoicing(notes.map(note => note.pitch)) ||
          notes.some(note => toMidi(note.pitch) < toMidi(bass.pitch) || toMidi(note.pitch) > toMidi(soprano.pitch))) return;
    }
  }

  return {
    code: "closing-tonic-revoicing",
    value: "实写属七解决后，外声同次持续，内声经下属重配至主音共同释放",
    refs: [arrival.span.id, bass.id, soprano.id],
  };
}

export function hasCadentialWrittenVoicing(slice: AnalysisSlice, identity: ChordIdentity, allowOmittedFifth: boolean) {
  if (!slice.completeSatb) return false;
  const notes = VOICE_ORDER.map(voice => slice.notes[voice]!);
  const bass = slice.notes.bass!, soprano = slice.notes.soprano!;
  const floor = toMidi(bass.pitch), ceiling = toMidi(soprano.pitch);
  if (notes.some(note => toMidi(note.pitch) < floor || toMidi(note.pitch) > ceiling)) return false;
  if (soundsCompleteWrittenChord(identity, notes, bass)) return true;
  if (!allowOmittedFifth) return false;
  const [root, third, , seventh] = chordIdentityToneSpellings(identity);
  return pitchClassEquals(bass.pitch, identity.bass) && notes.every(note => !note.nonChordToneRole &&
    [root, third, seventh].some(tone => tone && pitchClassEquals(note.pitch, tone))) &&
    notes.filter(note => pitchClassEquals(note.pitch, root)).length === (seventh ? 2 : 3) &&
    notes.some(note => pitchClassEquals(note.pitch, third)) &&
    (!seventh || notes.some(note => pitchClassEquals(note.pitch, seventh)));
}
