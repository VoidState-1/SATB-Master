import {
  chordIdentityToneSpellings,
  chordToneSpellings,
  type ChordQuality,
  type FunctionalTarget,
  type HarmonyInterpretation,
  type KeyReference,
  functionalTargetForDegree,
} from "../../../../chordModel";
import {
  keyDeclarationEquals,
  keyEquals,
  pitchClassEquals,
  spelledPitchEquals,
  scaleDegreePitchClass,
  toMidi,
  type SpelledPitchClass,
  writtenInterval,
  leadingTonePitchClass,
} from "../../../../pitch";
import { VOICE_ORDER } from "../../../../project/voice";
import type { AnalysisSlice, AnalysisChord, MelodyTransition } from "../../../analysis";
import {
  readWrittenDominantSeventh,
  readWrittenDominantSeventhHandoff,
  movesToWrittenTone,
} from "../../../facts/dominantMotion";
import {
  diatonicMinorTarget,
  proveLocalMinorDeceptiveDominant,
  hasExactWrittenStack,
} from "../../../facts/functionalContext";
import {
  allowsWrittenTertianIdentity,
  hasWrittenVoicing,
  matchesWrittenChord,
  resolvesLeadingSeventhToDoubledThird,
  resolvesInVoice,
} from "../../../facts/tendencyResolution";
import { soundsDeclaredChord, soundsWrittenMemberSet } from "../../../facts/writtenVoicing";
import { isCadential64Span } from "../../connector";
import type { HarmonyRuleContext } from "../../context/createRuleContext";
import type { ConnectionView } from "../../context/views";
import { writtenDoubleDominantResolution, supportsBassTriad } from "../../helpers/chordVoicing";
import { crossesManualPhraseBoundary } from "../../helpers/core";
import { isVerifiedChordOrnament, resolvePassingChain } from "../../helpers/ornaments";
import { leadingToneForFunction } from "../../services/harmony";

type WrittenSeventh = NonNullable<ReturnType<typeof readWrittenDominantSeventh>>;
type WrittenAppliedFrame =
  | { kind: "dominant"; seventh?: WrittenSeventh }
  | { kind: "leading" }
  | { kind: "augmented-sixth" };

function sameTarget(left: FunctionalTarget, right: FunctionalTarget) {
  return left.degree === right.degree && left.primaryFunction === right.primaryFunction &&
    left.secondaryFunction === right.secondaryFunction;
}

function targetsDominant(target: FunctionalTarget) {
  return target.degree === 5 && target.primaryFunction === "dominant" && !target.secondaryFunction;
}

function writtenSeventh(slice: AnalysisSlice, root: SpelledPitchClass) {
  const seventh = readWrittenDominantSeventh(slice.notes);
  if (seventh && pitchClassEquals(seventh.root, root) &&
      allowsWrittenTertianIdentity(slice, root, "dominant7") &&
      Object.values(slice.notes).every(note => toMidi(note.pitch) >= toMidi(slice.notes.bass!.pitch))) {
    return seventh;
  }
}

function structuralAppliedStack(
  rules: HarmonyRuleContext, slice: AnalysisSlice, root: SpelledPitchClass, quality: ChordQuality,
) {
  if (!allowsWrittenTertianIdentity(slice, root, quality) || !slice.completeSatb) return false;
  const tones = chordToneSpellings(root, quality);
  const bass = slice.notes.bass!;
  const required = quality === "major" || quality === "dominant7"
    ? tones.filter((_, index) => index !== 2) : tones;
  const voiced = VOICE_ORDER.flatMap(voiceId => {
    const note = slice.notes[voiceId]!;
    if (toMidi(note.pitch) < toMidi(bass.pitch)) return [];
    if (tones.some(tone => pitchClassEquals(note.pitch, tone))) return [note];
    if (voiceId !== "bass" && note.nonChordToneRole) {
      const view = rules.notes({ voiceId, startingAt: note.startTick }).first(item => item.note.id === note.id);
      if (view && note.nonChordToneRole === "passing") {
        const line = resolvePassingChain(rules, view);
        if (line && slice.tick >= line.fromTick && slice.tick < line.toTick) return [undefined];
      }
      if (view && slice.chord && note.nonChordToneRole === "neighbor" &&
          isVerifiedChordOrnament(rules, slice.chord, view)) {
        const departure = rules.noteNeighborhood(view)?.previous?.note;
        if (departure && tones.some(tone => pitchClassEquals(departure.pitch, tone))) return [departure];
      }
    }
    return [];
  });
  return voiced.length === 4 && required.every(tone =>
    voiced.some(note => note && pitchClassEquals(note.pitch, tone))) &&
    ((quality !== "major" && quality !== "dominant7") ||
      voiced.some(note => note && pitchClassEquals(note.pitch, tones[2])) ||
      voiced.filter(note => note && pitchClassEquals(note.pitch, tones[1])).length === 1);
}

