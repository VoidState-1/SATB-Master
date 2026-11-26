import {
  chordIdentityInversion,
  chordIdentityToneSpellings,
  chordIdentityEquals,
  type ChordIdentity,
  type KeyReference,
  chordIdentityToneSpellingForDegree,
  chordStructureQuality,
} from "../../chordModel";
import {
  isWrittenStep,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  writtenInterval,
  keyEquals,
  type SpelledPitchClass,
} from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { type MeasureInfo, ticksPerBeat } from "../../time";
import type { AnalysisSlice, HarmonyAnalysis, AnalysisNote } from "../analysis";
import type { PhraseSegment } from "../phrase";
import { soundsCompleteWrittenChord } from "../facts/writtenVoicing";
import type { CadenceEvidence, CadenceSpanFacts, CadenceCompletion } from "./model";
import { returnsByWrittenStep } from "../facts/prolongation";
import { resolvesInVoice } from "../facts/tendencyResolution";
import { tonalReading } from "../facts/localTonality";
import { sameDetachedRhythm, writtenAttack, hasCadentialWrittenVoicing } from "./authenticEndings";
import type { MetricPosition } from "../../rhythm/metric";

type MeasureFor = (tick: number) => MeasureInfo | undefined;

/** A held VI can outlive the first clause when the melody and another
 * upper part leave their arrival notes together over the same bass. */
export function releasesDeceptiveArrival(onset: AnalysisSlice | undefined, restart: AnalysisSlice) {
  const chord = onset?.chord;
  if (!chord || !onset.completeSatb || !restart.completeSatb || !onset.notes.bass ||
      !onset.notes.soprano || !restart.notes.soprano || !restart.notes.bass ||
      onset.notes.bass.id !== restart.notes.bass.id || chordIdentityInversion(chord.identity) !== 0 ||
      !pitchClassEquals(onset.notes.bass.pitch, chord.identity.root)) return false;
  const reading = tonalReading(chord.semantics, onset.key).interpretation;
  return reading?.degree === 6 && !reading.degreeAlteration && !reading.appliedTarget &&
    onset.notes.soprano.startTick === onset.tick && onset.notes.soprano.startTick + onset.notes.soprano.durationTicks === restart.tick &&
    restart.notes.soprano.startTick === restart.tick && !spelledPitchEquals(onset.notes.soprano.pitch, restart.notes.soprano.pitch) &&
    (["alto", "tenor"] as const).some(voice => onset.notes[voice]?.startTick === onset.tick &&
      onset.tick + onset.notes[voice]!.durationTicks === restart.tick && restart.notes[voice]?.startTick === restart.tick);
}

export function bassStepsUpToSubmediant(before: AnalysisSlice, arrival: AnalysisSlice) {
  if (!before.notes.bass || !arrival.notes.bass) return false;
  const bass = writtenInterval(before.notes.bass.pitch, arrival.notes.bass.pitch);
  return bass.diatonicSteps === 1 && isWrittenStep(bass);
}

/** A V7 whose melody closes 2–1 can interrupt an ongoing phrase. Require
 * a metric arrival, the doubled third of VI and both tendency resolutions.
 * An applied V7 also needs its tonic sounding before it in the same phrase. */
