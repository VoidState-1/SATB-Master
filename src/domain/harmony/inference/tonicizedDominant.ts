import { type KeyReference } from "../../chordModel";
import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass } from "../../pitch";
import { readSoundingTertianIdentity } from "../facts/writtenVoicing";
import { resolvesTone, writtenFrame } from "./observations";
import type { ChordInferenceObservation } from "./types";

/** A tonicized V becomes the dominant of a new close when it changes to
 * first inversion, acquires its seventh, and both tendencies resolve to I.
 * The shared root-position triad still belongs to the preceding progression. */
export function tonicizedDominantInversion(frames: readonly ChordInferenceObservation[], dominant: number,
  arrival: number, key: KeyReference) {
  const dom = scaleDegreePitchClass(key, 5), lead = leadingTonePitchClass(key);
  const identity = (i: number) => readSoundingTertianIdentity(writtenFrame(frames[i]));
  const seventh = identity(dominant);
  if (dominant < 3 || arrival !== dominant + 1 || seventh?.structure.kind !== "tertian" ||
      seventh.structure.quality !== "dominant7" || !pitchClassEquals(seventh.root, dom) ||
      !pitchClassEquals(seventh.bass, lead) ||
      !resolvesTone(frames[dominant], frames[arrival], lead, key.tonic, 1) ||
      !resolvesTone(frames[dominant], frames[arrival], scaleDegreePitchClass(key, 4), scaleDegreePitchClass(key, 3), -1)) return;
  const goal = identity(arrival);
  if (!goal || goal.structure.kind !== "tertian" || goal.structure.quality !== key.mode ||
      !pitchClassEquals(goal.root, key.tonic) || !pitchClassEquals(goal.bass, key.tonic)) return;
  let start = dominant;
  for (; start > 0; start--) {
    const triad = identity(start - 1);
    if (!triad || triad.structure.kind !== "tertian" || triad.structure.quality !== "major" ||
        !pitchClassEquals(triad.root, dom) || !pitchClassEquals(triad.bass, lead)) break;
  }
  if (start === dominant || start < 2) return;
  const pivot = identity(start - 1), secondary = identity(start - 2);
  const dominantKey = { tonic: dom, mode: "major" as const };
  if (pivot?.structure.kind === "tertian" && pivot.structure.quality === "major" &&
      pitchClassEquals(pivot.root, dom) && pitchClassEquals(pivot.bass, dom) &&
      secondary?.structure.kind === "tertian" && secondary.structure.quality === "dominant7" &&
      pitchClassEquals(secondary.root, scaleDegreePitchClass(dominantKey, 5)) &&
      resolvesTone(frames[start - 2], frames[start - 1], leadingTonePitchClass(dominantKey), dom, 1) &&
      resolvesTone(frames[start - 2], frames[start - 1], scaleDegreePitchClass(dominantKey, 4), lead, -1)) return start;
}