function writtenAppliedFrame(
  rules: HarmonyRuleContext, slice: AnalysisSlice, reading: HarmonyInterpretation, key: KeyReference, target: FunctionalTarget,
  provesRisingSeventh?: (root: SpelledPitchClass) => boolean,
): WrittenAppliedFrame | undefined {
  const identity = slice.chord?.identity;
  if (!identity || !slice.completeSatb) return;
  const localTonic = scaleDegreePitchClass(key, target.degree);
  const targetKey = { tonic: localTonic, mode: "major" } as const;
  const { designation, appliedTarget, degree, degreeAlteration } = reading;

  if (identity.structure.kind === "augmented-sixth") {
    // ♭2 and 7 of the receiving root form the written augmented sixth.
    if (designation?.kind === "augmented-sixth" && targetsDominant(target) &&
        (!appliedTarget || sameTarget(appliedTarget, target)) &&
        pitchClassEquals(identity.root, scaleDegreePitchClass(targetKey, 2, -1)) &&
        slice.notes.bass && pitchClassEquals(slice.notes.bass.pitch, identity.bass) &&
        soundsWrittenMemberSet(slice, chordIdentityToneSpellings(identity))) return { kind: "augmented-sixth" };
    return;
  }

  if (!appliedTarget || !sameTarget(appliedTarget, target) || degreeAlteration !== 0 ||
      designation?.primaryFunction !== "dominant") return;
  if (degree === 5 && (designation.kind === "double-dominant" || designation.kind === "applied-dominant")) {
    const root = scaleDegreePitchClass(targetKey, 5);
    if (structuralAppliedStack(rules, slice, root, "major")) return { kind: "dominant" };
    const seventh = writtenSeventh(slice, root);
    if (seventh || structuralAppliedStack(rules, slice, root, "dominant7")) return { kind: "dominant", seventh };
  }
  if (degree === 7 && (designation.kind === "double-dominant-leading-tone" || designation.kind === "applied-leading-tone")) {
    const root = scaleDegreePitchClass(targetKey, 7);
    const { quality } = identity.structure;
    if (quality === "diminished" || quality === "diminished7" || quality === "halfDiminished7") {
      if (structuralAppliedStack(rules, slice, root, quality) ||
          (quality === "diminished7" && provesRisingSeventh?.(root))) return { kind: "leading" };
    }
  }
}

/** Preserve the DDVII reading when the score writes its seventh as raised II
 * and the next written voicing confirms the cadential six-four. */
function hasRisingSeventhIntoCadential64(
  rules: HarmonyRuleContext, { target: { span, slices, lastSlice } }: ConnectionView,
  key: KeyReference, root: SpelledPitchClass,
) {
  const landing = rules.spanAt(span.toTick);
  if (!landing || landing.span.fromTick !== span.toTick || !isCadential64Span(landing.span) ||
      crossesManualPhraseBoundary(rules, span.fromTick, landing.span.fromTick)) return false;
  const goal = landing.firstSlice;
  const reading = rules.harmony.primaryInterpretation(landing.span);
  const role = landing.span.semantics?.cadenceRole;
  if ((role && role !== "cadential64") || reading.status !== "resolved" ||
      reading.value.appliedTarget || reading.value.degree !== 1 || reading.value.degreeAlteration !== 0 ||
      !keyEquals(reading.value.localKey ?? goal.key, key) ||
      !matchesWrittenChord(goal, key.tonic, key.mode)) return false;

  const resolution = writtenDoubleDominantResolution(lastSlice, goal, key);
  if (!resolution) return false;
  const [first, third, fifth] = chordToneSpellings(root, "diminished7");
  const tones = [first, third, fifth, resolution.previous];
  return slices.every(frame => keyDeclarationEquals(frame.key, goal.key) &&
    allowsWrittenTertianIdentity(frame, root, "diminished7") && hasWrittenVoicing(frame, tones));
}

