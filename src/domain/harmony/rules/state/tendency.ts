import {
  chordIdentityToneSpellings,
  chordIdentityToneSpellingForDegree,
  type ChordQuality,
} from "../../../chordModel";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisNote, AnalysisSlice } from "../../analysis";
import { readWrittenDominantSeventh, readWrittenDominantSeventhHandoff } from "../../facts/dominantMotion";
import { writtenPassingSeventhAscends, writtenSeventhAtAuthenticDeparture } from "./writtenSeventh";
import { crossesManualPhraseBoundary, hasExactPitch, noteEvidence } from "../helpers/core";
import { readDoubleDominantResolution } from "../helpers/chordVoicing";
import { resolvesDominantSixthSubstitution } from "../groups/support/doubleDominant";
import {
  keyEquals,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  toMidi,
  writtenInterval,
  type KeyLike,
  type SpelledPitchClass,
} from "../../../pitch";
import type { JsonValue, RuleStepContext } from "../../runtime";
import type {
  ObligationEnvironment,
  ObligationSource,
  SubjectRefs,
} from "./obligation";
import type { SpanView } from "../context/views";
import { dominantNinthTone, writtenDominantNinthResolves } from "../../facts/dominantMotion";
import { preparedSeventhEntries } from "./seventhState";
import {
  openedSourceChord,
  openedSourceNote,
  sameSeventhContext,
  supportsTendencyResolutionRules,
  currentSpanRefs,
} from "./tendencyContext";
import { hasMajorDeceptiveLeadingToneMotion, leadingNeighborFrame, ornamentsSameLeadingHarmony } from "./leadingToneTargets";
import { supportsWrittenInnerLeadingToneDescent } from "./leadingToneTransfers";

export { supportsTendencyResolutionRules } from "./tendencyContext";

export type VoiceObligationPayload = {
  readonly [key: string]: JsonValue;
  readonly voiceId: VoiceId;
};

export type LeadingTonePayload = VoiceObligationPayload & {
  readonly leadingMidi: number;
  readonly leadingStep: SpelledPitchClass["step"];
  readonly leadingAlter: SpelledPitchClass["alter"];
  readonly targetStep: SpelledPitchClass["step"];
  readonly targetAlter: SpelledPitchClass["alter"];
  readonly targetMode: "major" | "minor";
  readonly sourceKeyStep: SpelledPitchClass["step"];
  readonly sourceKeyAlter: SpelledPitchClass["alter"];
  readonly sourceKeyMode: "major" | "minor";
};

export type SeventhPayload = VoiceObligationPayload & {
  readonly seventhMidi: number;
  readonly preparedAtEntry?: true;
};

export type DominantNinthPayload = VoiceObligationPayload & {
  readonly ninthMidi: number;
};

export type AlteredTonePayload = VoiceObligationPayload & {
  readonly degree: 5 | 9 | 11 | 13;
  readonly tendency: "up" | "down";
  readonly alteredMidi: number;
};

export const chordSeventhSource: ObligationSource<SeventhPayload> = {
  id: "source.chord-seventh-attacks",
  requires: ["written-pitches", "chords-or-complete-satb"],
  collect({ context, moment }) {
    const { slice } = context;
    const chord = slice.chord;
    // Ambiguous functions over the same written V7 still agree on its seventh.
    // An applied or ornamental hypothesis alone cannot supply the missing parts.
    const labelled = chord && supportsTendencyResolutionRules(context, chord);
    if (chord && !labelled && (chord.semantics?.pedalContext || chord.identity.structure.kind !== "tertian" ||
        chord.identity.structure.quality !== "dominant7")) return [];
    const seventh = labelled ? chordIdentityToneSpellingForDegree(chord.identity, 7) : writtenSeventhAtAuthenticDeparture(context);
    if (!seventh) return [];
    const prepared = preparedSeventhEntries(context);
    const voices = prepared.length || !chord ? VOICE_ORDER : moment.attackedVoiceIds;
    return voices.flatMap((voiceId) => {
      const note = slice.notes[voiceId];
      if (!note) return [];
      const attacked = moment.attackedVoiceIds.includes(voiceId);
      if (!pitchClassEquals(note.pitch, seventh) || (chord && !attacked && !prepared.includes(voiceId))) return [];
      return [
        {
          partitionKey: `voice:${voiceId}`,
          payload: {
            voiceId,
            seventhMidi: toMidi(note.pitch),
            ...(!attacked && { preparedAtEntry: true as const }),
          },
          subjectRefs: {
            voiceIds: [voiceId],
            noteIds: [note.id],
            ...(chord && { chordIds: [chord.id] }),
            ...currentSpanRefs(context),
          },
        },
      ];
    });
  },
};