export function writtenDeceptiveClausula(
  anchor: CadenceSpanFacts | undefined, dominant: CadenceSpanFacts, ending: CadenceSpanFacts,
  slices: readonly AnalysisSlice[], metric: MetricPosition | undefined, beat: number | undefined,
): CadenceEvidence | undefined {
  const source = dominant.chord?.identity, target = ending.chord?.identity;
  const before = slices[dominant.span.sliceIndices.at(-1)!], arrival = ending.boundarySlice;
  if (!beat || metric?.role !== "downbeat" || !before?.completeSatb || !arrival?.completeSatb ||
      !source || !target || ending.interpretationStatus !== "resolved" || ending.hardBoundaryBefore ||
      dominant.span.toTick !== ending.span.fromTick || before.endTick !== arrival.tick ||
      ending.span.toTick - arrival.tick < beat || !keyEquals(dominant.writtenKey, ending.writtenKey) ||
      dominant.span.status !== "complete" || source.structure.kind !== "tertian" ||
      source.structure.quality !== "dominant7" || source.structure.alterations.length ||
      source.structure.extensions.length || !isPlainTriad(target) ||
      chordIdentityInversion(source) !== 0 || chordIdentityInversion(target) !== 0) return;
  const meaning = tonalReading(dominant.span.semantics, dominant.writtenKey).interpretation;
  if (!meaning || meaning.degree !== 5 || meaning.degreeAlteration) return;
  let key = dominant.key;
  if (meaning.appliedTarget) {
    const established = anchor?.chord?.identity;
    const anchorSlice = anchor && slices[anchor.span.sliceIndices.at(-1)!];
    if (!anchor || anchor.span.toTick !== dominant.span.fromTick || dominant.hardBoundaryBefore ||
        anchor.interpretationStatus !== "resolved" || !established || !isPlainTriad(established) ||
        !pitchClassEquals(established.root, scaleDegreePitchClass(key, meaning.appliedTarget.degree)) ||
        !keyEquals(anchor.key, key) || !keyEquals(ending.key, key) || !anchorSlice?.completeSatb ||
        !soundsCompleteWrittenChord(established, writtenNotes(anchorSlice), anchorSlice.notes.bass!)) return;
    key = { tonic: established.root, mode: chordStructureQuality(established) === "minor" ? "minor" : "major" };
  } else if (!dominant.isDominant || !keyEquals(key, ending.key) || ending.degree !== 6) return;
  if (!pitchClassEquals(source.root, scaleDegreePitchClass(key, 5)) ||
      !pitchClassEquals(target.root, scaleDegreePitchClass(key, 6)) ||
      !soundsCompleteWrittenChord(source, writtenNotes(before), before.notes.bass!) ||
      !soundsCompleteWrittenChord(target, writtenNotes(arrival), arrival.notes.bass!) ||
      !bassStepsUpToSubmediant(before, arrival) ||
      !pitchClassEquals(before.notes.soprano!.pitch, scaleDegreePitchClass(key, 2)) ||
      !resolvesInVoice(before, arrival, "soprano", key.tonic, -1)) return;
  const melody = arrival.notes.soprano!;
  if (melody.durationTicks <= before.notes.soprano!.durationTicks ||
      !endsAt(melody, ending.span.toTick) ||
      !hasArticulatedResolution({ ...ending, key, isTonic: false }, before, arrival, writtenNotes(arrival), source, target)) return;
  return { code: "written-deceptive-clausula", value: "强拍上低音五升六，旋律二归一并延长，导音和七音分别解决",
    refs: [before.notes.bass!.id, arrival.notes.bass!.id, melody.id] };
}

function articulatedEndingChords(
  dominant: CadenceSpanFacts, ending: CadenceSpanFacts, continuation: CadenceSpanFacts,
) {
  const source = dominant.chord?.identity;
  const target = ending.chord?.identity;
  const following = continuation.chord?.identity;
  if (!source || !target || !following ||
      source.structure.kind !== "tertian" ||
      !["major", "dominant7"].includes(source.structure.quality) ||
      source.structure.alterations.length || source.structure.extensions.length ||
      !isPlainTriad(target) ||
      chordIdentityInversion(target) !== 0 || ending.span.semantics?.cadenceRole === "pedal64" ||
      ending.span.semantics?.cadenceRole === "passing64" ||
      continuation.family === undefined || continuation.family === ending.family) return;
  const inversion = chordIdentityInversion(source);
  if (inversion !== 0 && !(ending.isTonic && inversion === 1 && source.structure.quality === "major")) return;
  return { source, target, following };
}

