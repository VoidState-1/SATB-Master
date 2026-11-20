import { chordToneSpellings } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import { hasExactWrittenStack } from "../../localDeceptiveDominant";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { movesToWrittenTone } from "../../dominantSixthMotion";

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