export const dominantNinthSource: ObligationSource<DominantNinthPayload> = {
  id: "source.dominant-ninth-attacks",
  requires: ["written-pitches", "chords"],
  collect({ context, moment }) {
    const { slice, previous, transitionFromPrevious } = context;
    const chord = slice.chord;
    const ninth = chord && dominantNinthTone(chord.identity);
    if (!chord || !ninth || !supportsTendencyResolutionRules(context, chord)) return [];
    const previousChord = previous?.chord;
    const previousNinth = previousChord && dominantNinthTone(previousChord.identity);
    const sameNinth = previousChord && previousNinth && pitchClassEquals(previousNinth, ninth) &&
      pitchClassEquals(previousChord.identity.root, chord.identity.root);
    const entered = transitionFromPrevious?.contiguous && transitionFromPrevious.sameKey &&
      !sameNinth;
    const voices = entered ? VOICE_ORDER : moment.attackedVoiceIds;
    return voices.flatMap((voiceId) => {
      const note = slice.notes[voiceId];
      if (!note || !pitchClassEquals(note.pitch, ninth) ||
          (!moment.attackedVoiceIds.includes(voiceId) && previous?.notes[voiceId]?.id !== note.id)) return [];
      return [
        {
          partitionKey: `voice:${voiceId}`,
          payload: { voiceId, ninthMidi: toMidi(note.pitch) },
          subjectRefs: {
            voiceIds: [voiceId],
            noteIds: [note.id],
            chordIds: [chord.id],
            ...currentSpanRefs(context),
          },
        },
      ];
    });
  },
};

export const alteredToneSource: ObligationSource<AlteredTonePayload> = {
  id: "source.directional-altered-tone-attacks",
  requires: ["written-pitches", "chords"],
  collect({ context, moment }) {
    const chord = context.slice.chord;
    if (
      !chord ||
      !supportsTendencyResolutionRules(context, chord) ||
      chord.identity.structure.kind !== "tertian"
    )
      return [];
    return chord.identity.structure.alterations.flatMap((alteration) => {
      if (!alteration.tendency) return [];
      const tendency = alteration.tendency;
      const tone = chordIdentityToneSpellingForDegree(
        chord.identity,
        alteration.degree,
      );
      if (!tone) return [];
      return moment.attackedVoiceIds.flatMap((voiceId) => {
        const note = context.slice.notes[voiceId];
        if (!note || !pitchClassEquals(note.pitch, tone)) return [];
        return [
          {
            partitionKey: `voice:${voiceId}|degree:${alteration.degree}`,
            payload: {
              voiceId,
              degree: alteration.degree,
              tendency,
              alteredMidi: toMidi(note.pitch),
            },
            subjectRefs: {
              voiceIds: [voiceId],
              noteIds: [note.id],
              chordIds: [chord.id],
              ...currentSpanRefs(context),
            },
          },
        ];
      });
    });
  },
};

function currentNote<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  return environment.context.slice.notes[environment.obligation.payload.voiceId];
}

export function transitionEvidence<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
) {
  const source = openedSourceNote(environment);
  const current = currentNote(environment);
  return {
    source,
    current,
    evidence:
      source && current
        ? [noteEvidence(source, "倾向音"), noteEvidence(current, "当前音")]
        : [],
    subjectRefs: {
      voiceIds: [environment.obligation.payload.voiceId],
      ...(current ? { noteIds: [current.id] } : {}),
      ...(environment.context.slice.chord
        ? { chordIds: [environment.context.slice.chord.id] }
        : {}),
    } satisfies SubjectRefs,
  };
}