function articulatedEndingFrames(
  phrase: PhraseSegment, dominant: CadenceSpanFacts, ending: CadenceSpanFacts, continuation: CadenceSpanFacts,
  slices: readonly AnalysisSlice[], measureFor: MeasureFor,
) {
  const landing = ending.boundarySlice;
  const restart = continuation.boundarySlice;
  const before = slices[dominant.span.sliceIndices.at(-1)!];
  const bar = measureFor(ending.span.fromTick);
  const newBar = measureFor(ending.span.toTick);
  if (!bar || !newBar || !before?.completeSatb || !landing?.completeSatb || !restart?.completeSatb ||
      landing.tick !== bar.startTick || ending.span.toTick !== bar.endTick ||
      landing.endTick !== bar.endTick || before.endTick !== landing.tick ||
      restart.tick !== newBar.startTick || restart.index !== landing.index + 1 ||
      newBar.endTick > phrase.toTick || newBar.denominator !== bar.denominator ||
      newBar.numerator !== bar.numerator || before.key.id !== landing.key.id || landing.key.id !== restart.key.id ||
      landing.attackVoiceIds.length !== VOICE_ORDER.length ||
      restart.attackVoiceIds.length !== VOICE_ORDER.length) return;
  return { before, landing, restart, bar, newBar };
}

function writtenNotes(slice: AnalysisSlice) {
  return VOICE_ORDER.map(voice => slice.notes[voice]!);
}

function hasArticulatedResolution(
  ending: CadenceSpanFacts, before: AnalysisSlice, landing: AnalysisSlice,
  arrival: readonly AnalysisNote[], source: ChordIdentity, target: ChordIdentity,
) {
  const [targetRoot, targetThird] = chordIdentityToneSpellings(target);
  const [, leading, , seventh] = chordIdentityToneSpellings(source);
  const expectedRoot = scaleDegreePitchClass(ending.key, ending.isTonic ? 1 : 6);
  if (!pitchClassEquals(targetRoot, expectedRoot) ||
      (!ending.isTonic && (!bassStepsUpToSubmediant(before, landing) ||
        arrival.filter(note => pitchClassEquals(note.pitch, targetThird)).length !== 2))) return false;

  // Verify the leading tone and, when present, the seventh in their own voices.
  const leadingVoice = VOICE_ORDER.find(voice => pitchClassEquals(before.notes[voice]!.pitch, leading))!;
  const leadMotion = writtenInterval(before.notes[leadingVoice]!.pitch, landing.notes[leadingVoice]!.pitch);
  if (leadMotion.diatonicSteps !== 1 || leadMotion.semitones !== 1 ||
      !pitchClassEquals(landing.notes[leadingVoice]!.pitch, ending.key.tonic)) return false;
  if (!seventh) return true;

  const voice = VOICE_ORDER.find(voice => pitchClassEquals(before.notes[voice]!.pitch, seventh))!;
  const step = writtenInterval(before.notes[voice]!.pitch, landing.notes[voice]!.pitch);
  return step.diatonicSteps === -1 && isWrittenStep(step);
}

function hasRenewedAttacks(restart: AnalysisSlice, endTick: number, slices: readonly AnalysisSlice[]) {
  let renewedAttacks = 0;
  for (let index = restart.index + 1; index < slices.length && slices[index].tick < endTick; index++) {
    const next = slices[index];
    if (next.key.id !== restart.key.id || !next.completeSatb) return false;
    if (next.attackVoiceIds.length === VOICE_ORDER.length &&
        VOICE_ORDER.some(voice => !spelledPitchEquals(next.notes[voice]!.pitch, slices[index - 1].notes[voice]!.pitch))) {
      renewedAttacks++;
    }
  }
  return renewedAttacks >= 2;
}

/** A release with no rest can close an internal clause when all four parts
 * sustain the arrival for a bar and begin a new, shorter rhythm together. */
