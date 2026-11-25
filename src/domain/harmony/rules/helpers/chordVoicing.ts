import {
  chordIdentityToneSpellings,
  chordIdentityToneSpellingForDegree,
  chordToneSpellings,
  QUALITY_INTERVALS,
  type ChordQuality,
} from "../../../chordModel";
import {
  keyEquals,
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  writtenInterval,
  type KeyLike,
  pitchClassValue,
  spellPitchClassForStep,
  stepIndex,
  type SpelledPitchClass,
} from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisChord, AnalysisSlice, AnalysisKey, AnalysisNote } from "../../analysis";
import {
  dominantSixthInnerVoices,
  movesToWrittenTone,
  resolvesDominantInnerVoice,
  canOmitDominantFifth,
} from "../../facts/dominantMotion";
import { decoratedPassingSixFourMotion, upperPassingMotion } from "../../facts/prolongation";
import {
  resolvesRaisedFifthToDoubledThird,
  writtenDoubleDominantResolution,
} from "../../facts/tendencyResolution";
import { createSliceStructuralVoicingReader, soundsCompleteWrittenChord, type StructuralVoicing } from "../../facts/writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes, crossesManualPhraseBoundary, crossesWrittenBoundary } from "./core";
import {
  pairedOuterNeighbors,
  triadTailOrnaments,
  beforeMelodicMinorPassingBass,
  isVerifiedChordOrnament,
  isVerifiedOrnamentalBass,
  readUnmarkedOrnament,
} from "./ornaments";

export { respeltDegrees, writtenDoubleDominantResolution } from "../../facts/tendencyResolution";

export interface ChordSliceFact {
  readonly slice: AnalysisSlice;
  readonly chord: AnalysisChord;
  readonly active: ReturnType<typeof activeNotes>;
  readonly tones: ReturnType<typeof chordIdentityToneSpellings>;
  readonly stableComplete: boolean;
  readonly structural?: StructuralVoicing;
}

interface ChordSliceFacts {
  readonly all: readonly ChordSliceFact[];
  readonly standard: readonly ChordSliceFact[];
}

// Each check owns its rule context, including incremental and concurrent checks.
const byContext = new WeakMap<HarmonyRuleContext, ChordSliceFacts>();

export function chordSliceFacts(context: HarmonyRuleContext): ChordSliceFacts {
  const cached = byContext.get(context);
  if (cached) return cached;

  let readStructural: ReturnType<typeof createSliceStructuralVoicingReader> | undefined;
  const all: ChordSliceFact[] = [];
  const standard: ChordSliceFact[] = [];
  for (const slice of context.slices()) {
    const chord = slice.chord;
    if (!chord) continue;
    readStructural ??= createSliceStructuralVoicingReader(
      context.analysis.slices, context.analysis.project, tick => context.metric.positionAt(tick),
    );
    const fact = {
      slice, chord, active: activeNotes(slice), tones: chordIdentityToneSpellings(chord.identity),
      structural: readStructural(slice.index, chord.identity),
      stableComplete: slice.completeSatb && !context.sliceTransitions({ fromSliceIndex: slice.index }).first()?.sameHarmony,
    };
    all.push(fact);
    const { structure } = chord.identity;
    if (structure.kind === "tertian" && !structure.extensions.some(degree => degree >= 9)) standard.push(fact);
  }
  const facts = { all, standard };
  byContext.set(context, facts);
  return facts;
}

