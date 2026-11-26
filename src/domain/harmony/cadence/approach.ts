import { chordIdentityInversion } from "../../chordModel";
import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass } from "../../pitch";
import { tonalReading } from "../facts/localTonality";
import { spanEndpointSlice } from "../facts/span";
import type { PhraseSegment } from "../phrase";
import {
  connectionIsValid, isFifthDegreeDominant, isRootPosition, predominant, resolvesLeadingTone,
  sameKey, writtenBassMatches, type CadenceDetectionContext,
} from "./context";
import type { CadenceEvidence, CadenceSpanFacts } from "./model";

export interface DominantApproach {
  readonly path: readonly CadenceSpanFacts[];
  readonly evidence: readonly CadenceEvidence[];
}

export function dominantApproach(
  facts: readonly CadenceSpanFacts[],
  dominantIndex: number,
  evidenceForGap?: (left: CadenceSpanFacts, right: CadenceSpanFacts) => CadenceEvidence | undefined,
  canInclude?: (item: CadenceSpanFacts) => boolean,
): DominantApproach {
  let start = dominantIndex;
  const evidence: CadenceEvidence[] = [];
  while (start > 0) {
    const left = facts[start - 1], right = facts[start];
    if (canInclude?.(left) === false || (!isRootPosition(left) &&
        !(writtenBassMatches(left) && writtenBassMatches(right) && !isRootPosition(right))) ||
        !isFifthDegreeDominant(left) || !isFifthDegreeDominant(right)) break;
    if (!connectionIsValid(left, right)) {
      if (left.span.toTick >= right.span.fromTick || !sameKey(left.key, right.key) ||
          left.interpretationStatus !== "resolved" || right.interpretationStatus !== "resolved") break;
      const gap = evidenceForGap?.(left, right);
      if (!gap) break;
      evidence.unshift(gap);
    }
    start--;
  }
  // A prepared dominant can change inversion and return to root position.
  // Reopen that link only if the contiguous run has a witnessed K46 head.
  if (start > 0 && !isRootPosition(facts[start - 1]) && isFifthDegreeDominant(facts[start])) {
    let head = start;
    while (head > 0 && isFifthDegreeDominant(facts[head - 1]) && writtenBassMatches(facts[head - 1]) &&
        canInclude?.(facts[head - 1]) !== false && !facts[head].hardBoundaryBefore &&
        connectionIsValid(facts[head - 1], facts[head])) head--;
    const k = facts[head - 1];
    if (head < start && k?.isCadential64 && writtenBassMatches(k) && isRootPosition(facts[head]) &&
        writtenBassMatches(facts[start]) && canInclude?.(k) !== false && !facts[head].hardBoundaryBefore &&
        connectionIsValid(k, facts[head])) start = head;
  }
  const preparation = facts[start - 1];
  if (preparation?.isCadential64 && canInclude?.(preparation) !== false &&
      connectionIsValid(preparation, facts[start])) start--;
  return { path: facts.slice(start, dominantIndex + 1), evidence };
}

export function beginsInsideManualCut(phrase: PhraseSegment, item: CadenceSpanFacts) {
  return (phrase.startBoundary?.source === "manual" || phrase.startBoundary?.locked) && item.span.fromTick === phrase.fromTick &&
    !item.boundarySlice?.attackVoiceIds.length;
}

