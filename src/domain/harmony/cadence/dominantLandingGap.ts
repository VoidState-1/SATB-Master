import { chordIdentityInversion, chordIdentityToneSpellings } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, toMidi, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { compareMetricStrength, type MetricPosition } from "../../rhythm/metric";
import type { AnalysisSlice } from "../analysis";
import { soundsCompleteWrittenChord } from "../writtenVoicing";
import { hasCompleteWrittenTertianVoicing } from "../writtenTertian";
import type { CadenceEvidence, CadenceSpanFacts } from "./types";

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