export function supportsBassTriad(
  context: HarmonyRuleContext, key: AnalysisKey, bass: AnalysisNote,
  endTick: number, degree: 1 | 2 | 4 | 5, quality: "major" | "minor", soloBass: boolean, fromTick = bass.startTick,
) {
  const root = scaleDegreePitchClass(key, degree);
  const tones = chordToneSpellings(root, quality);
  const functionName = degree === 4 || degree === 2 ? "subdominant" : degree === 5 ? "dominant" : "tonic";
  return context.slices({ overlapping: { fromTick, toTick: endTick } }).all(slice => {
    if (slice.notes.bass?.id !== bass.id) return false;
    if (slice.chord) {
      const { root: labelledRoot, bass: labelledBass, structure } = slice.chord.identity;
      if (structure.kind !== "tertian" || structure.quality !== quality ||
          structure.extensions.length || structure.alterations.length ||
          !pitchClassEquals(labelledRoot, root) || !pitchClassEquals(labelledBass, bass.pitch)) return false;
      const meaning = context.harmony.primaryInterpretation(slice.chord);
      if (meaning.status === "ambiguous") return false;
      if (meaning.status === "resolved") {
        const { appliedTarget, degree: labelledDegree, designation, localKey } = meaning.value;
        if (appliedTarget || (labelledDegree !== undefined && labelledDegree !== degree) ||
            (designation?.primaryFunction && designation.primaryFunction !== functionName) ||
            (localKey && !keyEquals(localKey, key))) return false;
      }
    }

    // The printed bass exercise supplies no upper parts. With SATB evidence
    // require the written triad and the stated bass to be the sounding bottom.
    if (soloBass) return Object.values(slice.notes).length === 1;
    if (!slice.completeSatb) return false;
    const notes = Object.values(slice.notes);
    const lowest = toMidi(bass.pitch);
    return notes.every(note => !note.nonChordToneRole && toMidi(note.pitch) >= lowest &&
      tones.some(tone => pitchClassEquals(note.pitch, tone))) &&
      tones.every(tone => notes.some(note => pitchClassEquals(note.pitch, tone)));
  });
}

function frame(context: HarmonyRuleContext, slice: AnalysisSlice) {
  return {
    fromTick: slice.tick, toTick: slice.endTick, key: slice.key, activeNotes: slice.notes,
    metric: context.metric.positionAt(slice.tick),
  };
}

// A labelled passing tone can precede a harmony change. Without a label,
// require the same written triad and three held parts through the arrival.
function upperPassingVoicing(context: HarmonyRuleContext, end: AnalysisSlice) {
  if (!end.chord || end.attackVoiceIds.length !== 1) return;
  const [voice] = end.attackVoiceIds;
  const note = end.notes[voice];
  if (voice === "bass" || !note || (note.nonChordToneRole && note.nonChordToneRole !== "passing")) return;
  const left = context.sliceAt(end.tick - 1);
  const right = context.sliceAt(end.endTick);
  if (!left?.chord || left.chord.id !== end.chord.id || !right?.chord ||
      context.analysis.phraseBoundaries.some(b => left.tick < b.tick && b.tick <= right.tick)) return;
  const structure = end.chord.identity.structure;
  if (structure.kind !== "tertian" || !["major", "minor"].includes(structure.quality)) return;
  if (!note.nonChordToneRole && (right.chord.id !== end.chord.id || structure.extensions.length ||
      structure.alterations.length || VOICE_ORDER.some(part =>
        part !== voice && end.notes[part]?.id !== right.notes[part]?.id))) return;
  const motion = upperPassingMotion(frame(context, left), frame(context, end), frame(context, right), context.analysis.project.ppq);
  if (!motion) return;
  const tones = chordIdentityToneSpellings(end.chord.identity);
  if (!tones.some(t => pitchClassEquals(t, motion.after.pitch)) ||
      context.harmony.isWrittenChordTone(motion.note, right.chord) ||
      !soundsCompleteWrittenChord(left.chord.identity, Object.values(left.notes), left.notes.bass!) ||
      !soundsCompleteWrittenChord(right.chord.identity, Object.values(right.notes), right.notes.bass!)) return;
  return { noteIds: [motion.note.id], departure: left };
}