export function writtenAppliedDominantMotion(
  rules: HarmonyRuleContext, view: ConnectionView, pendingTarget: FunctionalTarget,
): "prolongation" | "target-transfer" | undefined {
  const { connection, sourceBoundary: before, targetBoundary: after } = view;
  if (!connection.contiguous || !connection.sameKey || connection.tonalBoundary || before.endTick !== after.tick ||
      !keyDeclarationEquals(before.key, after.key) ||
      crossesManualPhraseBoundary(rules, view.source.span.fromTick, after.tick)) return;
  const source = rules.harmony.primaryInterpretation(view.source.span);
  const arrival = rules.harmony.primaryInterpretation(view.target.span);
  if (source.status !== "resolved" || arrival.status !== "resolved") return;

  const key = source.value.localKey ?? before.key;
  const nextTarget = arrival.value.appliedTarget ?? pendingTarget;
  const from = writtenAppliedFrame(rules, before, source.value, key, pendingTarget);
  const sameGoal = sameTarget(pendingTarget, nextTarget);
  // Prefer the actual edge, but an earlier complete statement can identify
  // a source decorated at its end. It may not bridge a rest or a phrase cut.
  const established = !from && sameGoal ? [...view.source.slices].reverse().find(frame =>
    before.tick - frame.tick <= rules.analysis.project.ppq &&
    !crossesManualPhraseBoundary(rules, frame.tick, after.tick) &&
    view.source.slices.every(part => part.tick < frame.tick || part.completeSatb) &&
    writtenAppliedFrame(rules, frame, source.value, key, pendingTarget)) : undefined;
  const sourceFrame = from ?? (established && writtenAppliedFrame(rules, established, source.value, key, pendingTarget));
  if (!sourceFrame) return;
  const to = writtenAppliedFrame(rules, after, arrival.value, key, nextTarget, root =>
    sameGoal && sourceFrame.kind === "dominant" && targetsDominant(pendingTarget) &&
    hasRisingSeventhIntoCadential64(rules, view, key, root));
  if (!to) return;

  if (sameGoal) {
    if (sourceFrame.kind === to.kind) return "prolongation";
    const leading = leadingTonePitchClass({ tonic: scaleDegreePitchClass(key, pendingTarget.degree), mode: "major" });
    const carriesGuide = VOICE_ORDER.some(voice => {
      const first = before.notes[voice], second = after.notes[voice];
      return first && second && pitchClassEquals(first.pitch, leading) &&
        spelledPitchEquals(first.pitch, second.pitch);
    });
    if (to.kind === "augmented-sixth" ||
        (targetsDominant(pendingTarget) && sourceFrame.kind === "dominant" && to.kind === "leading") ||
        (carriesGuide && !targetsDominant(pendingTarget) && sourceFrame.kind === "leading" && to.kind === "dominant"))
      return "prolongation";
    return;
  }

  const sourceSeventh = from?.kind === "dominant" ? from.seventh : undefined;
  const targetSeventh = to.kind === "dominant" ? to.seventh : undefined;
  if (sourceSeventh && targetSeventh && pitchClassEquals(sourceSeventh.target, targetSeventh.root) &&
      VOICE_ORDER.some(voice => readWrittenDominantSeventhHandoff(before, after, voice, sourceSeventh.root))) {
    return "target-transfer";
  }
}

/** A label is not the landing evidence of a prolonged obligation. */
export function hasWrittenAppliedLanding(rules: HarmonyRuleContext, view: ConnectionView) {
  const entry = view.target.firstSlice;
  return view.target.slices.some(frame => {
    if (crossesManualPhraseBoundary(rules, entry.tick, frame.tick) ||
        !view.target.slices.every(part => part.tick > frame.tick || part.completeSatb)) return false;
    const identity = frame.chord?.identity;
    const bass = frame.notes.bass;
    if (!identity || !bass || !frame.completeSatb || !pitchClassEquals(bass.pitch, identity.bass)) return false;
    const tones = chordIdentityToneSpellings(identity);
    return !!tones[1] && tones.slice(0, 2).every(tone => Object.values(frame.notes).some(note =>
      !note.nonChordToneRole && toMidi(note.pitch) >= toMidi(bass.pitch) && pitchClassEquals(note.pitch, tone)));
  });
}

function voicing(slice: AnalysisSlice) {
  return { fromTick: slice.tick, toTick: slice.endTick, activeNotes: slice.notes };
}

