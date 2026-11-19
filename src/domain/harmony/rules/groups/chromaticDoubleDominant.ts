import {
  chordIdentityToneSpellings,
  type KeyReference,
} from "../../../chordModel";
import {
  pitchClassEquals,
  scaleDegreePitchClass,
  writtenInterval,
} from "../../../pitch";
import type { MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "../helpers/core";

function sameKey(left: KeyReference, right: KeyReference) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

export function isRespeltDoubleDominantSeventh(
  context: HarmonyRuleContext,
  transition: MelodyTransition,
): boolean {
  const { previous, current, voiceId, writtenInterval: entry } = transition;
  if (
    !transition.contiguous || !transition.sameKey ||
    entry.diatonicSteps !== 0 || entry.semitones !== 1 ||
    current.nonChordToneRole
  ) return false;

  const preparation = context.sliceAt(current.startTick - 1);
  const middle = context.sliceAt(current.startTick);
  const chord = middle?.chord;
  if (
    !preparation || !middle || !chord || chord.startTick !== current.startTick ||
    middle.notes[voiceId]?.id !== current.id
  )
    return false;

  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return false;
  const { designation, appliedTarget, localKey } = reading.value;
  const key = localKey ?? middle.key;
  const kind = designation?.kind;
  if (
    key.mode !== "major" ||
    (kind !== "double-dominant-leading-tone" && kind !== "applied-leading-tone") ||
    (appliedTarget?.degree ?? (kind === "double-dominant-leading-tone" ? 5 : undefined)) !== 5
  ) return false;

  const preparationReading = preparation.chord &&
    context.harmony.primaryInterpretation(preparation.chord);
  const preparationKey = preparationReading?.status === "resolved"
    ? preparationReading.value.localKey ?? preparation.key
    : preparation.key;
  if (
    preparationReading?.status === "ambiguous" || !sameKey(preparationKey, key) ||
    !pitchClassEquals(previous.pitch, scaleDegreePitchClass(key, 2)) ||
    !pitchClassEquals(current.pitch, scaleDegreePitchClass(key, 2, 1))
  ) return false;

  const { identity } = chord;
  const { structure } = identity;
  if (
    structure.kind !== "tertian" || structure.quality !== "diminished7" ||
    structure.extensions.length !== 0 || structure.alterations.length !== 0 ||
    !pitchClassEquals(identity.root, scaleDegreePitchClass(key, 4, 1))
  ) return false;

  // 第28章书186–188页，例28-423、427：原位或第一转位的重属导减七，
  // 其降III改写为升II，原声部上行半音解决到K46的三音。
  const [root, third, fifth, seventh] = chordIdentityToneSpellings(identity);
  const bass = middle.notes.bass;
  const sounding = activeNotes(middle);
  if (
    !pitchClassEquals(seventh, scaleDegreePitchClass(key, 3, -1)) ||
    (!pitchClassEquals(identity.bass, root) && !pitchClassEquals(identity.bass, third)) ||
    !bass || !pitchClassEquals(bass.pitch, identity.bass) ||
    ![root, third, fifth].every(tone => sounding.some(({ note }) =>
      !note.nonChordToneRole && pitchClassEquals(note.pitch, tone),
    ))
  ) return false;

  const next = context.notes({ voiceId, startingAfter: current.startTick }).first()?.note;
  const landingTick = chord.startTick + chord.durationTicks;
  if (
    !next || next.nonChordToneRole || next.startTick !== landingTick ||
    current.startTick + current.durationTicks !== landingTick ||
    !pitchClassEquals(next.pitch, scaleDegreePitchClass(key, 3)) ||
    writtenInterval(current.pitch, next.pitch).semitones !== 1 ||
    context.analysis.project.keyEvents.some(event =>
      event.tick > previous.startTick && event.tick <= landingTick &&
      !sameKey(event, middle.key),
    )
  ) return false;

  const landing = context.sliceAt(landingTick);
  const target = landing?.chord;
  if (!landing || !target || target.startTick !== landingTick ||
      landing.notes[voiceId]?.id !== next.id) return false;
  const targetReading = context.harmony.primaryInterpretation(target);
  if (targetReading.status !== "resolved" ||
      !sameKey(targetReading.value.localKey ?? landing.key, key)) return false;

  const role = target.semantics?.cadenceRole;
  const cadential = role === "cadential64" ||
    (role === undefined && targetReading.value.designation?.kind === "cadential64");
  const dominant = scaleDegreePitchClass(key, 5);
  const targetStructure = target.identity.structure;
  return (
    cadential &&
    targetStructure.kind === "tertian" && targetStructure.quality === "major" &&
    targetStructure.extensions.length === 0 && targetStructure.alterations.length === 0 &&
    pitchClassEquals(target.identity.root, key.tonic) &&
    pitchClassEquals(target.identity.bass, dominant) &&
    !!landing.notes.bass && pitchClassEquals(landing.notes.bass.pitch, dominant) &&
    activeNotes(landing).some(({ note }) =>
      !note.nonChordToneRole && pitchClassEquals(note.pitch, key.tonic),
    )
  );
}