export function decoratedPassingVoicing(context: HarmonyRuleContext, ornament: AnalysisSlice) {
  if (!ornament.chord || ornament.attackVoiceIds.length !== 1 ||
      ornament.notes[ornament.attackVoiceIds[0]]?.nonChordToneRole !== "passing") return;
  const left = context.sliceAt(ornament.tick - 1);
  const sixFour = context.sliceAt(ornament.endTick);
  const right = sixFour && context.sliceAt(sixFour.endTick);
  if (left?.chord?.id !== ornament.chord.id || sixFour?.chord?.semantics?.cadenceRole !== "passing64" ||
      !right?.chord || context.analysis.phraseBoundaries.some(b => left.tick < b.tick && b.tick <= right.tick)) return;
  const motion = decoratedPassingSixFourMotion(
    { ...frame(context, left), identity: left.chord.identity }, frame(context, ornament),
    { ...frame(context, sixFour), identity: sixFour.chord.identity }, { ...frame(context, right), identity: right.chord.identity },
    context.analysis.project.ppq,
  );
  return motion && { noteIds: [motion.note.id], departure: left };
}

export function triadOrnaments(context: HarmonyRuleContext, slice: AnalysisSlice) {
  return upperPassingVoicing(context, slice) ?? decoratedPassingVoicing(context, slice) ??
    triadTailOrnaments(context, slice) ?? pairedOuterNeighbors(context, slice);
}

export function structuralTriadVoicing(context: HarmonyRuleContext, end: AnalysisSlice) {
  if (end.attackVoiceIds.length === 1 && end.attackVoiceIds[0] === "bass" &&
      end.notes.bass?.nonChordToneRole === "passing") return beforeMelodicMinorPassingBass(context, end) ?? end;
  return triadOrnaments(context, end)?.departure ?? end;
}

export function realizedBeforeVerifiedOrnaments(
  context: HarmonyRuleContext,
  slice: AnalysisSlice,
  chord: AnalysisChord,
  active: ReturnType<typeof activeNotes>,
  requiredTones: readonly SpelledPitchClass[],
  missing: readonly SpelledPitchClass[],
) {
  if (slice.tick <= chord.startTick) return false;
  const verified = active.filter(item =>
    isVerifiedChordOrnament(context, chord, item) ||
    (item.voiceId === "bass" && isVerifiedOrnamentalBass(context, slice, chord, item.note)) ||
    readUnmarkedOrnament(context, slice, item.voiceId, item.note));
  if (!verified.length) return false;
  const retained = active.filter(({ note }) => context.harmony.isWrittenChordTone(note, chord));
  const covers = (notes: ReturnType<typeof activeNotes>, tones: readonly SpelledPitchClass[]) =>
    tones.every(tone => notes.some(({ note }) => pitchClassEquals(note.pitch, tone)));

  // Chs. 36–43: an ornament can temporarily displace a structural member
  // only where the sounding voicing supplies evidence in that same voice.
  return context.slices({ overlapping: { fromTick: chord.startTick, toTick: slice.tick } }).any(anchor => {
    if (!anchor.completeSatb || anchor.chord?.id !== chord.id ||
        crossesManualPhraseBoundary(context, anchor.tick, slice.tick) ||
        context.analysis.project.keyEvents.some(event => anchor.tick < event.tick && event.tick <= slice.tick)) return false;

    const original = activeNotes(anchor).filter(({ note }) => !note.nonChordToneRole ||
      ((note.nonChordToneRole === "suspension" || note.nonChordToneRole === "retardation") &&
        context.harmony.isWrittenChordTone(note, chord)));
    if (!anchor.notes.bass || !pitchClassEquals(anchor.notes.bass.pitch, chord.identity.bass) ||
        !covers(original, requiredTones)) return false;
    const replacements = original.filter(item => verified.some(({ voiceId }) => item.voiceId === voiceId));
    const fifth = chordIdentityToneSpellingForDegree(chord.identity, 5);
    if (fifth && slice.tick - anchor.tick <= 2 * context.analysis.project.ppq &&
        !covers(replacements, [fifth]) && missing.some(tone => pitchClassEquals(tone, fifth)) &&
        missing.some(tone => covers(replacements, [tone]))) {
      const exchanged = original.find(({ voiceId, note }) => {
        const sounding = slice.notes[voiceId];
        return pitchClassEquals(note.pitch, fifth) && sounding && !sounding.nonChordToneRole &&
          context.harmony.isWrittenChordTone(sounding, chord);
      });
      if (exchanged) replacements.push(exchanged);
    }
    return replacements.every(({ voiceId }) => context.slices({ overlapping: { fromTick: anchor.tick, toTick: slice.tick } })
      .all(frame => !!frame.notes[voiceId])) &&
      covers(replacements, missing) && covers([...retained, ...replacements], requiredTones);
  });
}

