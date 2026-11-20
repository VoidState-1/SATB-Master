import { chordIdentityEquals, chordIdentityToneSpellings, type ChordIdentity, type KeyReference } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, stepIndex, type SpelledPitchClass } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import { sameChordIdentityWithoutBass, type AnalysisSlice, type MelodyTransition } from "../../analysis";
import { soundsCompleteWrittenChord } from "../../writtenNeighbors";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { hasExactPitch } from "../helpers/core";

function writtenDegree(key: KeyReference, pitch: SpelledPitchClass) {
  return (stepIndex(pitch.step) - stepIndex(key.tonic.step) + 7) % 7 + 1;
}

// 第 41 章例 41-616、617。索引从 I 到 VII，0 表示该级只采用自然写法。
const ASCENDING_ALTERATIONS = [1, 1, 0, 1, 1, 0, -1];
const DESCENDING_ALTERATIONS = [0, -1, -1, 1, 0, -1, -1];

function usualChromaticSpelling(key: KeyReference, pitch: SpelledPitchClass, ascending: boolean) {
  // 小调上行参照平行大调，下行参照同主音大调。
  const tonic = key.mode === "minor" && ascending ? scaleDegreePitchClass(key, 3) : key.tonic;
  const major = { tonic, mode: "major" } as const;
  const degree = writtenDegree(major, pitch);
  if (pitchClassEquals(pitch, scaleDegreePitchClass(major, degree))) return true;
  const alteration = (ascending ? ASCENDING_ALTERATIONS : DESCENDING_ALTERATIONS)[degree - 1];
  return alteration !== 0 && pitchClassEquals(pitch, scaleDegreePitchClass(major, degree, alteration));
}

function localKey(context: HarmonyRuleContext, slice: AnalysisSlice) {
  if (!slice.chord) return slice.key;
  const interpretation = context.harmony.primaryInterpretation(slice.chord);
  if (interpretation.status === "ambiguous") return undefined;
  return interpretation.status === "resolved" ? interpretation.value.localKey ?? slice.key : slice.key;
}

function fullySoundsTriad(slice: AnalysisSlice, identity: ChordIdentity, passingId?: string) {
  const bass = slice.notes.bass;
  return !!bass && slice.completeSatb && soundsCompleteWrittenChord(identity, Object.values(slice.notes), bass, passingId);
}

function plainTriad(root: SpelledPitchClass, quality: "major" | "minor", bass: SpelledPitchClass): ChordIdentity {
  return { root, bass, structure: { kind: "tertian", quality, extensions: [], alterations: [] } };
}

// Spasobin, ch. 41 §§1–3: in a weak subdivision the raised third of the
// minor tonic can be a written chromatic step toward the subdominant.
// The other voices must sustain the same sounding tonic and fifth even
// if the middle sonority is labelled separately as a major triad.
function isRaisedTonicThirdPassing(
  context: HarmonyRuleContext, first: MelodyTransition, second: MelodyTransition,
  from: AnalysisSlice, to: AnalysisSlice, key: KeyReference,
) {
  const { previous: left, current: middle, voiceId } = first;
  const { current: right } = second;
  if (voiceId !== "bass" || key.mode !== "minor" ||
      first.writtenInterval.diatonicSteps !== 0 || first.writtenInterval.semitones !== 1) return false;

  const third = scaleDegreePitchClass(key, 3);
  const raisedThird = scaleDegreePitchClass(key, 3, 1);
  const subdominant = scaleDegreePitchClass(key, 4);
  if (!pitchClassEquals(left.pitch, third) || !pitchClassEquals(middle.pitch, raisedThird) ||
      !pitchClassEquals(right.pitch, subdominant)) return false;

  const position = context.metric.positionAt(middle.startTick);
  const measure = position && context.analysis.metricTimeline.measures[position.measureNumber - 1];
  if (!position || position.role !== "subdivision" || !measure ||
      middle.durationTicks > measure.beatLength ||
      context.metric.compare(context.metric.positionAt(right.startTick), position) !== "stronger") return false;
  if (context.analysis.project.keyEvents.some(event =>
    left.startTick < event.tick && event.tick <= right.startTick &&
    (event.mode !== from.key.mode || !pitchClassEquals(event.tonic, from.key.tonic))) ||
    context.analysis.phraseBoundaries.some(boundary =>
      !boundary.stale && left.startTick < boundary.tick && boundary.tick <= right.startTick)) return false;

  const source = plainTriad(key.tonic, "minor", third);
  const colored = plainTriad(key.tonic, "major", raisedThird);
  const arrival = plainTriad(subdominant, "minor", subdominant);
  if (from.notes.bass?.id !== left.id || to.notes.bass?.id !== right.id ||
      !fullySoundsTriad(from, source) || !fullySoundsTriad(to, arrival) ||
      (from.chord && !chordIdentityEquals(from.chord.identity, source)) ||
      (to.chord && !chordIdentityEquals(to.chord.identity, arrival))) return false;

  const upperParts = VOICE_ORDER.filter(part => part !== "bass");
  return context.slices({ overlapping: { fromTick: middle.startTick, toTick: right.startTick } }).all(slice => {
    if (slice.notes.bass?.id !== middle.id || !fullySoundsTriad(slice, colored, middle.id) ||
        !upperParts.every(part => slice.notes[part]?.id === from.notes[part]?.id)) return false;
    const chord = slice.chord;
    if (!chord || chord.id === from.chord?.id) return true;
    if (!chordIdentityEquals(chord.identity, colored)) return false;
    const reading = context.harmony.primaryInterpretation(chord);
    if (reading.status === "ambiguous") return false;
    if (reading.status !== "resolved") return true;
    const { localKey: labelledKey, appliedTarget } = reading.value;
    return (!labelledKey || (labelledKey.mode === key.mode && pitchClassEquals(labelledKey.tonic, key.tonic))) &&
      (!appliedTarget || appliedTarget.degree === 4);
  });
}

