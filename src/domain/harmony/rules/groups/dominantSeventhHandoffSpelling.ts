import { pitchClassEquals, toMidi } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { MelodyTransition } from "../../analysis";
import { readDominantSeventhExchange } from "../../writtenDominantSeventh";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { agreedMember, agreesWithExplicitIdentity, completeVoicings } from "../helpers/maskedChordSpelling";

/** Establish both sevenths at the actual chromatic attack, independently of the inspected spelling. */
export function readDominantSeventhHandoffSpelling(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { previous, current, voiceId } = transition;
  const tick = current.startTick;
  if (!transition.contiguous || !transition.sameKey || toMidi(current.pitch) - toMidi(previous.pitch) !== -1) return;
  const before = context.sliceAt(tick - 1), after = context.sliceAt(tick);
  if (!before || !after || after.tick !== tick || before.key.id !== after.key.id ||
      before.notes[voiceId]?.id !== previous.id || after.notes[voiceId]?.id !== current.id ||
      [before, after].some(frame => VOICE_ORDER.some(voice => frame.notes[voice]?.nonChordToneRole)) ||
      context.analysis.phraseBoundaries.some(boundary => !boundary.stale && boundary.tick === tick)) return;

  const options = { allowOmittedDominantFifth: true };
  const left = completeVoicings(before, voiceId, ["dominant7"], options);
  const right = completeVoicings(after, voiceId, ["dominant7"], options);
  const links = left.flatMap(source => {
    const exchange = readDominantSeventhExchange(before, after, voiceId, source.root);
    if (!exchange || !pitchClassEquals(source.member, exchange.third)) return [];
    return right.filter(target => pitchClassEquals(target.root, exchange.nextRoot) &&
      pitchClassEquals(target.member, exchange.nextSeventh)).map(target => ({ source, target, exchange }));
  });
  const previousMember = agreedMember(links.map(link => link.source));
  const currentMember = agreedMember(links.map(link => link.target));
  if (!previousMember || !currentMember) return;
  const trackLocked = context.analysis.project.chordTrack.locked;
  const link = links.find(({ source, target }) =>
    agreesWithExplicitIdentity(before, voiceId, source, trackLocked) &&
    agreesWithExplicitIdentity(after, voiceId, target, trackLocked));
  if (!link) return;
  return {
    previous: previousMember, current: currentMember,
    resolvingSeventh: link.exchange.resolvingSeventh, resolvedThird: link.exchange.resolvedThird,
  };
}