/** A previously written fifth can leave a triad as the same dominant
 * gains its seventh. Never borrow a root, third or seventh this way. */
export function writtenDominantFifthExchange(
  context: HarmonyRuleContext, slice: AnalysisSlice, missing: readonly SpelledPitchClass[],
) {
  const chord = slice.chord, bass = slice.notes.bass;
  if (!chord || !bass || !pitchClassEquals(bass.pitch, chord.identity.bass) || missing.length !== 1) return false;
  const { root, structure } = chord.identity;
  if (structure.kind !== "tertian" || (structure.quality !== "major" && structure.quality !== "dominant7") ||
      structure.alterations.length || structure.extensions.length) return false;
  const tones = chordToneSpellings(root, structure.quality);
  if (!pitchClassEquals(missing[0], tones[2])) return false;
  const meaning = context.harmony.primaryInterpretation(chord);
  const applied = meaning.status === "resolved" ? meaning.value.appliedTarget : undefined;
  if (!(applied || (meaning.status === "resolved" && meaning.value.degree === 5 &&
      meaning.value.designation?.kind === "primary"))) return false;
  const matching = (frame: AnalysisSlice) => {
    const other = frame.chord;
    if (!other || !pitchClassEquals(other.identity.root, root)) return false;
    const interpretation = context.harmony.primaryInterpretation(other);
    if (interpretation.status !== "resolved" || meaning.status !== "resolved" ||
        !keyEquals(interpretation.value.localKey ?? frame.key, meaning.value.localKey ?? slice.key) ||
        interpretation.value.degree !== meaning.value.degree) return false;
    const target = interpretation.value.appliedTarget;
    return target?.degree === applied?.degree && target?.primaryFunction === applied?.primaryFunction &&
      target?.secondaryFunction === applied?.secondaryFunction &&
      !other.semantics?.cadenceRole;
  };
  const before = context.slices({ overlapping: {
    fromTick: Math.max(0, slice.tick - 2 * context.analysis.project.ppq), toTick: slice.tick,
  } }).toArray();
  // Require a real triad-to-seventh change when using a close-position
  // reconfiguration, not a blanket exception for incomplete applied triads.
  const next = context.sliceAt(slice.endTick)?.chord;
  const exchanging = structure.quality === "dominant7" ||
    (next?.identity.structure.kind === "tertian" && next.identity.structure.quality === "dominant7" &&
      matching(context.sliceAt(slice.endTick)!));
  if (!exchanging || !Object.values(slice.notes).every(n => tones.some(t => pitchClassEquals(t, n.pitch)))) return false;
  return before.some((anchor, index) => {
    if (!anchor.completeSatb || !anchor.notes.bass || !anchor.chord || !matching(anchor) ||
        anchor.chord.identity.structure.kind !== "tertian" || anchor.chord.identity.structure.quality !== "major" ||
        !soundsCompleteWrittenChord(anchor.chord.identity, Object.values(anchor.notes), anchor.notes.bass) ||
        crossesWrittenBoundary(context, anchor.tick, slice.tick) ||
        !before.slice(index).every(frame => frame.completeSatb && matching(frame))) return false;
    return VOICE_ORDER.filter(voice => voice !== "bass" &&
      context.pitch.sameWrittenPitch(anchor.notes[voice]!, slice.notes[voice]!)).length >= 2;
  });
}