export function articulatedEndingEvidence(
  phrase: PhraseSegment,
  dominant: CadenceSpanFacts,
  ending: CadenceSpanFacts,
  continuation: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  measureFor: MeasureFor,
): CadenceEvidence | undefined {
  const chords = articulatedEndingChords(dominant, ending, continuation);
  if (!chords) return;
  const frames = articulatedEndingFrames(phrase, dominant, ending, continuation, slices, measureFor);
  if (!frames) return;
  const { source, target, following } = chords;
  const { before, landing, restart, bar, newBar } = frames;

  const arrival = writtenNotes(landing);
  const onset = writtenNotes(restart);
  if (arrival.some(note => note.startTick !== bar.startTick || !endsAt(note, bar.endTick)) ||
      !soundsCompleteWrittenChord(source, writtenNotes(before), before.notes.bass!) ||
      !soundsCompleteWrittenChord(target, arrival, landing.notes.bass!) ||
      !soundsCompleteWrittenChord(following, onset, restart.notes.bass!) ||
      !hasArticulatedResolution(ending, before, landing, arrival, source, target) ||
      !hasRenewedAttacks(restart, newBar.endTick, slices)) return;

  return {
    code: "articulated-interior-ending",
    value: "四部整小节保持并同时释放，后小节以更短的齐奏节奏重新展开",
    refs: [...arrival, ...onset].map(note => note.id),
  };
}

function isPlainTriad(identity: ChordIdentity) {
  const structure = identity.structure;
  return structure.kind === "tertian" && (structure.quality === "major" || structure.quality === "minor") &&
    !structure.extensions.length && !structure.alterations.length;
}

function hasWrittenVoicing(slice: AnalysisSlice, identity: ChordIdentity, throughTick: number) {
  if (!slice.completeSatb) return false;
  const notes = writtenNotes(slice);
  return notes.every(note => note.startTick + note.durationTicks >= throughTick) &&
    soundsCompleteWrittenChord(identity, notes, slice.notes.bass!);
}

/** A written upper-neighbor pair around the same held tonic (§13.4–5). */
export function isWrittenAuxiliaryReturn(
  tonic: CadenceSpanFacts,
  auxiliary: CadenceSpanFacts,
  returning: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
) {
  const first = tonic.chord?.identity;
  const middle = auxiliary.chord?.identity;
  const last = returning.chord?.identity;
  const role = auxiliary.span.semantics?.cadenceRole;
  if (!first || !middle || !last || !isPlainTriad(first) || !isPlainTriad(middle) ||
      chordIdentityInversion(first) !== 0 || !chordIdentityEquals(first, last) ||
      !pitchClassEquals(first.root, tonic.key.tonic) || chordIdentityInversion(middle) !== 2 ||
      !pitchClassEquals(middle.root, scaleDegreePitchClass(tonic.key, 4)) ||
      (role && role !== "pedal64")) return false;

  const before = slices[tonic.span.sliceIndices.at(-1)!];
  const neighbor = auxiliary.boundarySlice;
  const arrival = returning.boundarySlice;
  if (!before || !neighbor || !arrival || before.key.id !== neighbor.key.id || neighbor.key.id !== arrival.key.id ||
      !hasWrittenVoicing(before, first, auxiliary.span.fromTick) ||
      !hasWrittenVoicing(neighbor, middle, returning.span.fromTick) ||
      !hasWrittenVoicing(arrival, last, returning.span.toTick)) return false;

  const bass = before.notes.bass!;
  if (bass.id !== neighbor.notes.bass!.id || bass.id !== arrival.notes.bass!.id) return false;

  let heldUpper = 0;
  for (const voice of ["soprano", "alto", "tenor"] as const) {
    const old = before.notes[voice]!, changed = neighbor.notes[voice]!, next = arrival.notes[voice]!;
    if (old.id === changed.id && changed.id === next.id) {
      heldUpper++;
      continue;
    }
    if (changed.startTick !== neighbor.tick || next.startTick !== arrival.tick ||
        !returnsByWrittenStep(old, changed, next) || writtenInterval(old.pitch, changed.pitch).diatonicSteps !== 1) {
      return false;
    }
  }
  return heldUpper === 1;
}