export function leadingToneResolves(
  environment: ObligationEnvironment<LeadingTonePayload>,
) {
  const current = currentNote(environment);
  const payload = environment.obligation.payload;
  return Boolean(
    current &&
      current.pitch.step === payload.targetStep &&
      current.pitch.alter === payload.targetAlter &&
      toMidi(current.pitch) - payload.leadingMidi === 1,
  );
}

function completeRootPositionChord(context: RuleStepContext, slice: AnalysisSlice) {
  const chord = slice.chord;
  if (!chord || !slice.completeSatb || !pitchClassEquals(chord.identity.bass, chord.identity.root)) return false;
  const members = context.rules.harmony.chordMembersAt(slice);
  return (
    members.some(member => member.voiceId === "bass" && member.chordToneIndex === 0) &&
    members.every(member => member.isWrittenChordTone && !member.note.nonChordToneRole) &&
    chordIdentityToneSpellings(chord.identity).every((_, index) =>
      members.some(member => member.chordToneIndex === index),
    )
  );
}

function obligationFollowsWrittenLeadingTone(
  environment: ObligationEnvironment<LeadingTonePayload>,
  source: AnalysisSlice,
  leading: AnalysisNote,
  landing: AnalysisNote,
  destination: SpelledPitchClass,
  resolutionKey: KeyLike = environment.context.slice.key,
) {
  const { context, obligation } = environment;
  const { payload, openedAt, openedBy } = obligation;
  const target = context.slice;
  const opened = context.rules.sliceAt(openedAt.tick)?.notes[payload.voiceId];
  if (!opened || !openedBy.noteIds?.includes(opened.id) ||
      !spelledPitchEquals(opened.pitch, leading.pitch) ||
      !pitchClassEquals(leading.pitch, { step: payload.leadingStep, alter: payload.leadingAlter }) ||
      toMidi(leading.pitch) !== payload.leadingMidi || landing.startTick !== target.tick ||
      !keyEquals(source.key, { tonic: { step: payload.sourceKeyStep, alter: payload.sourceKeyAlter }, mode: payload.sourceKeyMode }) ||
      !keyEquals(resolutionKey, { tonic: { step: payload.targetStep, alter: payload.targetAlter }, mode: payload.targetMode }) ||
      !pitchClassEquals(landing.pitch, destination) ||
      crossesManualPhraseBoundary(context.rules, openedAt.tick, target.tick)) return false;

  // A same-register reattack retains the existing obligation. Do not let a
  // different octave, another note, or a rest inherit that obligation's proof.
  for (let tick = openedAt.tick; tick < target.tick;) {
    const slice = context.rules.sliceAt(tick);
    const note = slice?.notes[payload.voiceId];
    if (!slice || !note || slice.key.id !== source.key.id) return false;
    if (!spelledPitchEquals(note.pitch, opened.pitch)) {
      const frame = leadingNeighborFrame(context.rules, payload.voiceId, note);
      if (!frame || !spelledPitchEquals(frame.preparation.pitch, opened.pitch) ||
          !ornamentsSameLeadingHarmony(context.rules, frame)) return false;
    } else if (note.nonChordToneRole) return false;
    tick = slice.endTick;
  }
  return true;
}

function dominantSeventhAt(context: RuleStepContext, slice: AnalysisSlice) {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass || !supportsTendencyResolutionRules(context, slice.chord) ||
      Object.values(slice.notes).some(note => toMidi(note.pitch) < toMidi(bass.pitch))) return;
  const written = readWrittenDominantSeventh(slice.notes);
  if (!written) return;
  const identity = slice.chord?.identity;
  const structure = identity?.structure;
  if (identity && (structure?.kind !== "tertian" || structure.quality !== "dominant7" ||
      structure.alterations.length || structure.extensions.length ||
      !pitchClassEquals(identity.root, written.root) || !pitchClassEquals(identity.bass, bass.pitch))) return;
  return written;
}

/** Two successive dominant sevenths can exchange their tendency-tone roles
 * as both voices descend by semitone (Huang, keyboard exercise 1, p. 552). */
