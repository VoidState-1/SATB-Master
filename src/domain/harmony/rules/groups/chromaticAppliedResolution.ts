import { chordIdentityToneSpellings, chordToneSpellings } from "../../../chordModel";
import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, stepIndex, writtenInterval,
  type SpelledPitchClass } from "../../../pitch";
import { VOICE_ORDER } from "../../../project";
import type { MelodyTransition } from "../../analysis";
import { hasWrittenVoicing, resolvesInVoice, matchesWrittenChord } from "../../writtenResolution";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { HarmonyRuleContext } from "../context/createRuleContext";

// §§28.6, 32.4. A same-voice alteration introduces a tendency tone of a
// secondary dominant. Establish its local target from both resolutions.
export function preparesWrittenAppliedSeventh(context: HarmonyRuleContext, motion: MelodyTransition) {
  const { previous, current, voiceId, writtenInterval: entry } = motion;
  if (!motion.contiguous || !motion.sameKey || entry.diatonicSteps !== 0 || Math.abs(entry.semitones) !== 1) return false;
  const tick = current.startTick, end = tick + current.durationTicks;
  const before = context.sliceAt(previous.startTick), middle = context.sliceAt(tick), target = context.sliceAt(end);
  if (!before?.chord || !middle || !target?.notes.bass || before.notes[voiceId]?.id !== previous.id ||
      middle.notes[voiceId]?.id !== current.id || middle.tick !== tick || middle.endTick !== end || target.tick !== end ||
      before.key.id !== middle.key.id || middle.key.id !== target.key.id ||
      context.analysis.phraseBoundaries.some(b => !b.stale && previous.startTick < b.tick && b.tick <= end) ||
      !hasWrittenVoicing(before, chordIdentityToneSpellings(before.chord.identity)) ||
      !pitchClassEquals(before.notes.bass!.pitch, before.chord.identity.bass)) return false;

  const immediatelyBefore = context.sliceAt(tick - 1);
  if (!immediatelyBefore?.completeSatb || immediatelyBefore.notes[voiceId]?.id !== previous.id ||
      (immediatelyBefore.chord && !chordIdentityToneSpellings(immediatelyBefore.chord.identity)
        .some(t => pitchClassEquals(t, previous.pitch))) ||
      !hasCompleteWrittenTertianVoicing(VOICE_ORDER.map(v => immediatelyBefore.notes[v]!.pitch))) return false;
  // §32.4c. If the altered degree was doubled, require the other copy
  // to move by a written step in the opposite direction.
  for (const other of VOICE_ORDER) {
    const old = immediatelyBefore.notes[other]!, next = middle.notes[other];
    if (other === voiceId || !pitchClassEquals(old.pitch, previous.pitch)) continue;
    if (!next) return false;
    const step = writtenInterval(old.pitch, next.pitch);
    if (step.diatonicSteps !== -entry.semitones || Math.sign(step.semitones) !== step.diatonicSteps ||
        Math.abs(step.semitones) > 2) return false;
  }

  const home = middle.key, tonic = target.notes.bass.pitch;
  const degree = (pitch: SpelledPitchClass) => (stepIndex(pitch.step) - stepIndex(home.tonic.step) + 7) % 7 + 1;
  const diatonic = (pitch: SpelledPitchClass) => pitchClassEquals(pitch, scaleDegreePitchClass(home, degree(pitch)));
  if (pitchClassEquals(tonic, home.tonic) || !diatonic(previous.pitch) || diatonic(current.pitch)) return false;
  const mode = (["major", "minor"] as const).find(q =>
    chordToneSpellings(tonic, q).every(diatonic) && matchesWrittenChord(target, tonic, q));
  if (!mode) return false;
  const local = { tonic, mode };
  const leading = leadingTonePitchClass(local);
  const dominant = scaleDegreePitchClass(local, 5);
  const isDominant = matchesWrittenChord(middle, dominant, "dominant7");
  if (!isDominant && !matchesWrittenChord(middle, leading, "diminished7")) return false;
  for (const slice of [before, middle, target]) {
    if (!slice.chord) continue;
    const interpretation = context.harmony.primaryInterpretation(slice.chord);
    if (interpretation.status === "ambiguous") return false;
    if (interpretation.status !== "resolved") continue;
    const { localKey, appliedTarget, designation } = interpretation.value;
    if (localKey && (localKey.mode !== home.mode || !pitchClassEquals(localKey.tonic, home.tonic))) return false;
    if (slice === target && (appliedTarget || interpretation.value.degreeAlteration !== 0 ||
        interpretation.value.degree !== degree(tonic))) return false;
    if (slice === middle && designation) {
      const kind = designation.kind;
      const applied = isDominant ? kind === "applied-dominant" : kind === "applied-leading-tone";
      const double = isDominant ? kind === "double-dominant" : kind === "double-dominant-leading-tone";
      if (!(applied && appliedTarget) && !(double && degree(tonic) === 5)) return false;
    }
    if (slice === middle && appliedTarget && appliedTarget.degree !== degree(tonic)) return false;
  }

  const seventh = isDominant ? chordToneSpellings(dominant, "dominant7")[3] : chordToneSpellings(leading, "diminished7")[3];
  const leadingVoice = VOICE_ORDER.find(v => pitchClassEquals(middle.notes[v]!.pitch, leading))!;
  const seventhVoice = VOICE_ORDER.find(v => pitchClassEquals(middle.notes[v]!.pitch, seventh))!;
  return voiceId === (entry.semitones > 0 ? leadingVoice : seventhVoice) &&
    resolvesInVoice(middle, target, leadingVoice, tonic, 1) &&
    resolvesInVoice(middle, target, seventhVoice, scaleDegreePitchClass(local, isDominant ? 3 : 5), -1);
}