function primaryKey(context: HarmonyRuleContext, slice: AnalysisSlice, degree: 1 | 5) {
  const chord = slice.chord;
  if (!chord?.semantics || chord.semantics.alternatives?.length || chord.semantics.interpretations.length !== 1 ||
      chord.semantics.pedalContext || chord.semantics.mixture || chord.semantics.cadenceRole) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== degree || reading.value.degreeAlteration !== 0 ||
      reading.value.appliedTarget || reading.value.designation?.kind !== "primary" ||
      reading.value.designation.primaryFunction !== (degree === 1 ? "tonic" : "dominant")) return;
  return reading.value.localKey ?? slice.key;
}

// Spasobin §24.7. When the upper sixth replaces the fifth, all four
// written voices can still establish a direct resolution to three roots and a third.
function resolvesWrittenDominantSixth(
  context: HarmonyRuleContext, source: AnalysisSlice, landing: AnalysisSlice, key: KeyLike,
) {
  const root = scaleDegreePitchClass(key, 5);
  const [, third, , seventh] = chordToneSpellings(root, "dominant7");
  if (source.chord) {
    const previousKey = primaryKey(context, source, 5);
    const identity = source.chord.identity;
    const shape = identity.structure;
    if (!previousKey || !keyEquals(previousKey, key) ||
        shape.kind !== "tertian" || shape.quality !== "dominant7" || shape.alterations.length ||
        shape.extensions.some(extension => extension !== 6) ||
        !pitchClassEquals(identity.root, root) || !pitchClassEquals(identity.bass, root)) return false;
  }
  const bass = source.notes.bass!;
  const soprano = source.notes.soprano!;
  const landingBass = landing.notes.bass!;
  const tonicThird = scaleDegreePitchClass(key, 3);
  if (!pitchClassEquals(bass.pitch, root) || soprano.startTick !== source.tick ||
      soprano.startTick + soprano.durationTicks !== landing.tick ||
      !pitchClassEquals(soprano.pitch, tonicThird) ||
      !movesToWrittenTone(soprano.pitch, landing.notes.soprano!.pitch, key.tonic, -2) ||
      !leapsToTonic(bass, landingBass, key) ||
      !Object.values(source.notes).every(note => !note.nonChordToneRole &&
        toMidi(bass.pitch) <= toMidi(note.pitch) && toMidi(note.pitch) <= toMidi(soprano.pitch))) return false;
  const [alto, tenor] = dominantSixthInnerVoices;
  return (pitchClassEquals(source.notes[alto]!.pitch, third) || pitchClassEquals(source.notes[tenor]!.pitch, third)) &&
    (pitchClassEquals(source.notes[alto]!.pitch, seventh) || pitchClassEquals(source.notes[tenor]!.pitch, seventh)) &&
    dominantSixthInnerVoices.every(voice => {
      const from = source.notes[voice]!;
      return from.startTick === source.tick && from.startTick + from.durationTicks === landing.tick &&
        resolvesDominantInnerVoice(from.pitch, landing.notes[voice]!.pitch, third, seventh, key.tonic, tonicThird);
    });
}

function leapsToTonic(
  from: AnalysisNote,
  to: AnalysisNote,
  key: KeyLike,
) {
  const leap = writtenInterval(from.pitch, to.pitch);
  return pitchClassEquals(to.pitch, key.tonic) && (leap.semitones === 5 || leap.semitones === -7);
}

