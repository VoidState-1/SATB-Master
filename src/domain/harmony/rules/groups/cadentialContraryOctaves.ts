import { chordToneSpellings } from "../../../chordModel";
import {
  keyEquals,
  isWrittenStep, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval,
  type KeyLike,
} from "../../../pitch";
import type { AnalysisNote, AnalysisSlice, SliceTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";

function primaryRootPositionKey(context: HarmonyRuleContext, slice: AnalysisSlice, degree: 1 | 5) {
  const chord = slice.chord;
  if (!chord || chord.semantics?.pedalContext || chord.semantics?.cadenceRole) return;
  const interpretation = context.harmony.primaryInterpretation(chord);
  if (interpretation.status !== "resolved") return;
  const reading = interpretation.value;
  if (reading.degree !== degree || reading.degreeAlteration !== 0 || reading.appliedTarget ||
      (reading.designation && reading.designation.kind !== "primary")) return;
  const key = reading.localKey ?? slice.key;
  const root = scaleDegreePitchClass(key, degree);
  const { structure } = chord.identity;
  if (structure.kind !== "tertian" || structure.extensions.length || structure.alterations.length ||
      structure.quality !== (degree === 5 ? "dominant7" : key.mode) ||
      !pitchClassEquals(chord.identity.root, root) || !pitchClassEquals(chord.identity.bass, root)) return;
  return key;
}

function isPreparedSeventh(
  context: HarmonyRuleContext,
  transition: SliceTransition,
  seventhVoice: "alto" | "tenor",
) {
  const { previous: source, current: arrival } = transition;
  const seventh = source.notes[seventhVoice]!;
  const onset = Math.max(...Object.values(source.notes).map(note => note!.startTick));
  const before = context.sliceAt(onset - 1);
  const earlier = before?.notes[seventhVoice];
  if (!before?.completeSatb || before.key.id !== source.key.id || !earlier || earlier.nonChordToneRole ||
      context.analysis.phraseBoundaries.some(boundary =>
        !boundary.stale && onset <= boundary.tick && boundary.tick <= arrival.tick,
      )) return false;
  const entry = writtenInterval(earlier.pitch, seventh.pitch);
  return spelledPitchEquals(earlier.pitch, seventh.pitch) ||
    (entry.diatonicSteps === -1 && entry.semitones < 0 && isWrittenStep(entry));
}

function closesWithPlagalSupplement(
  context: HarmonyRuleContext, transition: SliceTransition, tonicEnd: number, soundEnd: number,
) {
  const cadences = context.analysis.cadenceCandidates;
  return cadences.some(cadence =>
    cadence.confidence !== "ambiguous" && cadence.kind === "full" && cadence.form === "authentic" &&
    cadence.completion === "perfect" && cadence.fromTick <= transition.previous.tick && cadence.toTick === tonicEnd,
  ) && cadences.some(cadence =>
    cadence.confidence !== "ambiguous" && cadence.kind === "supplementary" && cadence.form === "plagal" &&
    cadence.fromTick === tonicEnd && cadence.toTick === soundEnd,
  );
}

function tonicClosesScore(context: HarmonyRuleContext, transition: SliceTransition, key: KeyLike, beatTicks: number) {
  const { current: arrival } = transition;
  const slices = context.slices({ overlapping: {
    fromTick: arrival.tick, toTick: context.analysis.project.lengthTicks,
  } }).toArray();
  let last = slices.length - 1;
  while (last >= 0 && Object.values(slices[last].notes).every(note => !note)) last--;
  if (last < 0) return false;
  const ending = slices.slice(0, last + 1);
  const soundEnd = slices[last].endTick;
  if (ending.some(slice => slice.key.id !== arrival.key.id)) return false;
  const [root, third, fifth] = chordToneSpellings(key.tonic, key.mode);
  let surfaceTicks = 0;
  let stable = true;
  for (const slice of ending) {
    const { soprano, bass } = slice.notes;
    const tonicKey = slice.chord ? primaryRootPositionKey(context, slice, 1) : undefined;
    const tonicLabel = !slice.chord || (!!tonicKey && keyEquals(key, tonicKey));
    if (!slice.completeSatb || !tonicLabel || !soprano || !bass ||
        !pitchClassEquals(soprano.pitch, root) || !pitchClassEquals(bass.pitch, root)) {
      return stable && slice.tick - arrival.tick >= beatTicks &&
        closesWithPlagalSupplement(context, transition, slice.tick, soundEnd);
    }
    const notes = Object.values(slice.notes) as AnalysisNote[];
    stable = notes.every(note => !note.nonChordToneRole &&
      [root, third, fifth].some(tone => pitchClassEquals(note.pitch, tone)),
    ) && notes.some(note => pitchClassEquals(note.pitch, third));
    if (!stable) {
      // A brief intervening ornament can leave the actual outer tonic held,
      // but the final sounding slice must again voice the tonic.
      surfaceTicks += slice.endTick - slice.tick;
      const attack = Math.max(...notes.map(note => note.startTick));
      const previous = context.sliceAt(slice.tick - 1);
      if (surfaceTicks > beatTicks / 2 || context.metric.positionAt(attack)?.role !== "subdivision" ||
          soprano.id !== previous?.notes.soprano?.id || bass.id !== previous?.notes.bass?.id) return false;
    }
  }
  return stable && soundEnd - arrival.tick >= beatTicks;
}

/** A narrow reading of Spasobin, ch. 16 §3. The voicing and its actual
 * closing context must support the exception to the contrary-octave rule. */
export function isCadentialContraryOctave(context: HarmonyRuleContext, transition: SliceTransition) {
  const { previous: source, current: arrival } = transition;
  if (!transition.contiguous || source.key.id !== arrival.key.id || !source.completeSatb || !arrival.completeSatb ||
      Object.values(source.notes).some(note => note?.nonChordToneRole) ||
      Object.values(arrival.notes).some(note => note?.nonChordToneRole || note?.startTick !== arrival.tick)) return false;
  for (const slice of [source, arrival]) {
    const lowest = toMidi(slice.notes.bass!.pitch);
    const highest = toMidi(slice.notes.soprano!.pitch);
    if ([slice.notes.alto!, slice.notes.tenor!].some(note => {
      const pitch = toMidi(note.pitch);
      return pitch < lowest || pitch > highest;
    })) return false;
  }
  const key = primaryRootPositionKey(context, arrival, 1);
  if (!key) return false;
  const dominantKey = primaryRootPositionKey(context, source, 5);
  if (!dominantKey || !keyEquals(key, dominantKey)) return false;
  const accent = context.metric.positionAt(arrival.tick);
  if (!accent || accent.level < 2 ||
      context.metric.compare(accent, context.metric.positionAt(source.tick)) !== "stronger") return false;
  const beatTicks = context.analysis.metricTimeline.measures[accent.measureNumber - 1]?.beatLength;
  if (!beatTicks) return false;

  const [root, leading, , seventh] = chordToneSpellings(scaleDegreePitchClass(key, 5), "dominant7");
  for (const voice of ["soprano", "bass"] as const) {
    const before = source.notes[voice]!;
    const after = arrival.notes[voice]!;
    const steps = Math.abs(writtenInterval(before.pitch, after.pitch).diatonicSteps);
    if (!pitchClassEquals(before.pitch, root) || !pitchClassEquals(after.pitch, key.tonic) ||
        (steps !== 3 && steps !== 4)) return false;
  }
  const leadingVoice = pitchClassEquals(source.notes.alto!.pitch, leading) ? "alto" : "tenor";
  const seventhVoice = leadingVoice === "alto" ? "tenor" : "alto";
  const leadingBefore = source.notes[leadingVoice]!;
  const leadingAfter = arrival.notes[leadingVoice]!;
  const seventhBefore = source.notes[seventhVoice]!;
  const seventhAfter = arrival.notes[seventhVoice]!;
  const leadingMotion = writtenInterval(leadingBefore.pitch, leadingAfter.pitch);
  const seventhMotion = writtenInterval(seventhBefore.pitch, seventhAfter.pitch);
  if (!pitchClassEquals(leadingBefore.pitch, leading) || !pitchClassEquals(leadingAfter.pitch, key.tonic) ||
      leadingMotion.diatonicSteps !== 1 || leadingMotion.semitones !== 1 ||
      !pitchClassEquals(seventhBefore.pitch, seventh) ||
      !pitchClassEquals(seventhAfter.pitch, scaleDegreePitchClass(key, 3)) ||
      seventhMotion.diatonicSteps !== -1 || seventhMotion.semitones >= 0 || !isWrittenStep(seventhMotion)) return false;
  return isPreparedSeventh(context, transition, seventhVoice) && tonicClosesScore(context, transition, key, beatTicks);
}
