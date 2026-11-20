import { chordIdentityEquals, chordToneSpellings, type ChordQuality } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import {
  continuesWrittenDominantSeventh,
  contextualMinorDominantTonic,
  contextualMinorSixthResolvesToFifth,
  dominantSixthInnerVoices as innerVoices,
  dominantSixthLowerVoices as lowerVoices,
  leadingToneDescendsToTonicFifth,
  movesToWrittenTone,
  resolvesDominantInnerVoice,
} from "../../dominantSixthMotion";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";

type SixthRuleContext = Pick<HarmonyRuleContext, "analysis" | "sliceAt">;

function hasPlainRootPosition(slice: AnalysisSlice, degree: 1 | 5, quality: ChordQuality, allowWrittenSixth = false) {
  const { chord, key } = slice;
  const bass = slice.notes.bass;
  if (!chord || !bass || !slice.completeSatb || Object.values(slice.notes).some(note => note.nonChordToneRole)) return false;

  const { root, structure } = chord.identity;
  if (structure.kind !== "tertian" || structure.quality !== quality ||
      (structure.extensions.length && !(allowWrittenSixth && structure.extensions.length === 1 && structure.extensions[0] === 6)) ||
      structure.alterations.length ||
      !pitchClassEquals(root, scaleDegreePitchClass(key, degree)) ||
      !pitchClassEquals(root, chord.identity.bass) || !pitchClassEquals(root, bass.pitch)) return false;

  const { semantics } = chord;
  if (!semantics) return true;
  if (semantics.pedalContext || semantics.mixture || semantics.cadenceRole ||
      semantics.interpretations.length !== 1 || semantics.alternatives?.length) return false;
  const [interpretation] = semantics.interpretations;
  const { localKey, designation } = interpretation;
  return (interpretation.confidence === "certain" || interpretation.confidence === "probable") &&
    interpretation.degree === degree && interpretation.degreeAlteration === 0 && !interpretation.appliedTarget &&
    (!localKey || keyEquals(localKey, key)) &&
    (!designation || (designation.kind === "primary" &&
      designation.primaryFunction === (degree === 5 ? "dominant" : "tonic")));
}

export function resolvesContextualMinorDominantSixth(source: AnalysisSlice, context: SixthRuleContext) {
  const soprano = source.notes.soprano;
  if (!soprano) return false;
  const onset = context.sliceAt(soprano.startTick);
  const chord = onset?.chord;
  if (!onset || !chord) return false;
  const fifth = context.sliceAt(soprano.startTick + soprano.durationTicks);
  const fifthNote = fifth?.notes.soprano;
  if (!fifth?.chord || !fifthNote || !chordIdentityEquals(chord.identity, fifth.chord.identity)) return false;
  const landing = context.sliceAt(fifthNote.startTick + fifthNote.durationTicks);
  if (!landing?.chord || onset.key.id !== fifth.key.id || fifth.key.id !== landing.key.id ||
      crossesManualPhraseBoundary(context, onset.tick, landing.tick)) return false;

  const opening = contextualMinorDominantTonic(chord, onset.key);
  if (!opening || !contextualMinorSixthResolvesToFifth(onset, fifth, landing, opening.tonic, opening.applied)) return false;
  const arrivalRoot = opening.applied ? scaleDegreePitchClass({ tonic: opening.tonic, mode: "minor" }, 6) : opening.tonic;
  const { root, bass, structure } = landing.chord.identity;
  if (!pitchClassEquals(root, arrivalRoot) || !pitchClassEquals(bass, arrivalRoot) ||
      structure.kind !== "tertian" || structure.quality !== (opening.applied ? "major" : "minor") ||
      structure.extensions.length || structure.alterations.length) return false;

  for (let tick = onset.tick; tick < landing.tick;) {
    const slice = context.sliceAt(tick);
    const expected = tick < fifth.tick ? onset : fifth;
    if (!slice?.chord || slice.tick !== tick || slice.key.id !== onset.key.id ||
        !chordIdentityEquals(chord.identity, slice.chord.identity) ||
        slice.notes.soprano?.id !== expected.notes.soprano?.id ||
        !lowerVoices.every(voice => slice.notes[voice]?.id === onset.notes[voice]?.id)) return false;
    const reading = contextualMinorDominantTonic(slice.chord, slice.key);
    if (!reading || reading.applied !== opening.applied || !pitchClassEquals(reading.tonic, opening.tonic)) return false;
    tick = slice.endTick;
  }
  return true;
}