type Score = Pick<HarmonyAnalysis, "project" | "slices">;

// Compare the written parts up to the cadential preparation. Chord labels
// may divide identical notes differently on the two statements.
function reprisesOpening({ project }: Score, start: number, end: number, offset: number) {
  return project.satbTracks.every(track => {
    const window = (left: number, right: number) => track.notes
      .filter(n => n.startTick < right && left < n.startTick + n.durationTicks)
      .sort((a, b) => a.startTick - b.startTick);
    const original = window(start, end), reprise = window(start + offset, end + offset);
    const outer = track.voice === "soprano" || track.voice === "bass";
    return original.length > 0 && original.length === reprise.length &&
      (!outer || original.some(n => !spelledPitchEquals(n.pitch, original[0].pitch))) &&
      original.every((n, i) => n.startTick >= start && n.startTick + n.durationTicks <= end &&
        reprise[i].startTick === n.startTick + offset && reprise[i].durationTicks === n.durationTicks &&
        spelledPitchEquals(reprise[i].pitch, n.pitch));
  });
}

interface ConfirmedEnding {
  readonly preparation: CadenceSpanFacts;
  readonly dominant: CadenceSpanFacts;
  readonly arrival: AnalysisSlice;
  readonly tonic?: CadenceSpanFacts;
  readonly proof: CadenceEvidence;
}

// A template boundary can fall at a rest within the copied material or at the
// first preparation's release. A cut at V, VI or the start of a new clause stands.
function isInternalRest(score: Score, tick: number, opening: number, pre: AnalysisSlice, offset: number) {
  if (!(tick === pre.endTick || (opening < tick && tick < pre.tick) ||
      (opening + offset < tick && tick < pre.tick + offset))) return false;
  const rest = score.slices.find(s => s.tick === tick);
  const attack = rest && score.slices[rest.index - 1];
  return !!rest && !rest.chord && !Object.keys(rest.notes).length && !!attack?.notes.soprano && !!attack.notes.bass &&
    Object.values(attack.notes).length >= 3 && Object.values(attack.notes).every(n => n.startTick + n.durationTicks === tick);
}

/** Spasobin §20.7: the same opening reaches two cadential preparations.
 * Only the earlier dominant avoids the expected tonic. The caller has
 * already established the second, detached authentic ending. */