// An inverted V before the terminal dominant belongs to the approach only
// when the applied leading tone actually arrives on its root in the same part.
function appliedPreparation(
  facts: readonly CadenceSpanFacts[], start: number, context: CadenceDetectionContext, phrase: PhraseSegment,
) {
  let entry = start;
  const inverted = facts[start - 1];
  if (inverted && isFifthDegreeDominant(inverted) && !isRootPosition(inverted) && writtenBassMatches(inverted) &&
      connectionIsValid(inverted, facts[start]) && !facts[start].hardBoundaryBefore) entry--;
  const source = facts[entry - 1], target = facts[entry];
  if (!source?.chord || !target.chord || !target.boundarySlice || !isFifthDegreeDominant(target) ||
      !writtenBassMatches(target) || beginsInsideManualCut(phrase, source) || source.span.status !== "complete" ||
      source.span.toTick !== target.span.fromTick || target.hardBoundaryBefore ||
      !sameKey(source.key, target.key) || !sameKey(source.writtenKey, target.writtenKey)) return;
  const applied = tonalReading(source.span.semantics, source.writtenKey).interpretation;
  if (applied?.appliedTarget?.degree !== 5 || applied.degreeAlteration) return;
  const root = target.chord.identity.root;
  const expected = applied.degree === 5 ? scaleDegreePitchClass(target.key, 2) :
    applied.degree === 7 ? leadingTonePitchClass({ tonic: root, mode: "major" }) : undefined;
  const last = spanEndpointSlice(context.analysis.slices, source.span, "last");
  if (expected && pitchClassEquals(source.chord.identity.root, expected) && last &&
      resolvesLeadingTone(last, target.boundarySlice, root)) return entry - 1;
}

function predominantRun(facts: readonly CadenceSpanFacts[], start: number, floor: number) {
  let index = start;
  while (index > 0 && predominant(facts[index - 1]) &&
      facts[index - 1].degree === facts[index].degree &&
      facts[index - 1].span.fromTick >= floor && connectionIsValid(facts[index - 1], facts[index])) index--;
  return facts.slice(index, start + 1);
}

export function halfApproach(
  facts: readonly CadenceSpanFacts[], index: number,
  context: CadenceDetectionContext, phrase: PhraseSegment,
): DominantApproach {
  const { gapEvidence, writtenBeatAt, measureFor } = context;
  const validStart = (item: CadenceSpanFacts) => !beginsInsideManualCut(phrase, item);
  const approach = dominantApproach(facts, index, gapEvidence, validStart);
  const first = approach.path[0];
  const previousIndex = index - approach.path.length;
  const previous = facts[previousIndex];
  const terminal = facts[index];
  const beat = writtenBeatAt(first.span.fromTick);
  if (!previous || !beat || first.isCadential64 || !isFifthDegreeDominant(first) || !validStart(previous)) return approach;
  const appliedIndex = appliedPreparation(facts, previousIndex + 1, context, phrase);
  if (appliedIndex !== undefined) {
    const applied = facts[appliedIndex];
    const diatonic = facts[appliedIndex - 1];
    const preparation = diatonic && validStart(diatonic) && predominant(diatonic) && diatonic.chord &&
      !applied.hardBoundaryBefore && diatonic.span.toTick === applied.span.fromTick && sameKey(diatonic.key, applied.key) &&
      pitchClassEquals(diatonic.chord.identity.root, applied.chord!.identity.root) ? appliedIndex - 1 : appliedIndex;
    return { ...approach, path: facts.slice(preparation, index + 1) };
  }
  if (!connectionIsValid(previous, first)) return approach;
  const bar = measureFor(first.span.fromTick);
  const arrivalLength = terminal.span.toTick - first.span.fromTick;
  if (previous.span.semantics?.cadenceRole === "pedal64") {
    const anchor = facts[previousIndex - 1];
    const heldBass = anchor?.boundarySlice?.notes.bass;
    const middleBass = previous.boundarySlice?.notes.bass;
    const returnBass = first.boundarySlice?.notes.bass;
    if (anchor && validStart(anchor) && isFifthDegreeDominant(anchor) && isRootPosition(anchor) &&
        connectionIsValid(anchor, previous) && heldBass && middleBass && returnBass &&
        pitchClassEquals(heldBass.pitch, middleBass.pitch) && pitchClassEquals(middleBass.pitch, returnBass.pitch) &&
        heldBass.pitch.octave === middleBass.pitch.octave && middleBass.pitch.octave === returnBass.pitch.octave) {
      return { ...approach, path: [anchor, previous, ...approach.path] };
    }
  }
  if (arrivalLength < beat || !isRootPosition(first) || !writtenBassMatches(first)) return approach;
  const floor = Math.max(phrase.fromTick, (bar?.startTick ?? first.span.fromTick) -
    (bar ? bar.endTick - bar.startTick : beat * 2));
  if (predominant(previous) && previous.span.fromTick >= floor &&
      (previous.degree !== 2 || isRootPosition(terminal) || arrivalLength <= 2 * beat))
    return { ...approach, path: [...predominantRun(facts, previousIndex, floor).filter(validStart), ...approach.path] };
  const startsRevoicedTonic = previous.isTonic && writtenBassMatches(previous) &&
    (previousIndex > 0 && facts[previousIndex - 1].isTonic ||
      previous.span.fromTick === measureFor(previous.span.fromTick)?.startTick);
  if (startsRevoicedTonic && previous.span.toTick - previous.span.fromTick <= beat &&
      arrivalLength >= 2 * beat && isRootPosition(terminal))
    return { ...approach, path: [previous, ...approach.path] };
  return approach;
}