// Spasobin 14–194 and 16–220. The fifth and seventh descend, the third ascends,
// and the dominant root leaps to the tonic in its own voice.
export function landsOnIncompleteTonic(context: HarmonyRuleContext, landing: AnalysisSlice) {
  const source = context.sliceAt(landing.tick - 1);
  if (!source || !landing.chord || !source.completeSatb || !landing.completeSatb ||
      landing.tick !== landing.chord.startTick || source.endTick !== landing.tick ||
      source.key.id !== landing.key.id ||
      context.analysis.phraseBoundaries.some(mark => mark.source === "manual" && mark.tick === landing.tick)) return false;
  const key = primaryKey(context, landing, 1);
  const tonic = landing.chord.identity;
  const bass = landing.notes.bass!;
  if (!key || tonic.structure.kind !== "tertian" || tonic.structure.quality !== key.mode ||
      !pitchClassEquals(tonic.root, key.tonic) || !pitchClassEquals(bass.pitch, tonic.root) ||
      !Object.values(landing.notes).every(note =>
        !note.nonChordToneRole && note.startTick === landing.tick && toMidi(note.pitch) >= toMidi(bass.pitch),
      )) return false;

  if (key.mode === "major" && resolvesRaisedFifthToDoubledThird(source, landing, key.tonic)) return true;
  if (resolvesWrittenDominantSixth(context, source, landing, key)) return true;
  const previousKey = primaryKey(context, source, 5);
  if (!source.chord || !previousKey || !keyEquals(previousKey, key)) return false;
  const dominant = source.chord.identity;
  if (dominant.structure.kind !== "tertian" || dominant.structure.quality !== "dominant7" ||
      dominant.structure.extensions.length || dominant.structure.alterations.length ||
      !pitchClassEquals(dominant.root, scaleDegreePitchClass(key, 5))) return false;
  const [root, third, fifth, seventh] = chordIdentityToneSpellings(dominant);
  if ((!pitchClassEquals(dominant.bass, root) && !pitchClassEquals(dominant.bass, fifth)) ||
      !soundsCompleteWrittenChord(dominant, Object.values(source.notes), source.notes.bass!)) return false;
  const tonicThird = scaleDegreePitchClass(key, 3);
  return VOICE_ORDER.every(voice => {
    const from = source.notes[voice]!;
    const to = landing.notes[voice]!;
    if (pitchClassEquals(from.pitch, third)) return movesToWrittenTone(from.pitch, to.pitch, tonic.root, 1, 1);
    if (pitchClassEquals(from.pitch, fifth)) return movesToWrittenTone(from.pitch, to.pitch, tonic.root, -1, -2);
    if (pitchClassEquals(from.pitch, seventh)) return movesToWrittenTone(from.pitch, to.pitch, tonicThird, -1);
    return leapsToTonic(from, to, key);
  });
}

export interface CompletedVoicing {
  root: SpelledPitchClass;
  quality: ChordQuality;
  member: SpelledPitchClass;
}

const letter = (index: number) => ((index % 7) + 7) % 7;

/** Each written root is derived from an unmasked member. The tested pitch supplies only sound. */
export function completeVoicings(
  slice: AnalysisSlice, masked: VoiceId, qualities: readonly ChordQuality[],
  { canSupplyMissingMember = true, allowOmittedDominantFifth = false }:
    { canSupplyMissingMember?: boolean; allowOmittedDominantFifth?: boolean } = {},
) {
  const note = slice.notes[masked], bass = slice.notes.bass;
  if (!slice.completeSatb || !note || !bass) return [];
  const peers = VOICE_ORDER.filter(voice => voice !== masked).map(voice => slice.notes[voice]!.pitch);
  const lowest = toMidi(bass.pitch);
  if (toMidi(note.pitch) < lowest || peers.some(pitch => toMidi(pitch) < lowest)) return [];

  const [anchor] = peers;
  const sound = pitchClassValue(note.pitch);
  const readings: CompletedVoicing[] = [];
  for (const quality of qualities) {
    for (const [index, interval] of QUALITY_INTERVALS[quality].entries()) {
      const rootLetter = letter(stepIndex(anchor.step) - 2 * index);
      const root = spellPitchClassForStep(pitchClassValue(anchor) - interval, rootLetter);
      if (stepIndex(root.step) !== rootLetter) continue;
      const tones = chordToneSpellings(root, quality);
      if (tones.some((tone, i) => stepIndex(tone.step) !== letter(rootLetter + 2 * i))) continue;
      const member = tones.find(tone => pitchClassValue(tone) === sound);
      if (!member || !peers.every(pitch => tones.some(tone => pitchClassEquals(pitch, tone)))) continue;
      const omitFifth = allowOmittedDominantFifth && quality === "dominant7" &&
        canOmitDominantFifth(root, masked === "bass" ? member : bass.pitch, [member, ...peers]);
      if (!tones.every((tone, index) => (index === 2 && omitFifth) ||
          (canSupplyMissingMember && pitchClassEquals(member, tone)) ||
          peers.some(pitch => pitchClassEquals(pitch, tone)))) continue;
      readings.push({ root, quality, member });
    }
  }
  return readings;
}