export function precedingDetachedDeception(
  score: Score, openingTick: number, facts: readonly CadenceSpanFacts[], ending: ConfirmedEnding,
  measureFor: (tick: number) => MeasureInfo | undefined, inferredCuts: readonly number[] = [],
) {
  const { preparation: laterPre, dominant: laterV, arrival: finalOnset, tonic } = ending;
  const key = tonic?.key ?? laterV.key;
  const opening = measureFor(openingTick);
  if (!opening || opening.startTick !== openingTick || !laterPre.chord || key.mode !== "major" ||
      score.project.meterEvents.some(e => openingTick < e.tick && e.tick < finalOnset.endTick) ||
      score.slices.some(s => openingTick <= s.tick && s.tick < finalOnset.endTick && s.key.id !== finalOnset.key.id)) return;
  const inKey = (f: CadenceSpanFacts) => f.interpretationStatus === "resolved" &&
    keyEquals(f.key, key) &&
    f.span.semantics?.interpretations.length === 1 && !f.span.semantics.alternatives?.length && !f.span.semantics?.mixture &&
    !f.span.semantics?.cadenceRole && !f.span.semantics?.pedalContext;
  if (!inKey(laterPre) || !inKey(laterV) || (tonic && !inKey(tonic))) return;
  let found: { dominant: CadenceSpanFacts; vi: CadenceSpanFacts; evidence: CadenceEvidence } | undefined;
  for (let i = 2; i < facts.length; i++) {
    const pre = facts[i - 2], dominant = facts[i - 1], vi = facts[i];
    if (!pre.isSubdominant || pre.degree !== laterPre.degree || !pre.chord ||
        !pitchClassEquals(pre.chord.identity.root, laterPre.chord.identity.root) ||
        !pitchClassEquals(pre.chord.identity.bass, laterPre.chord.identity.bass) ||
        !dominant.isDominant || dominant.degree !== 5 || vi.family !== "tonic" || vi.degree !== 6 ||
        ![pre, dominant, vi].every(inKey)) continue;
    const d = dominant.chord?.identity, t = vi.chord?.identity;
    if (!d || !t || d.structure.kind !== "tertian" || d.structure.quality !== "major" ||
        t.structure.kind !== "tertian" || t.structure.quality !== "minor" ||
        [d.structure, t.structure].some(s => s.extensions.length || s.alterations.length) ||
        chordIdentityInversion(d) !== 0 || chordIdentityInversion(t) !== 0 ||
        !pitchClassEquals(d.root, scaleDegreePitchClass(key, 5)) ||
        !pitchClassEquals(t.root, scaleDegreePitchClass(key, 6))) continue;

    const p = pre.boundarySlice, v = dominant.boundarySlice, arrival = vi.boundarySlice;
    const bar = measureFor(vi.span.fromTick);
    const offset = laterPre.span.fromTick - pre.span.fromTick;
    const restart = openingTick + offset;
    if (!bar || opening.endTick > pre.span.fromTick || bar.startTick !== vi.span.fromTick || measureFor(restart)?.startTick !== restart ||
        restart < vi.span.toTick || !p || !v || !arrival ||
        laterV.span.fromTick !== v.tick + offset || finalOnset.tick !== arrival.tick + offset ||
        laterPre.span.toTick !== p.endTick + offset || laterV.span.toTick !== v.endTick + offset ||
        !sameDetachedRhythm(p, v, arrival, score.slices, ticksPerBeat(score.project.ppq, bar.denominator)) ||
        !writtenAttack(pre, chordIdentityToneSpellings(pre.chord.identity)) ||
        !writtenAttack(dominant, chordIdentityToneSpellings(d)) || !writtenAttack(vi, chordIdentityToneSpellings(t))) continue;
    const leading = chordIdentityToneSpellings(d)[1];
    if (!bassStepsUpToSubmediant(v, arrival) || VOICE_ORDER.some(voice => {
      const before = v.notes[voice], after = arrival.notes[voice];
      if (!before || !after || !pitchClassEquals(before.pitch, leading)) return false;
      const motion = writtenInterval(before.pitch, after.pitch);
      return motion.diatonicSteps !== 1 || motion.semitones !== 1;
    })) continue;
    // After VI releases, a single-line pickup can lead into the reprise.
    // An intervening harmonic clause gives the return a different context.
    if (score.slices.some(s => vi.span.toTick <= s.tick && s.tick < restart &&
        (s.chord || Object.keys(s.notes).length > 1)) ||
        inferredCuts.some(tick => !isInternalRest(score, tick, openingTick, p, offset)) ||
        !reprisesOpening(score, openingTick, p.tick, offset)) continue;
    if (found) return;
    found = { dominant, vi, evidence: {
      code: "detached-deceptive-reprise", value: "前段属至六级，原材料重奏后以相同的顿奏节奏落主",
      refs: [pre.span.id, dominant.span.id, vi.span.id, ...(ending.proof.refs ?? [])],
    } };
  }
  return found;
}

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

function plain(identity: ChordIdentity, quality: "major" | "minor" | "dominant7") {
  const structure = identity.structure;
  return structure.kind === "tertian" && structure.quality === quality &&
    !structure.alterations.length && !structure.extensions.length;
}