function isPlainRootPosition(
  chord: AnalysisChord | undefined, quality: "dominant7" | "major", pitch: SpelledPitchClass,
) {
  const identity = chord?.identity;
  return identity?.structure.kind === "tertian" && identity.structure.quality === quality &&
    identity.structure.extensions.length === 0 && identity.structure.alterations.length === 0 &&
    pitchClassEquals(identity.root, pitch) && pitchClassEquals(identity.bass, pitch);
}

export function isProvenLocalDeceptiveTarget(
  context: HarmonyRuleContext, { source, target, sourceBoundary: before, targetBoundary: after }: ConnectionView,
) {
  const phrase = context.phraseAt(before.tick);
  if (source.span.toTick !== target.span.fromTick || before.endTick !== after.tick ||
      before.key.id !== after.key.id || !phrase || after.tick >= phrase.toTick ||
      context.boundaryAt(after.tick)) return false;

  const sourceReading = context.harmony.primaryInterpretation(source.span);
  const arrivalReading = context.harmony.primaryInterpretation(target.span);
  if (sourceReading.status !== "resolved" || arrivalReading.status !== "resolved") return false;
  const interpretation = sourceReading.value;
  const declaredTarget = interpretation.appliedTarget;
  if (!declaredTarget || interpretation.designation?.kind !== "applied-dominant" ||
      interpretation.designation.primaryFunction !== "dominant" ||
      interpretation.degree !== 5 || interpretation.degreeAlteration !== 0 ||
      arrivalReading.value.appliedTarget) return false;

  const proof = proveLocalMinorDeceptiveDominant(voicing(before), voicing(after));
  if (!proof || !isPlainRootPosition(before.chord, "dominant7", proof.dominant) ||
      !isPlainRootPosition(after.chord, "major", proof.sixth)) return false;

  const homeKey = interpretation.localKey ?? before.key;
  const degree = diatonicMinorTarget(homeKey, proof.key.tonic);
  if (!degree || declaredTarget.degree !== degree) return false;
  const expected = functionalTargetForDegree(degree);
  const arrival = arrivalReading.value;
  const arrivalKey = arrival.localKey ?? after.key;
  return declaredTarget.primaryFunction === expected.primaryFunction &&
    declaredTarget.secondaryFunction === expected.secondaryFunction &&
    keyEquals(homeKey, arrivalKey) &&
    pitchClassEquals(scaleDegreePitchClass(arrivalKey, arrival.degree, arrival.degreeAlteration), proof.sixth);
}

const upperVoices = ["soprano", "alto", "tenor"] as const;

function plainRootPosition(slice: AnalysisSlice, root: ReturnType<typeof scaleDegreePitchClass>, quality: "major" | "minor" | "dominant7") {
  const identity = slice.chord?.identity;
  return identity?.structure.kind === "tertian" && identity.structure.quality === quality &&
    !identity.structure.extensions.length && !identity.structure.alterations.length &&
    pitchClassEquals(identity.root, root) && pitchClassEquals(identity.bass, root) &&
    !!slice.notes.bass && pitchClassEquals(slice.notes.bass.pitch, root);
}

/** Spasobin §20.6, example 20-276: a written, resolved root V7–VI
 * calls for doubling the tonic pitch in VI, even in minor. */