export function leadingToneBecomesNextDominantSeventh(environment: ObligationEnvironment<LeadingTonePayload>) {
  const { context, obligation: { payload } } = environment;
  const source = context.previous;
  const target = context.slice;
  const leading = source?.notes[payload.voiceId];
  const landing = target.notes[payload.voiceId];
  if (!source || !leading || !landing || !context.transitionFromPrevious?.contiguous ||
      source.key.id !== target.key.id) return false;

  const from = dominantSeventhAt(context, source);
  const to = dominantSeventhAt(context, target);
  if (!from || !to) return false;
  const exchange = readWrittenDominantSeventhHandoff(source, target, payload.voiceId, from.root);
  if (!exchange || !pitchClassEquals(exchange.nextRoot, to.root)) return false;
  const nextTonic = { tonic: to.root, mode: payload.targetMode };
  return obligationFollowsWrittenLeadingTone(environment, source, leading, landing, to.seventh, nextTonic);
}

export function innerLeadingToneDescendsToFifth(
  environment: ObligationEnvironment<LeadingTonePayload>,
) {
  const { context, obligation: { payload } } = environment;
  if (payload.voiceId !== "alto" && payload.voiceId !== "tenor") return false;
  const source = context.previous;
  const target = context.slice;
  const from = source?.chord;
  const to = target.chord;
  const leading = source?.notes[payload.voiceId];
  const landing = target.notes[payload.voiceId];
  if (
    !source || !leading || !landing ||
    !context.transitionFromPrevious?.contiguous ||
    !supportsTendencyResolutionRules(context, from) || !supportsTendencyResolutionRules(context, to)
  ) return false;

  const interval = writtenInterval(leading.pitch, landing.pitch);
  if (interval.diatonicSteps !== -2 || interval.semitones !== -4) return false;

  const tonic = { step: payload.targetStep, alter: payload.targetAlter };
  const resolutionKey = { tonic, mode: payload.targetMode };
  const dominant = scaleDegreePitchClass(resolutionKey, 5);
  if (supportsWrittenInnerLeadingToneDescent(source, target, dominant, tonic) &&
      obligationFollowsWrittenLeadingTone(environment, source, leading, landing, dominant, resolutionKey)) return true;

  if (!from || !to) return false;
  if (obligationFollowsWrittenLeadingTone(environment, source, leading, landing, scaleDegreePitchClass(target.key, 5)) &&
      resolvesDominantSixthSubstitution(source, context.rules, true)) return true;

  if (context.rules.phraseAt(source.tick)?.id !== context.rules.phraseAt(target.tick)?.id) return false;
  const fromInterpretation = context.rules.harmony.primaryInterpretation(from);
  const toInterpretation = context.rules.harmony.primaryInterpretation(to);
  const fromKey = fromInterpretation.status === "resolved"
    ? fromInterpretation.value.localKey ?? source.key : source.key;
  const toKey = toInterpretation.status === "resolved"
    ? toInterpretation.value.localKey ?? target.key : target.key;
  const fromStructure = from.identity.structure;
  const toStructure = to.identity.structure;
  return (
    pitchClassEquals(fromKey.tonic, tonic) && keyEquals(fromKey, toKey) &&
    pitchClassEquals(leading.pitch, { step: payload.leadingStep, alter: payload.leadingAlter }) &&
    pitchClassEquals(from.identity.root, scaleDegreePitchClass(fromKey, 5)) &&
    pitchClassEquals(to.identity.root, tonic) &&
    fromStructure.kind === "tertian" && toStructure.kind === "tertian" &&
    (fromStructure.quality === "major" || fromStructure.quality === "dominant7") &&
    (toStructure.quality === "major" || toStructure.quality === "minor") &&
    fromStructure.extensions.length === 0 && fromStructure.alterations.length === 0 &&
    toStructure.extensions.length === 0 && toStructure.alterations.length === 0 &&
    completeRootPositionChord(context, source) && completeRootPositionChord(context, target) &&
    pitchClassEquals(landing.pitch, scaleDegreePitchClass(toKey, 5))
  );
}

