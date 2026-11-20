import { chordIdentityToneSpellings, type KeyReference } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, toMidi } from "../../../pitch";
import type { AnalysisSlice, MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "../helpers/core";

/** Check the functional reading against all four sounding notes at the edge.
 * The root-position V7 may omit its fifth and double its root. */
function seventhKey(
  context: HarmonyRuleContext, slice: AnalysisSlice, quality: "major7" | "dominant7",
): KeyReference | undefined {
  const chord = slice.chord;
  const bass = slice.notes.bass;
  if (!chord || !bass || !slice.completeSatb) return;
  const { root, structure } = chord.identity;
  if (structure.kind !== "tertian" || structure.quality !== quality ||
      structure.alterations.length || structure.extensions.length ||
      !pitchClassEquals(chord.identity.bass, root) || !pitchClassEquals(bass.pitch, root)) return;

  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return;
  const { appliedTarget, confidence, designation, degree, degreeAlteration, localKey } = reading.value;
  if (appliedTarget || (confidence !== "certain" && confidence !== "probable")) return;
  const key = localKey ?? slice.key;
  const dominant = quality === "dominant7";
  if (dominant) {
    if (degree !== 5 || degreeAlteration !== 0 || designation?.kind !== "primary" ||
        designation.primaryFunction !== "dominant" || !pitchClassEquals(root, scaleDegreePitchClass(key, 5))) return;
  } else if (degree !== 2 || degreeAlteration !== -1 ||
      (designation?.kind !== "side-degree" && designation?.kind !== "neapolitan") ||
      !pitchClassEquals(root, scaleDegreePitchClass(key, 2, -1))) return;

  const tones = chordIdentityToneSpellings(chord.identity);
  const sounding = activeNotes(slice).map(({ note }) => note);
  if (sounding.some(note => note.nonChordToneRole || toMidi(note.pitch) < toMidi(bass.pitch) ||
      !tones.some(tone => pitchClassEquals(note.pitch, tone)))) return;
  const counts = tones.map(tone => sounding.filter(note => pitchClassEquals(note.pitch, tone)).length);
  const complete = counts.every(count => count === 1);
  const [roots, thirds, fifths, sevenths] = counts;
  if (complete || (dominant && roots === 2 && thirds === 1 && fifths === 0 && sevenths === 1)) return key;
}

/** Spasobin §47.5–6, ex. 47-705. Both directions belong to the bass alone. */
export function isNeapolitanSeventhBassTritone(context: HarmonyRuleContext, transition: MelodyTransition) {
  if (transition.voiceId !== "bass" || !transition.contiguous ||
      Math.abs(transition.writtenInterval.semitones) !== 6) return false;
  const tick = transition.current.startTick;
  const source = context.sliceAt(tick - 1);
  const landing = context.sliceAt(tick);
  if (!source || !landing || source.endTick !== tick || landing.chord?.startTick !== tick ||
      source.notes.bass?.id !== transition.previous.id || landing.notes.bass?.id !== transition.current.id ||
      source.key.id !== landing.key.id || context.analysis.phraseBoundaries.some(boundary =>
        !boundary.stale && source.tick < boundary.tick && boundary.tick <= tick)) return false;

  const from = seventhKey(context, source, "major7");
  const to = seventhKey(context, landing, "dominant7");
  return !!from && !!to && keyEquals(from, to);
}
