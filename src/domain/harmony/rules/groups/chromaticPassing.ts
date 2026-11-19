import { chordIdentityToneSpellings, type KeyReference } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, stepIndex, type SpelledPitchClass } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import { sameChordIdentityWithoutBass, type AnalysisSlice, type MelodyTransition } from "../../analysis";
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
  if (!from?.chord || !to?.chord || !via) return false;
  const key = localKey(context, from);
  const landingKey = localKey(context, to);
  const middleKey = via.chord ? localKey(context, via) : key;
  if (!key || ![middleKey, landingKey].every(k => k && k.mode === key.mode && pitchClassEquals(k.tonic, key.tonic))) return false;
  if (![left, right].every(n => pitchClassEquals(n.pitch, scaleDegreePitchClass(key, writtenDegree(key, n.pitch)))) ||
      !usualChromaticSpelling(key, middle.pitch, a.semitones > 0)) return false;
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