export function agreedMember(readings: readonly CompletedVoicing[]) {
  const first = readings[0]?.member;
  return first && readings.every(chord => pitchClassEquals(chord.member, first)) ? first : undefined;
}

export function agreesWithExplicitIdentity(
  frame: AnalysisSlice, masked: VoiceId, voicing: CompletedVoicing, trackLocked: boolean,
) {
  return agreesWithExplicitMembers(frame, masked, voicing, chordToneSpellings(voicing.root, voicing.quality), trackLocked);
}

export function agreesWithExplicitMembers(
  frame: AnalysisSlice, masked: VoiceId, voicing: Pick<CompletedVoicing, "root" | "member">,
  realized: readonly SpelledPitchClass[], trackLocked: boolean,
) {
  const chord = frame.chord;
  if (!chord) return true;
  // An absolute-only label has no provenance. Preserve a conflicting spelling
  // there just as on a locked track or an explicitly confirmed chord.
  const explicit = trackLocked || chord.locked || !chord.semantics || chord.semantics.interpretations.some(
    meaning => meaning.source === "manual" || meaning.source === "confirmed",
  );
  if (!explicit) return true;

  const bass = masked === "bass" ? voicing.member : frame.notes.bass!.pitch;
  if (!pitchClassEquals(chord.identity.root, voicing.root) || !pitchClassEquals(chord.identity.bass, bass)) return false;
  const declared = chordIdentityToneSpellings(chord.identity);
  return declared.length === realized.length &&
    realized.every(tone => declared.some(member => pitchClassEquals(tone, member)));
}

export function readDoubleDominantResolution(context: HarmonyRuleContext, source: AnalysisSlice, target: AnalysisSlice) {
  const role = target.chord?.semantics?.cadenceRole;
  if (role && role !== "cadential64") return;
  const sourceReading = source.chord && context.harmony.primaryInterpretation(source.chord);
  const targetReading = target.chord && context.harmony.primaryInterpretation(target.chord);
  const sourceKey = sourceReading?.status === "resolved" ? sourceReading.value.localKey : undefined;
  const targetKey = targetReading?.status === "resolved" ? targetReading.value.localKey : undefined;
  if (sourceKey && targetKey && !keyEquals(sourceKey, targetKey)) return;
  const key = targetKey ?? sourceKey ?? source.key;
  const resolution = writtenDoubleDominantResolution(source, target, key);
  if (!resolution || crossesWrittenBoundary(context, source.notes[resolution.voiceId]!.startTick, target.tick)) return;

  // The declared diminished seventh retains its tertian identity even when
  // the score uses the enharmonic ♯II. Check both labels against that reading.
  const root = scaleDegreePitchClass(key, 4, 1);
  const trackLocked = context.analysis.project.chordTrack.locked;
  if (agreesWithExplicitIdentity(source, resolution.voiceId,
    { root, quality: "diminished7", member: chordToneSpellings(root, "diminished7")[3] }, trackLocked) &&
    agreesWithExplicitIdentity(target, resolution.voiceId,
      { root: key.tonic, quality: "major", member: resolution.current }, trackLocked)) return resolution;
}