export function leadingToneDescendsInMajorDeceptiveMotion(environment: ObligationEnvironment<LeadingTonePayload>) {
  const { context, obligation: { payload } } = environment;
  const { previous, slice } = context;
  const leading = previous?.notes[payload.voiceId];
  const landing = slice.notes[payload.voiceId];
  return Boolean(previous && leading && landing && hasMajorDeceptiveLeadingToneMotion(context, payload.voiceId) &&
    obligationFollowsWrittenLeadingTone(environment, previous, leading, landing, scaleDegreePitchClass(slice.key, 6)));
}

function resolvesDownward<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
  sourceMidi: number,
) {
  const current = currentNote(environment);
  const targetChord = environment.context.slice.chord;
  if (!current || !targetChord) return false;
  const semitones = toMidi(current.pitch) - sourceMidi;
  return (
    (semitones === -1 || semitones === -2) &&
    hasExactPitch(current, chordIdentityToneSpellings(targetChord.identity))
  );
}

function passingChordKey(context: RuleStepContext, slice: AnalysisSlice) {
  if (!slice.chord || !supportsTendencyResolutionRules(context, slice.chord)) return;
  const reading = context.rules.harmony.primaryInterpretation(slice.chord);
  if (reading.status !== "resolved") return slice.key;
  if (!reading.value.appliedTarget) return reading.value.localKey ?? slice.key;
}

function hasPassingVoicing(
  context: RuleStepContext,
  slice: AnalysisSlice,
  quality: ChordQuality,
  root: SpelledPitchClass,
  bass: SpelledPitchClass,
) {
  const identity = slice.chord?.identity;
  const bassNote = slice.notes.bass;
  if (!slice.completeSatb || !identity || !bassNote || identity.structure.kind !== "tertian" ||
      identity.structure.quality !== quality || identity.structure.extensions.length ||
      identity.structure.alterations.length || !pitchClassEquals(identity.root, root) ||
      !pitchClassEquals(identity.bass, bass) || !pitchClassEquals(bassNote.pitch, bass)) return false;
  const members = context.rules.harmony.chordMembersAt(slice);
  return members.every(member => member.isWrittenChordTone && !member.note.nonChordToneRole) &&
    chordIdentityToneSpellings(identity).every((_, index) => members.some(member => member.chordToneIndex === index));
}

function upwardStep(from: AnalysisNote | undefined, to: AnalysisNote | undefined) {
  if (!from || !to) return false;
  const motion = writtenInterval(from.pitch, to.pitch);
  return motion.diatonicSteps === 1 && (motion.semitones === 1 || motion.semitones === 2);
}

function carriesPassingBass(context: RuleStepContext, span: SpanView, next: AnalysisSlice) {
  const structural = span.firstSlice.notes.bass;
  const last = span.lastSlice.notes.bass;
  const landing = next.notes.bass;
  if (!structural || !landing || !upwardStep(structural, landing)) return false;
  const metric = context.rules.metric;
  const rearticulatedAnticipation = last && (!last.nonChordToneRole || last.nonChordToneRole === "anticipation") &&
    landing.startTick === next.tick && last.startTick > span.firstSlice.tick &&
    last.startTick + last.durationTicks === next.tick &&
    last.durationTicks <= last.startTick - span.firstSlice.tick && last.durationTicks <= landing.durationTicks &&
    spelledPitchEquals(last.pitch, landing.pitch) &&
    metric.compare(metric.positionAt(last.startTick), metric.positionAt(next.tick)) === "weaker";
  return span.slices.every(({ chord, notes: { bass } }) =>
    chord && bass && pitchClassEquals(chord.identity.bass, structural.pitch) &&
    (bass.id === last?.id && rearticulatedAnticipation ||
      !bass.nonChordToneRole && spelledPitchEquals(bass.pitch, structural.pitch)),
  );
}

