import {
  chordIdentityToneSpellings, chordToneSpellings, harmonySemanticsConfidence, primaryHarmonyInterpretation,
  type HarmonySemantics, type KeyReference,
} from "../../chordModel";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, pitchClassValue, scaleDegreePitchClass, toMidi } from "../../pitch";
import type { AnalysisChord, AnalysisSlice, ProjectSnapshot } from "../analysis";
import { VOICE_ORDER } from "../../project/voice";
import { hasWrittenVoicing, resolvesInVoice } from "./tendencyResolution";

/** A destination key is a resolved reading, not the target of an applied chord.
 * Keep the written key independently so equal inferred centers cannot bridge
 * a new key declaration or a manual phrase boundary. */
export function resolvedTonalInterpretation(semantics: HarmonySemantics | undefined) {
  const confidence = semantics ? harmonySemanticsConfidence(semantics) : "unknown";
  const interpretation = semantics && (confidence === "certain" || confidence === "probable")
    ? primaryHarmonyInterpretation(semantics) : undefined;
  return { confidence, interpretation };
}

export function tonalReading(semantics: HarmonySemantics | undefined, writtenKey: KeyReference) {
  const { confidence, interpretation } = resolvedTonalInterpretation(semantics);
  const key = interpretation?.localKey ?? writtenKey;
  return { key, confidence, interpretation, local: !keyEquals(key, writtenKey) };
}

export function crossesTonalBoundary(
  project: Pick<ProjectSnapshot, "keyEvents" | "structure">, from: number, through: number,
) {
  const before = project.keyEvents.filter(event => event.tick <= from).at(-1);
  return project.keyEvents.some(event => from < event.tick && event.tick <= through && (!before || !keyEquals(before, event))) ||
    project.structure.phraseBoundaries.some(boundary =>
      boundary.source === "manual" && from < boundary.tick && boundary.tick <= through);
}

/** A tonic pedal articulates a second local V?I when all three upper
 * members of V sound and its leading tone resolves in the same voice. */
export function resolvesDominantOverTonicPedal(
  overPedal: Pick<AnalysisSlice, "notes" | "completeSatb">,
  arrival: Pick<AnalysisSlice, "notes" | "completeSatb">, key: KeyReference,
) {
  if (!overPedal.completeSatb || !arrival.completeSatb || !overPedal.notes.bass || !arrival.notes.bass ||
      ![overPedal, arrival].every(frame => pitchClassEquals(frame.notes.bass!.pitch, key.tonic))) return false;
  const dominant = chordToneSpellings(scaleDegreePitchClass(key, 5), "major");
  const upper = VOICE_ORDER.filter(voice => voice !== "bass");
  return dominant.every(tone => upper.some(voice => pitchClassEquals(overPedal.notes[voice]!.pitch, tone))) &&
    upper.some(voice => {
      const before = overPedal.notes[voice]!, after = arrival.notes[voice]!;
      return pitchClassEquals(before.pitch, dominant[1]) && pitchClassEquals(after.pitch, key.tonic) &&
        toMidi(after.pitch) - toMidi(before.pitch) === 1;
    });
}

export function isDiminishedRotation(
  before: AnalysisChord | undefined, after: AnalysisChord | undefined,
  source: ReturnType<typeof tonalReading>, destination: ReturnType<typeof tonalReading>,
) {
  if (!before || !after || !source.interpretation || !destination.interpretation ||
      keyEquals(source.key, destination.key) || destination.interpretation.degree !== 7 ||
      destination.interpretation.degreeAlteration !== 0 || destination.interpretation.appliedTarget) return false;
  const left = before.identity, right = after.identity;
  if (left.structure.kind !== "tertian" || right.structure.kind !== "tertian" ||
      left.structure.quality !== "diminished7" || right.structure.quality !== "diminished7" ||
      left.structure.extensions.length || right.structure.extensions.length ||
      left.structure.alterations.length || right.structure.alterations.length ||
      pitchClassEquals(left.root, right.root) ||
      !pitchClassEquals(right.root, leadingTonePitchClass(destination.key))) return false;
  const members = new Set(chordIdentityToneSpellings(left).map(pitchClassValue));
  return chordIdentityToneSpellings(right).every(pitch => members.has(pitchClassValue(pitch)));
}


/** Direct vii?7 rotation into a confirmed tonic. Require the respelled
 * old leading tone to become the new seventh and descend in its own voice.
 * A label or pitch-class-set match alone cannot retire an obligation. */
export function provesDiminishedPivotArrival(
  previous: AnalysisSlice | undefined, pivot: AnalysisSlice | undefined, arrival: AnalysisSlice | undefined,
  oldChord: AnalysisChord, newChord: AnalysisChord, destination: KeyReference,
) {
  if (!previous?.completeSatb || !pivot?.completeSatb || !arrival?.completeSatb ||
      previous.endTick !== pivot.tick || pivot.endTick !== arrival.tick ||
      !hasWrittenVoicing(previous, chordIdentityToneSpellings(oldChord.identity)) ||
      !hasWrittenVoicing(pivot, chordIdentityToneSpellings(newChord.identity)) ||
      !VOICE_ORDER.every(voice => toMidi(previous.notes[voice]!.pitch) === toMidi(pivot.notes[voice]!.pitch))) return false;
  const tonic = chordToneSpellings(destination.tonic, destination.mode);
  const [, , , seventh] = chordIdentityToneSpellings(newChord.identity);
  if (!hasWrittenVoicing(arrival, tonic)) return false;
  const previousLeading = VOICE_ORDER.find(voice => pitchClassEquals(previous.notes[voice]!.pitch, oldChord.identity.root));
  return !!previousLeading && pitchClassEquals(pivot.notes[previousLeading]!.pitch, seventh) &&
    resolvesInVoice(pivot, arrival, previousLeading, tonic[2], -1) &&
    VOICE_ORDER.some(voice => pitchClassEquals(pivot.notes[voice]!.pitch, newChord.identity.root) &&
      resolvesInVoice(pivot, arrival, voice, tonic[0], 1));
}