export function resolvesDominantSixthSubstitution(
  source: AnalysisSlice,
  context: SixthRuleContext,
  allowWrittenSixth = false,
) {
  if (resolvesContextualMinorDominantSixth(source, context)) return true;
  const { notes, key } = source;
  const { bass, soprano } = notes;
  if (!bass || !soprano) return false;
  const sixth = scaleDegreePitchClass(key, 3);
  if (!pitchClassEquals(soprano.pitch, sixth)) return false;
  const attackTick = soprano.startTick;
  const resolutionTick = attackTick + soprano.durationTicks;
  const following = context.sliceAt(resolutionTick);
  const arrival = following?.notes.soprano?.pitch;
  if (!following || following.tick !== resolutionTick || following.key.id !== key.id || !arrival ||
      crossesManualPhraseBoundary(context, attackTick, resolutionTick)) return false;

  // A chord-label split can subdivide the same note. Read the actual attack and
  // its whole sounding voicing before treating any of those slices as a sixth.
  for (let tick = attackTick; tick < resolutionTick;) {
    const slice = context.sliceAt(tick);
    if (!slice || slice.tick !== tick || slice.key.id !== key.id ||
        !hasPlainRootPosition(slice, 5, "dominant7", allowWrittenSixth) ||
        slice.notes.soprano?.id !== soprano.id ||
        !lowerVoices.every(voice => slice.notes[voice]?.id === notes[voice]?.id)) return false;
    tick = slice.endTick;
  }
  const newBass = bass.startTick === attackTick;
  const [, leadingTone, fifth, seventh] = chordToneSpellings(bass.pitch, "dominant7");
  const alto = notes.alto?.pitch;
  const tenor = notes.tenor?.pitch;
  if (!alto || !tenor ||
      !((pitchClassEquals(alto, leadingTone) && pitchClassEquals(tenor, seventh)) ||
        (pitchClassEquals(alto, seventh) && pitchClassEquals(tenor, leadingTone)))) return false;

  if (hasPlainRootPosition(following, 5, "dominant7")) {
    return newBass && movesToWrittenTone(soprano.pitch, arrival, fifth, -1) &&
      lowerVoices.every(voice => {
        const before = notes[voice];
        const after = following.notes[voice];
        return before && after && spelledPitchEquals(before.pitch, after.pitch);
      });
  }

  if (!hasPlainRootPosition(following, 1, key.mode) ||
      !movesToWrittenTone(soprano.pitch, arrival, key.tonic, -2)) return false;

  const tonicFifth = scaleDegreePitchClass(key, 5);
  const descendingLeading = innerVoices.some(voice => leadingToneDescendsToTonicFifth(
    notes[voice]?.pitch, following.notes[voice]?.pitch, leadingTone, tonicFifth,
  ));
  if (!newBass) {
    const previous = context.sliceAt(attackTick - 1);
    if (!descendingLeading || !previous || previous.endTick !== attackTick || previous.key.id !== key.id ||
        !hasPlainRootPosition(previous, 5, "dominant7") ||
        !continuesWrittenDominantSeventh(previous.notes, notes, bass.pitch)) return false;
    const previousAttack = Math.max(previous.key.tick, ...Object.values(previous.notes).map(note => note.startTick));
    if (crossesManualPhraseBoundary(context, previousAttack, attackTick)) return false;
  }

  return innerVoices.every(voice => resolvesDominantInnerVoice(
    notes[voice]?.pitch, following.notes[voice]?.pitch, leadingTone, seventh, key.tonic, sixth,
    tonicFifth,
  ));
}
