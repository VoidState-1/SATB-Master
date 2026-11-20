import type { AnalysisSlice, MelodyTransition } from "../../analysis";
import { readReattackedDominantSeventh } from "../../writtenDominantSeventh";
import { pitchClassEquals, scaleDegreePitchClass, type KeyLike } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import { eventAtTick, ticksPerBeat } from "../../../time";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { matchesWrittenChord } from "../../writtenResolution";

function agreesWithTonicReading(context: HarmonyRuleContext, slice: AnalysisSlice, key: KeyLike, dominant: boolean) {
  const chord = slice.chord;
  if (!chord?.semantics) return true;
  if (chord.semantics.pedalContext || chord.semantics.cadenceRole) return false;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return false;
  const { localKey, appliedTarget, degree, degreeAlteration } = reading.value;
  const base = localKey ?? slice.key;
  if (appliedTarget) return dominant && pitchClassEquals(scaleDegreePitchClass(base, appliedTarget.degree), key.tonic);
  if (dominant) return degree === 5 && degreeAlteration === 0 &&
    pitchClassEquals(base.tonic, key.tonic) && base.mode === key.mode;
  return pitchClassEquals(scaleDegreePitchClass(base, degree, degreeAlteration), key.tonic);
}

/** A natural-minor dominant raises its third before a fully written V7
 * and the seventh's same-voice reattack. Leave doubled chromatic preparations
 * to the independent voice-leading conditions of §32.4. */
export function preparesDominantWithReattackedSeventh(context: HarmonyRuleContext, motion: MelodyTransition) {
  const { previous, current, voiceId, writtenInterval } = motion;
  if (!motion.contiguous || !motion.sameKey || writtenInterval.diatonicSteps !== 0 || writtenInterval.semitones !== 1) return false;
  if (previous.nonChordToneRole || current.nonChordToneRole) return false;
  const tick = current.startTick;
  const end = tick + current.durationTicks;
  const before = context.sliceAt(tick - 1), departure = context.sliceAt(tick), onset = context.sliceAt(end);
  if (!before?.completeSatb || !departure || !onset ||
      before.notes[voiceId]?.id !== previous.id || departure.notes[voiceId]?.id !== current.id ||
      VOICE_ORDER.some(voice => voice !== voiceId && pitchClassEquals(before.notes[voice]!.pitch, previous.pitch))) return false;

  const proof = readReattackedDominantSeventh(departure, onset, tick => context.sliceAt(tick));
  if (!proof || proof.leadingVoice !== voiceId || proof.key.mode !== "minor") return false;
  const settled = context.sliceAt(proof.settledTick)!;
  const tonic = proof.key.tonic;
  const { project, phraseBoundaries } = context.analysis;
  const meter = eventAtTick(project.meterEvents, onset.tick);
  const accent = context.metric.positionAt(onset.tick);
  if (proof.repeated.durationTicks > ticksPerBeat(project.ppq, meter.denominator) ||
      context.metric.compare(accent, context.metric.positionAt(tick)) !== "stronger" ||
      context.metric.compare(accent, context.metric.positionAt(settled.tick)) !== "stronger" ||
      project.keyEvents.some(event => previous.startTick < event.tick && event.tick <= settled.tick) ||
      project.meterEvents.some(event => tick < event.tick && event.tick <= settled.tick) ||
      phraseBoundaries.some(boundary => !boundary.stale && previous.startTick < boundary.tick && boundary.tick <= settled.tick)) return false;

  if (!matchesWrittenChord(before, proof.root, "minor") || !matchesWrittenChord(settled, tonic, "minor") ||
      !agreesWithTonicReading(context, settled, proof.key, false)) return false;
  return context.slices({ overlapping: { fromTick: tick, toTick: end } })
    .all(slice => matchesWrittenChord(slice, proof.root, "dominant7") &&
      agreesWithTonicReading(context, slice, proof.key, true)) &&
    context.slices({ overlapping: { fromTick: end, toTick: settled.tick } })
      .all(slice => {
        const identity = slice.chord?.identity;
        if (!identity) return true;
        const structure = identity.structure;
        return structure.kind === "tertian" && structure.quality === "minor" &&
          !structure.extensions.length && !structure.alterations.length &&
          pitchClassEquals(identity.root, tonic) && pitchClassEquals(identity.bass, settled.notes.bass!.pitch) &&
          agreesWithTonicReading(context, slice, proof.key, false);
      });
}
