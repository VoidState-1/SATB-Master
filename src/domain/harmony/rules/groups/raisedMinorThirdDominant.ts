import { chordToneSpellings, type ChordQuality } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, type SpelledPitchClass } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice, MelodyTransition } from "../../analysis";
import { hasWrittenVoicing, matchesWrittenChord, resolvesInVoice } from "../../writtenResolution";
import type { HarmonyRuleContext } from "../context/createRuleContext";

function agreesWithRetainedChord(
  slice: AnalysisSlice, root: SpelledPitchClass, quality: ChordQuality, tonic?: SpelledPitchClass,
) {
  const chord = slice.chord;
  if (!chord) return true;
  const readings = chord.semantics?.interpretations ?? [];
  const primary = readings.find(reading => reading.id === chord.semantics?.primaryInterpretationId);
  const authored = readings.filter(reading => reading.source !== "inferred");
  const retained = primary && primary.source !== "inferred" ? [primary] :
    authored.length ? authored : chord.locked ? readings : [];
  if (readings.length && !retained.length) return true;
  if (!matchesWrittenChord(slice, root, quality)) return false;
  if (!tonic) return true;

  return retained.every(({ appliedTarget, confidence, degree, degreeAlteration, designation, localKey }) => {
    if (confidence === "ambiguous" || confidence === "unknown" || degree !== 5 || degreeAlteration !== 0) return false;
    const key = localKey ?? slice.key;
    // FunctionalTarget's degree is relative to the written local key. The
    // interpretation's alteration belongs to the chord root, not the target.
    if (appliedTarget) {
      if (designation?.primaryFunction && designation.primaryFunction !== "dominant") return false;
      const kind = designation?.kind;
      return (!kind || kind === "applied-dominant" ||
        (kind === "double-dominant" && appliedTarget.degree === 5)) &&
        pitchClassEquals(scaleDegreePitchClass(key, appliedTarget.degree), tonic);
    }
    return (!designation || designation.primaryFunction === "dominant") && pitchClassEquals(key.tonic, tonic);
  });
}

/** §32.4. Read a minor triad or seventh whose raised third resolves as a
 * local leading tone. Distinguish a retained conflict at the dominant or
 * arrival from an unsupported preparation with other possible proofs. */
export function readRaisedMinorThirdIntoDominant(context: HarmonyRuleContext, motion: MelodyTransition) {
  const { previous, current, voiceId, writtenInterval: entry } = motion;
  if (!motion.contiguous || !motion.sameKey || entry.diatonicSteps !== 0 || entry.semitones !== 1) return;
  const tick = current.startTick, end = tick + current.durationTicks;
  const before = context.sliceAt(tick - 1), raised = context.sliceAt(tick), landing = context.sliceAt(end);
  const arrival = landing?.notes[voiceId];
  if (!before?.completeSatb || !raised?.completeSatb || !landing?.completeSatb || !arrival ||
      before.notes[voiceId]?.id !== previous.id || raised.notes[voiceId]?.id !== current.id ||
      arrival.startTick !== end) return;

  const tonic = arrival.pitch;
  const root = scaleDegreePitchClass({ tonic, mode: "minor" }, 5);
  const minor = chordToneSpellings(root, "minor");
  const minor7 = chordToneSpellings(root, "minor7");
  const major = chordToneSpellings(root, "major");
  const dominant7 = chordToneSpellings(root, "dominant7");
  if (!pitchClassEquals(previous.pitch, minor[1]) || !pitchClassEquals(current.pitch, dominant7[1])) return;

  const sourceQuality = hasWrittenVoicing(before, minor) ? "minor" :
    hasWrittenVoicing(before, minor7) ? "minor7" : undefined;
  const dominantQuality = hasWrittenVoicing(raised, dominant7) ? "dominant7" :
    hasWrittenVoicing(raised, major) ? "major" : undefined;
  const landingQuality = hasWrittenVoicing(landing, chordToneSpellings(tonic, "minor")) ? "minor" :
    hasWrittenVoicing(landing, chordToneSpellings(tonic, "major")) ? "major" : undefined;
  if (!sourceQuality || !dominantQuality || !landingQuality ||
      (sourceQuality === "minor7" && dominantQuality !== "dominant7")) return;

  // Bass-only motion over a triad keeps the existing passing-note contract.
  if (voiceId === "bass" && dominantQuality === "major") return;

  const frames = context.slices({ overlapping: { fromTick: tick, toTick: end } });
  const tones = dominantQuality === "dominant7" ? dominant7 : major;
  if (!frames.all(slice => hasWrittenVoicing(slice, tones))) return;
  if (!agreesWithRetainedChord(landing, tonic, landingQuality) ||
      !frames.all(slice => agreesWithRetainedChord(slice, root, dominantQuality, tonic))) return "conflicting-destination";

  const { project } = context.analysis;
  if (project.keyEvents.some(key => previous.startTick < key.tick && key.tick <= end) ||
      project.structure.phraseBoundaries.some(boundary => boundary.source === "manual" &&
        !boundary.stale && previous.startTick < boundary.tick && boundary.tick <= end) ||
      !resolvesInVoice(raised, landing, voiceId, tonic, 1) ||
      VOICE_ORDER.some(voice => voice !== voiceId && pitchClassEquals(before.notes[voice]!.pitch, minor[1])) ||
      !agreesWithRetainedChord(before, root, sourceQuality)) return "unsupported";

  if (dominantQuality === "major") {
    const singleLeadingTone = frames.all(slice => VOICE_ORDER.every(voice =>
      voice === voiceId || !pitchClassEquals(slice.notes[voice]!.pitch, major[1])));
    return singleLeadingTone ? "supported" : "unsupported";
  }

  const seventh = dominant7[3];
  const seventhVoice = VOICE_ORDER.find(voice => pitchClassEquals(raised.notes[voice]!.pitch, seventh));
  const departure = context.sliceAt(end - 1);
  const seventhResolves = seventhVoice && departure &&
    frames.all(slice => pitchClassEquals(slice.notes[seventhVoice]!.pitch, seventh)) &&
    resolvesInVoice(departure, landing, seventhVoice, scaleDegreePitchClass({ tonic, mode: landingQuality }, 3), -1);
  return seventhResolves ? "supported" : "unsupported";
}