function isChromaticPassing(context: HarmonyRuleContext, first: MelodyTransition, second: MelodyTransition) {
  if (first.current.id !== second.previous.id || !first.contiguous || !second.contiguous ||
      !first.sameKey || !second.sameKey) return false;
  const a = first.writtenInterval, b = second.writtenInterval;
  if (Math.abs(a.semitones) !== 1 || a.semitones !== b.semitones ||
      a.diatonicSteps + b.diatonicSteps !== a.semitones ||
      (a.diatonicSteps !== 0 && b.diatonicSteps !== 0)) return false;
  const left = first.previous;
  const middle = first.current;
  const right = second.current;
  if ((middle.nonChordToneRole && middle.nonChordToneRole !== "passing") ||
      left.nonChordToneRole || right.nonChordToneRole) return false;
  const meter = context.metric.positionAt(middle.startTick);
  if (!meter || meter.confidence === "ambiguous" || meter.role === "downbeat") return false;
  const from = context.sliceAt(middle.startTick - 1);
  const via = context.sliceAt(middle.startTick);
  const to = context.sliceAt(right.startTick);
  if (!from || !to || !via) return false;
  const key = localKey(context, from);
  const landingKey = localKey(context, to);
  const middleKey = via.chord ? localKey(context, via) : key;
  if (!key || ![middleKey, landingKey].every(k => k && k.mode === key.mode && pitchClassEquals(k.tonic, key.tonic))) return false;
  if (![left, right].every(n => pitchClassEquals(n.pitch, scaleDegreePitchClass(key, writtenDegree(key, n.pitch)))) ||
      !usualChromaticSpelling(key, middle.pitch, a.semitones > 0)) return false;
  if (isRaisedTonicThirdPassing(context, first, second, from, to, key)) return true;
  if (!from.chord || !to.chord) return false;
  if (!hasExactPitch(left, chordIdentityToneSpellings(from.chord.identity)) ||
      !hasExactPitch(right, chordIdentityToneSpellings(to.chord.identity))) return false;

  // 此处只判断旋律写法。三个伴随声部持续时，纵切也可能构成变化和弦。
  const harmony = from.chord.identity;
  const tones = chordIdentityToneSpellings(harmony);
  if (hasExactPitch(middle, tones)) return false;
  const otherVoices = VOICE_ORDER.filter(voice => voice !== first.voiceId);
  const slices = context.slices({ overlapping: { fromTick: middle.startTick, toTick: right.startTick } });
  return slices.toArray().every(slice =>
    (!slice.chord || sameChordIdentityWithoutBass(slice.chord.identity, harmony)) &&
    otherVoices.every(voice => {
      const before = from.notes[voice];
      const now = slice.notes[voice];
      return before && now && spelledPitchEquals(before.pitch, now.pitch) && hasExactPitch(before, tones);
    }),
  );
}

export function chromaticPassingTransitionIds(context: HarmonyRuleContext) {
  const ids = new Set<string>();
  for (const voiceId of VOICE_ORDER) {
    for (const [first, second] of context.melodyTransitions({ voiceId }).window(2)) {
      if (isChromaticPassing(context, first, second))
        ids.add(first.writtenInterval.diatonicSteps === 0 ? first.id : second.id);
    }
  }
  return ids;
}
