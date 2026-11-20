import { canonicalJson } from "../canonicalJson";
import type { HarmonyInterpretation, KeyReference } from "../chordModel";
import { pitchClassEquals } from "../pitch";

/** Compare the stated function, independently of the annotation's id, source and confidence.
 * A caller that inherits the score key supplies its effective keys explicitly. */
export function sameFunctionalReading(
  left: HarmonyInterpretation,
  right: HarmonyInterpretation,
  leftKey: KeyReference | undefined = left.localKey,
  rightKey: KeyReference | undefined = right.localKey,
) {
  if (leftKey && rightKey) {
    if (leftKey.mode !== rightKey.mode || !pitchClassEquals(leftKey.tonic, rightKey.tonic)) return false;
  } else if (leftKey !== rightKey) {
    return false;
  }
  return left.degree === right.degree && left.degreeAlteration === right.degreeAlteration &&
    canonicalJson(left.appliedTarget) === canonicalJson(right.appliedTarget) &&
    canonicalJson(left.designation) === canonicalJson(right.designation);
}