export function fullApproach(
  facts: readonly CadenceSpanFacts[],
  dominantIndex: number,
  tonic: CadenceSpanFacts,
  context: CadenceDetectionContext,
  phrase: PhraseSegment,
  approach: DominantApproach,
) {
  if (approach.evidence.length) return approach;
  const first = approach.path[0];
  const measure = context.measureFor(facts[dominantIndex].span.fromTick);
  const preparationIndex = dominantIndex - approach.path.length;
  if (isFifthDegreeDominant(first) && connectionIsValid(facts[dominantIndex], tonic)) {
    const applied = appliedPreparation(facts, preparationIndex + 1, context, phrase);
    if (applied !== undefined) {
      const entry = facts[applied + 1], source = facts[applied], pre = facts[applied - 1];
      // A root-position V can start a new cadential bar on its own. Include
      // the applied chord when a lengthened predominant contracts into it.
      const prepared = pre && predominant(pre) && pre.span.toTick === source.span.fromTick &&
        sameKey(pre.key, source.key) && !source.hardBoundaryBefore &&
        pre.span.toTick - pre.span.fromTick > source.span.toTick - source.span.fromTick;
      if (!isRootPosition(entry) || prepared) return { ...approach, path: facts.slice(applied, dominantIndex + 1) };
    }
  }
  const subdominant = facts[preparationIndex];
  if (measure && subdominant && !beginsInsideManualCut(phrase, subdominant) &&
      !first.hardBoundaryBefore && predominant(subdominant) && isFifthDegreeDominant(first) &&
      connectionIsValid(subdominant, first) && connectionIsValid(facts[dominantIndex], tonic)) {
    const approachLength = tonic.span.fromTick - first.span.fromTick;
    const prepLength = subdominant.span.toTick - subdominant.span.fromTick;
    const prior = facts[preparationIndex - 1];
    const leavesTonic = prior?.isTonic && prior.chord && chordIdentityInversion(prior.chord.identity) <= 1 &&
      prior.span.toTick === subdominant.span.fromTick && prior.span.toTick - prior.span.fromTick <= prepLength;
    const withinCadentialBar = subdominant.span.fromTick >= measure.startTick &&
      tonic.span.fromTick === measure.endTick && (prepLength > approachLength ||
        (prepLength === approachLength && subdominant.span.fromTick === measure.startTick &&
          subdominant.degree === 4 && leavesTonic && isRootPosition(first) && writtenBassMatches(first)));
    const acrossCadentialBar = first.span.fromTick === measure.startTick &&
      tonic.span.fromTick <= measure.endTick && prepLength > approachLength &&
      prepLength <= (measure.endTick - measure.startTick) && isRootPosition(first) &&
      subdominant.degree === 2;
    if (withinCadentialBar || acrossCadentialBar) {
      const floor = withinCadentialBar ? measure.startTick : subdominant.span.fromTick;
      return { ...approach, path: [...predominantRun(facts, preparationIndex, floor), ...approach.path] };
    }
  }
  return approach;
}