export function hasDeceptiveSixthThirdDoubling(context: HarmonyRuleContext, checked: AnalysisSlice) {
  const span = context.spanAt(checked.tick);
  const incoming = span && context.connections({ targetSpanId: span.span.id }).first();
  if (!incoming?.connection.contiguous) return false;
  const { source, target, sourceBoundary: before, targetBoundary: after } = incoming;
  if (before.key.id !== after.key.id || before.endTick !== after.tick || context.boundaryAt(after.tick)?.source === "manual" ||
      !before.completeSatb || !after.completeSatb ||
      VOICE_ORDER.some(voice => after.notes[voice]!.startTick !== after.tick ||
        after.notes[voice]!.id !== checked.notes[voice]?.id)) return false;

  const sourceReading = context.harmony.primaryInterpretation(source.span);
  const targetReading = context.harmony.primaryInterpretation(target.span);
  if (sourceReading.status !== "resolved" || targetReading.status !== "resolved") return false;
  const d = sourceReading.value, vi = targetReading.value;
  const key = d.localKey ?? before.key;
  if (d.appliedTarget || vi.appliedTarget || d.degree !== 5 || vi.degree !== 6 ||
      d.degreeAlteration !== 0 || vi.degreeAlteration !== 0 || !keyEquals(key, vi.localKey ?? after.key)) return false;

  const dominant = scaleDegreePitchClass(key, 5), sixth = scaleDegreePitchClass(key, 6);
  const quality = key.mode === "major" ? "minor" : "major";
  const dominantTones = chordToneSpellings(dominant, "dominant7");
  const sixthTones = chordToneSpellings(sixth, quality);
  const [, leading, fifth, seventh] = dominantTones;
  const [, tonic, sixthFifth] = sixthTones;
  const moves = (voice: typeof VOICE_ORDER[number]) => [before.notes[voice]!.pitch, after.notes[voice]!.pitch] as const;
  const isWellSpelledStack = (slice: AnalysisSlice, tones: readonly (typeof dominantTones)[number][]) =>
    hasExactWrittenStack({ fromTick: slice.tick, toTick: slice.endTick, activeNotes: slice.notes }, tones) &&
    VOICE_ORDER.every(voice => toMidi(slice.notes[voice]!.pitch) <= toMidi(slice.notes.soprano!.pitch));
  const hasFifth = upperVoices.some(voice => pitchClassEquals(before.notes[voice]!.pitch, fifth));
  if (!plainRootPosition(before, dominant, "dominant7") || !plainRootPosition(after, sixth, quality) ||
      !isWellSpelledStack(before, hasFifth ? dominantTones : [dominant, leading, seventh]) ||
      !isWellSpelledStack(after, sixthTones) ||
      upperVoices.filter(voice => pitchClassEquals(after.notes[voice]!.pitch, tonic)).length !== 2 ||
      !movesToWrittenTone(...moves("bass"), sixth, 1, key.mode === "major" ? 2 : 1)) return false;

  return upperVoices.every(voice => {
    const [from, to] = moves(voice);
    if (pitchClassEquals(from, leading)) return movesToWrittenTone(from, to, tonic, 1, 1);
    if (pitchClassEquals(from, fifth)) return movesToWrittenTone(from, to, tonic, -1, -2);
    if (pitchClassEquals(from, seventh)) {
      const { diatonicSteps, semitones } = writtenInterval(from, to);
      return pitchClassEquals(to, sixthFifth) && diatonicSteps === -1 && (semitones === -1 || semitones === -2);
    }
    return pitchClassEquals(from, dominant) &&
      (movesToWrittenTone(from, to, tonic, 3, 5) || movesToWrittenTone(from, to, tonic, -4, -7));
  });
}

function allowsWrittenSource(
  context: HarmonyRuleContext, slice: AnalysisSlice, writtenRoot: SpelledPitchClass,
) {
  const chord = slice.chord;
  if (!chord) return true;
  if (chord.semantics?.pedalContext || chord.semantics?.cadenceRole) return false;
  const readings = chord.semantics?.interpretations;
  if (!chord.locked && !context.analysis.project.chordTrack.locked &&
      readings?.length && readings.every(reading => reading.source === "inferred")) return true;

  if (!matchesWrittenChord(slice, writtenRoot, "diminished7")) return false;
  const explicit = context.harmony.primaryInterpretation(chord);
  return explicit.status === "unavailable" || (explicit.status === "resolved" &&
    pitchClassEquals(leadingToneForFunction(slice.key, explicit.value).tone, writtenRoot));
}

/** §22.3 and §28.6: the dominant can receive the doubled third of its own
 * local tonic from a fully resolved applied leading-tone seventh. */
export function receivesDoubledLocalTonicThird(
  context: HarmonyRuleContext, slice: AnalysisSlice, tone: SpelledPitchClass,
) {
  const chord = slice.chord;
  const bass = slice.notes.bass;
  if (!chord || !bass || chord.semantics?.pedalContext || chord.semantics?.cadenceRole) return false;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== 5 || reading.value.degreeAlteration !== 0 ||
      reading.value.appliedTarget) return false;
  const key = reading.value.localKey ?? slice.key;
  const tonic = scaleDegreePitchClass(key, 5);
  const tonicTones = chordToneSpellings(tonic, "major");
  if (!pitchClassEquals(tonicTones[1], tone) || !matchesWrittenChord(slice, tonic, "major")) return false;

  const arrival = context.sliceAt(bass.startTick);
  const before = context.sliceAt(bass.startTick - 1);
  if (arrival?.chord?.id !== chord.id || !before || before.endTick !== bass.startTick ||
      !keyEquals(before.key, slice.key) || crossesManualPhraseBoundary(context, before.tick, slice.tick)) return false;

  const lead = leadingTonePitchClass({ tonic, mode: "major" });
  const tones = chordToneSpellings(lead, "diminished7");
  return hasWrittenVoicing(before, tones) && allowsWrittenSource(context, before, lead) &&
    resolvesLeadingSeventhToDoubledThird(before, slice, tones, tonicTones);
}