function soundsAs(slice: AnalysisSlice, identity: ChordIdentity) {
  return slice.completeSatb &&
    soundsCompleteWrittenChord(identity, writtenNotes(slice), slice.notes.bass!);
}

/** A short V–V2 resolves into an opposite-mode I6 that is also iii/III
 * of the next key (Spasobin §54.1c, §54.2a). */
export function continuesThroughParallelTonic(
  previous: CadenceSpanFacts, terminal: CadenceSpanFacts,
  pivot: CadenceSpanFacts, onward: CadenceSpanFacts, slices: readonly AnalysisSlice[],
  writtenBeatAt: (tick: number) => number | undefined,
) {
  const opening = previous.chord?.identity;
  const dominant = terminal.chord?.identity;
  const tonic = pivot.chord?.identity;
  const nextDominant = onward.chord?.identity;
  if (!opening || !dominant || !tonic || !nextDominant ||
      !plain(opening, "major") || chordIdentityInversion(opening) !== 0 ||
      !plain(dominant, "dominant7") || chordIdentityInversion(dominant) !== 3 ||
      !pitchClassEquals(opening.root, dominant.root) ||
      !plain(tonic, terminal.key.mode === "major" ? "minor" : "major") ||
      chordIdentityInversion(tonic) !== 1 || !pitchClassEquals(tonic.root, terminal.key.tonic) ||
      !pitchClassEquals(pivot.key.tonic, terminal.key.tonic) ||
      pitchClassEquals(onward.key.tonic, terminal.key.tonic) ||
      onward.key.mode !== terminal.key.mode ||
      !pitchClassEquals(tonic.root, scaleDegreePitchClass(onward.key, 3)) ||
      !plain(nextDominant, "dominant7")) return false;

  const before = previous.boundarySlice, arrival = pivot.boundarySlice, newKey = onward.boundarySlice;
  const tick = pivot.span.fromTick;
  const source = slices[terminal.span.sliceIndices.at(-1)!];
  if (!before || !source || !arrival || !newKey ||
      source.endTick !== tick || arrival.tick !== tick || newKey.tick !== onward.span.fromTick ||
      newKey.key.id !== before.key.id || !soundsAs(newKey, nextDominant)) return false;

  const succession = [[previous, opening, terminal], [terminal, dominant, pivot], [pivot, tonic, onward]] as const;
  if (!succession.every(([part, identity, following]) => {
    const beat = writtenBeatAt(part.span.fromTick);
    return beat !== undefined && part.span.toTick - part.span.fromTick <= beat &&
      part.span.toTick === following.span.fromTick && part.span.sliceIndices.every(index => {
        const slice = slices[index];
        return slice.key.id === before.key.id && soundsAs(slice, identity);
      });
  })) return false;

  const bass = source.notes.bass!, tonicBass = arrival.notes.bass!;
  const bassStep = writtenInterval(bass.pitch, tonicBass.pitch);
  if (bass.startTick + bass.durationTicks !== tick || tonicBass.startTick !== tick ||
      !isWrittenStep(bassStep) || bassStep.diatonicSteps !== -1) return false;

  const leading = chordIdentityToneSpellingForDegree(dominant, 3)!;
  const voices = VOICE_ORDER.filter(voice => voice !== "bass");
  const resolvedLeading = voices.some(voice => {
    const note = source.notes[voice]!, next = arrival.notes[voice]!;
    const step = writtenInterval(note.pitch, next.pitch);
    return pitchClassEquals(note.pitch, leading) && next.startTick === tick &&
      note.startTick + note.durationTicks === tick && pitchClassEquals(next.pitch, tonic.root) &&
      step.diatonicSteps === 1 && step.semitones === 1;
  });
  const heldCommonTone = voices.some(voice => {
    const first = before.notes[voice]!, middle = source.notes[voice]!, last = arrival.notes[voice]!;
    return first.id === middle.id && middle.id === last.id && pitchClassEquals(first.pitch, dominant.root);
  });

  return resolvedLeading && heldCommonTone;
}