/** Spasobin §15.4, ex. 15-210/211; the minor realization is marked in 15-214. */
function passingDominantSeventhAscends(environment: ObligationEnvironment<SeventhPayload>) {
  const { context, obligation } = environment;
  const { voiceId, seventhMidi } = obligation.payload;
  const { previous, slice: target, rules, transitionFromPrevious } = context;
  const departure = previous?.notes[voiceId];
  const arrival = target.notes[voiceId];
  if (voiceId === "bass" || !previous || !departure || !arrival || departure.nonChordToneRole ||
      toMidi(departure.pitch) !== seventhMidi || arrival.startTick !== target.tick ||
      !upwardStep(departure, arrival) || !context.isSpanStart ||
      !transitionFromPrevious?.contiguous || !transitionFromPrevious.sameKey) return false;

  const dominant = rules.spanAt(previous.tick);
  if (!dominant || !obligation.openedBy.spanIds?.includes(dominant.span.id)) return false;
  const tonic = rules.spanNeighborhood(dominant).previous;
  if (!tonic || tonic.span.toTick !== dominant.span.fromTick ||
      tonic.firstSlice.key.id !== target.key.id ||
      rules.phraseAt(tonic.firstSlice.tick)?.id !== rules.phraseAt(target.tick)?.id) return false;

  const key = passingChordKey(context, target);
  if (!key || ![tonic.firstSlice, dominant.firstSlice].every(slice => {
    const earlierKey = passingChordKey(context, slice);
    return !!earlierKey && keyEquals(earlierKey, key);
  })) return false;
  const second = scaleDegreePitchClass(key, 2);
  const third = scaleDegreePitchClass(key, 3);
  const fifth = scaleDegreePitchClass(key, 5);
  return pitchClassEquals(departure.pitch, scaleDegreePitchClass(key, 4)) &&
    pitchClassEquals(arrival.pitch, fifth) &&
    hasPassingVoicing(context, tonic.firstSlice, key.mode, key.tonic, key.tonic) &&
    hasPassingVoicing(context, dominant.firstSlice, "dominant7", fifth, second) &&
    hasPassingVoicing(context, target, key.mode, key.tonic, third) &&
    rules.harmony.chordMembersAt(target).filter(member => member.chordToneIndex === 1).length === 1 &&
    carriesPassingBass(context, tonic, dominant.firstSlice) &&
    carriesPassingBass(context, dominant, target);
}

function respeltDoubleDominantSeventhAscends(environment: ObligationEnvironment<SeventhPayload>) {
  const { context: { previous: source, slice: target, rules }, obligation: { payload } } = environment;
  if (!source?.chord) return false;
  const structure = source.chord.identity.structure;
  const departure = source.notes[payload.voiceId];
  if (structure.kind !== "tertian" || structure.quality !== "diminished7" ||
      structure.extensions.length || structure.alterations.length ||
      !departure || toMidi(departure.pitch) !== payload.seventhMidi) return false;

  const resolution = readDoubleDominantResolution(rules, source, target);
  // A previous harmony can still own an obligation on this same pitch and voice.
  return resolution?.voiceId === payload.voiceId && sameSeventhContext(environment, source.chord);
}

export function chordSeventhResolves(
  environment: ObligationEnvironment<SeventhPayload>,
) {
  return resolvesDownward(environment, environment.obligation.payload.seventhMidi) ||
    passingDominantSeventhAscends(environment) ||
    (environment.context.previous?.tick === environment.obligation.openedAt.tick &&
      writtenPassingSeventhAscends(environment.context, environment.obligation.payload.voiceId)) ||
    respeltDoubleDominantSeventhAscends(environment);
}

export function dominantNinthResolves(
  environment: ObligationEnvironment<DominantNinthPayload>,
) {
  const source = openedSourceChord(environment), from = openedSourceNote(environment);
  const target = environment.context.slice.chord, to = currentNote(environment);
  return !!source && !!target && !!from && !!to &&
    writtenDominantNinthResolves(source.identity, target.identity, from.pitch, to.pitch);
}

export function alteredToneResolves(
  environment: ObligationEnvironment<AlteredTonePayload>,
) {
  const current = currentNote(environment);
  const targetChord = environment.context.slice.chord;
  if (!current || !targetChord) return false;
  const payload = environment.obligation.payload;
  const expected = payload.tendency === "up" ? 1 : -1;
  return (
    toMidi(current.pitch) - payload.alteredMidi === expected &&
    hasExactPitch(current, chordIdentityToneSpellings(targetChord.identity))
  );
}
