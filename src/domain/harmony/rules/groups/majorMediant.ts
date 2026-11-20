import { pitchClassEquals, scaleDegreePitchClass } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { soundsCompleteWrittenChord } from "../../writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";

function writtenRootTriad(context: HarmonyRuleContext, slice: AnalysisSlice, degree: 3 | 4) {
  const { chord, notes } = slice;
  if (!chord || !slice.completeSatb || !notes.bass || chord.semantics?.mixture ||
      chord.semantics?.cadenceRole || chord.semantics?.pedalContext) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== degree ||
      reading.value.degreeAlteration !== 0 || reading.value.appliedTarget) return;
  const key = reading.value.localKey ?? slice.key;
  const { root, bass, structure } = chord.identity;
  if (key.mode === "major" && structure.kind === "tertian" && structure.quality === (degree === 3 ? "minor" : "major") &&
      !structure.extensions.length && !structure.alterations.length &&
      pitchClassEquals(root, scaleDegreePitchClass(key, degree)) && pitchClassEquals(bass, root) &&
      soundsCompleteWrittenChord(chord.identity, Object.values(notes), notes.bass)) return key;
}

/** Spasobin §24.4–5: the mediant has both tonic and dominant functions. */
export function majorMediantToSubdominant(context: HarmonyRuleContext, before: AnalysisSlice, after: AnalysisSlice) {
  if (before.endTick !== after.tick || before.key.id !== after.key.id || after.chord?.startTick !== after.tick) return;
  const sourceKey = writtenRootTriad(context, before, 3);
  if (!sourceKey) return;
  const targetKey = writtenRootTriad(context, after, 4);
  if (targetKey && pitchClassEquals(sourceKey.tonic, targetKey.tonic)) return sourceKey;
}
