import { chordToneSpellings } from "../../../chordModel";
import { formatPitchClass, formatSpelledPitch, pitchClassEquals, scaleDegreePitchClass, type Alteration } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { hasWrittenVoicing, resolvesInVoice } from "../../writtenResolution";
import type { RuleDiagnostic } from "../../runtime";
import { defineStatelessRule } from "../defineRule";
import { diagnostic, noteEvidence, voiceName } from "../helpers/core";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";

const RULE_ID = "resolution.altered-dominant-fifth";

function findUnresolvedFifths(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const target of context.slices()) {
    const source = context.sliceAt(target.tick - 1);
    const bass = source?.notes.bass;
    if (!source?.completeSatb || !target.completeSatb || !bass ||
      source.key.id !== target.key.id || crossesManualPhraseBoundary(context, source.tick, target.tick)) continue;

    const tonic = scaleDegreePitchClass({ tonic: bass.pitch, mode: "major" }, 4);
    if (!pitchClassEquals(target.notes.bass!.pitch, tonic)) continue;
    const [root, third, fifth, seventh] = chordToneSpellings(bass.pitch, "dominant7");
    const seventhVoice = VOICE_ORDER.find(voice => pitchClassEquals(source.notes[voice]!.pitch, seventh));
    if (!seventhVoice) continue;

    for (const direction of [-1, 1] as const) {
      const alteration = fifth.alter + direction;
      if (alteration < -2 || alteration > 2) continue;
      const alteredFifth = { step: fifth.step, alter: alteration as Alteration };
      if (!hasWrittenVoicing(source, [root, third, alteredFifth, seventh])) continue;

      // Require the independent resolution of the seventh. The receiving tonic
      // may omit its fifth, as in the doubled-third voicing in §46.
      for (const quality of direction === 1 ? ["major"] as const : ["major", "minor"] as const) {
        const tonicTones = chordToneSpellings(tonic, quality);
        const tonicThird = tonicTones[1];
        if (!resolvesInVoice(source, target, seventhVoice, tonicThird, -1) ||
          (!hasWrittenVoicing(target, tonicTones) && !hasWrittenVoicing(target, [tonic, tonicThird]))) continue;

        const voice = VOICE_ORDER.find(part => pitchClassEquals(source.notes[part]!.pitch, alteredFifth))!;
        const from = source.notes[voice]!, to = target.notes[voice]!;
        const destination = direction === 1 ? tonicThird : tonic;
        if (from.startTick + from.durationTicks !== target.tick || to.startTick !== target.tick ||
          resolvesInVoice(source, target, voice, destination, direction)) continue;

        const name = voiceName(context.analysis, voice);
        const chordIds = source.chord && target.chord ? [source.chord.id, target.chord.id] : [];
        const motion = direction === 1 ? "上行至主和弦三音" : "下行至主和弦根音";
        diagnostics.push(diagnostic(RULE_ID, target.tick, target.endTick, [voice], [from, to],
          "属和弦变五音未解决",
          `${name}的属和弦变五音 ${formatSpelledPitch(from.pitch)} 应级进${motion} ${formatPitchClass(destination)}，实际到达 ${formatSpelledPitch(to.pitch)}。`,
          { chordIds, params: { direction, destination: formatPitchClass(destination) },
            evidence: [
              noteEvidence(from, name),
              noteEvidence(to, name),
              noteEvidence(source.notes[seventhVoice]!, "属七音"),
              noteEvidence(target.notes[seventhVoice]!, "七音落点"),
            ] },
        ));
      }
    }
  }
  return diagnostics;
}

export const ALTERED_DOMINANT_FIFTH_RESOLUTION_RULE = defineStatelessRule({
  id: RULE_ID,
  catalogNumber: "E.6",
  label: "属和弦变五音未解决",
  description: "检查实写变五音属七和弦进入目标主和弦时，变五音是否在原声部按方向级进解决。",
  rationale: "升五音上行半音到大调主和弦三音，降五音下行半音到主和弦根音。",
  group: "resolution",
  defaultSeverity: "warning",
  requires: ["written-pitches"],
  dependencyScope: "phrase",
  coveredRuleIds: ["resolution.altered-tone"],
  evaluate: findUnresolvedFifths,
});