// §§14.3, 15.3. In a dominant progression an ascending diminished fifth
// can introduce the seventh, which then descends in the same voice to the tonic third.
export function resolvesDominantSeventhEntry(
  context: HarmonyRuleContext,
  motion: MelodyTransition,
) {
  const { previous, current, writtenInterval, voiceId } = motion;
  if (!motion.contiguous || writtenInterval.diatonicSteps !== 4 || writtenInterval.semitones !== 6)
    return false;

  const tick = current.startTick;
  const release = tick + current.durationTicks;
  const departure = context.sliceAt(tick - 1);
  const entry = context.sliceAt(tick);
  const arrival = context.sliceAt(release);
  if (!departure || !entry || !arrival) return false;
  if (context.analysis.project.keyEvents.some(event => previous.startTick < event.tick && event.tick <= release) ||
      context.analysis.phraseBoundaries.some(boundary => !boundary.stale &&
        previous.startTick < boundary.tick && boundary.tick <= release)) return false;

  const key = departure.key;
  const dominant = scaleDegreePitchClass(key, 5);
  const [, third, , seventh] = chordToneSpellings(dominant, "dominant7");
  const [, tonicThird] = chordToneSpellings(key.tonic, key.mode);
  return pitchClassEquals(previous.pitch, third) && pitchClassEquals(current.pitch, seventh) &&
    matchesWrittenChord(departure, dominant, "major") &&
    context.slices({ overlapping: { fromTick: tick, toTick: release } })
      .all(slice => matchesWrittenChord(slice, dominant, "dominant7")) &&
    matchesWrittenChord(arrival, key.tonic, key.mode) &&
    resolvesInVoice(entry, arrival, voiceId, tonicThird, -1);
}

// §10.7, ex. 10-129; §18.4, ex. 18-247. The fourth degree descends to the
// third of V6; the same bass must then rise a semitone to the root of I.
export function isResolvedDominantSixthBass(context: HarmonyRuleContext, motion: MelodyTransition) {
  const { previous, current, writtenInterval } = motion;
  if (motion.voiceId !== "bass" || !motion.contiguous || !motion.sameKey ||
      writtenInterval.diatonicSteps !== -4 || writtenInterval.semitones !== -6) return false;

  const tick = current.startTick;
  const key = context.keyAt(tick);
  const end = tick + current.durationTicks;
  const next = context.sliceAt(end)?.notes.bass;
  if (!key || !next || next.startTick !== end ||
      !pitchClassEquals(previous.pitch, scaleDegreePitchClass(key, 4)) ||
      !pitchClassEquals(current.pitch, leadingTonePitchClass(key)) ||
      !pitchClassEquals(next.pitch, key.tonic) || toMidi(next.pitch) - toMidi(current.pitch) !== 1) return false;

  if (context.analysis.phraseBoundaries.some(b => !b.stale && previous.startTick < b.tick && b.tick <= end) ||
      context.analysis.project.keyEvents.some(e => previous.startTick < e.tick && e.tick <= end &&
        (!keyEquals(e, key)))) return false;

  const bassOnly = context.analysis.project.satbTracks.every(track => track.voice === "bass" || !track.notes.length);
  if (bassOnly && !context.slices({ overlapping: { fromTick: tick - 1, toTick: end + 1 } }).all(slice => {
    const reading = slice.chord && context.harmony.primaryInterpretation(slice.chord);
    return reading?.status === "resolved" &&
      (reading.value.source === "manual" || reading.value.source === "confirmed");
  })) return false;

  const predominant = supportsBassTriad(context, key, previous, tick, 4, key.mode, bassOnly, tick - 1) ||
    (key.mode === "major" && supportsBassTriad(context, key, previous, tick, 2, "minor", bassOnly, tick - 1));
  return predominant && supportsBassTriad(context, key, current, end, 5, "major", bassOnly) &&
    supportsBassTriad(context, key, next, end + 1, 1, key.mode, bassOnly);
}
