import { chordIdentityEquals, chordIdentityEqualsWithoutBass, chordIdentityToneSpellings } from "../../chordModel";
import { keyDeclarationEquals, pitchClassEquals } from "../../pitch";
import { crossesWrittenBoundary, soundsWrittenEvent } from "../facts/ornamentalMotion";
import { canMaskHeldVoices, createStructuralVoicingReader, readSoundingTertianIdentity } from "../facts/writtenVoicing";
import { anchorForStructuralOrnament, candidateComparator, fitStructuralOrnament, structuralOrnamentTemplates } from "./candidates";
import { observationNotes, writtenFrame } from "./observations";
import { exactFit, hasCompleteWrittenTertianChord } from "./scoring";
import type { ChordInferenceCandidate, ChordInferenceObservation as Observation } from "./types";

type CandidateSet = readonly ChordInferenceCandidate[];

export function ornamentReadingKey(candidate: ChordInferenceCandidate) {
  return JSON.stringify([candidate.identity, candidate.semantics,
    Object.entries(candidate.fit.nonChordToneAssignments).sort()]);
}

/** Verify staggered same-voice paths without opening the vertical filters. */
export function recoverWrittenStructuralGaps(
  observations: readonly Observation[], sets: readonly CandidateSet[], structural: readonly CandidateSet[],
  ppq: number, boundaries: readonly number[], withheldStarts: ReadonlySet<number>,
): readonly CandidateSet[] {
  const frames = observations.map((part, index) => {
    const literal = withheldStarts.has(part.fromTick) ? undefined : readSoundingTertianIdentity(writtenFrame(part));
    return {
      ...writtenFrame(part), identities: [
        ...structural[index].map(candidate => candidate.identity), ...(literal ? [literal] : []),
      ],
    };
  });
  const byTick = new Map(observations.map(part => [part.fromTick, part]));
  const read = createStructuralVoicingReader(frames, boundaries, 2 * ppq);
  const templates = new Map<string, ReturnType<typeof structuralOrnamentTemplates>>();
  return sets.map((existing, index) => {
    const part = observations[index];
    const literal = hasCompleteWrittenTertianChord(part);
    const contested = literal || existing.some(c => c.confidence !== "low");
    if (!part.completeSatb || withheldStarts.has(part.fromTick) ||
        (contested && (!literal || !canMaskHeldVoices(frames[index], frames[index - 1]) ||
          observationNotes(part).some(({ note }) => note.nonChordToneRole)))) return existing;
    // A gap at an enharmonic exit is part of the specialized respelling and
    // augmented-sixth resolution problem, not free space to extend a chord.
    if ([sets[index - 1], sets[index + 1]].some(set => set?.some(candidate =>
      candidate.confidence !== "low" && (candidate.identity.structure.kind === "augmented-sixth" ||
        candidate.evidence.some(item => item.code === "written-enharmonic-identity"))))) return existing;

    const nearby = new Map<string, ChordInferenceCandidate>();
    for (const direction of [-1, 1]) {
      for (let i = index + direction; observations[i]; i += direction) {
        const frame = observations[i];
        if (Math.abs(frame.fromTick - part.fromTick) > 2 * ppq || withheldStarts.has(frame.fromTick) ||
            !keyDeclarationEquals(frame.key, part.key) ||
            crossesWrittenBoundary(boundaries, Math.min(frame.fromTick, part.fromTick), Math.max(frame.fromTick, part.fromTick))) break;
        for (const anchor of structural[i]) {
          const key = ornamentReadingKey(anchor);
          if (!nearby.has(key)) nearby.set(key, anchor);
        }
      }
    }
    const fits: ChordInferenceCandidate[] = [];
    for (const anchor of nearby.values()) {
      const voicing = read(index, anchor.identity);
      if (!voicing) continue;
      const motions = voicing.voices.flatMap(item => item.ornament ? [item.ornament] : []);
      if (contested) {
        const candidate = fitStructuralOrnament(anchor, part, voicing);
        if (candidate) fits.push(candidate);
        continue;
      }
      // The existing specialized single-attack classifiers keep their
      // stricter metrical and chord-function tests. This pass fills a
      // genuinely overlapping or staggered texture.
      const staggered = motions.some(motion => motion.crossedSliceTicks
        .some(tick => motion.entryTick < tick && tick < motion.arrival.tick)) ||
        motions.some(motion => motion.entryTick !== motions[0].entryTick || motion.arrival.tick !== motions[0].arrival.tick);
      const mixed = motions.some(motion => motion.role !== motions[0].role);
      const prepared = motions.every(motion => motion.role === "suspension" || motion.role === "retardation") &&
        motions.every(motion => {
          const arrival = byTick.get(motion.arrival.tick);
          return arrival && voicing.voices.filter(item => !item.ornament &&
            soundsWrittenEvent(arrival.activeNotes, item.voice, item.sounding)).length >= 2;
        });
      const chromatic = motions.length > 0 && motions.every(motion => motion.role === "passing" &&
        [motion.departure.note, ...motion.ornaments].some((from, i) =>
          from.pitch.step === [...motion.ornaments, motion.arrival.note][i].pitch.step));
      const paired = motions.length === 2 && motions.every(motion => motion.role === "passing") &&
        !voicing.bass?.ornament && motions.every(motion => [motion.departure.tick, motion.arrival.tick].every(tick =>
          byTick.get(tick)?.bass?.id === part.bass?.id));
      const memberBassNeighbor = voicing.bass?.ornament?.role === "neighbor" &&
        chordIdentityToneSpellings(anchor.identity).some(tone => pitchClassEquals(tone, voicing.bass!.sounding.pitch)) &&
        motions.length === 2 && motions.every(motion => motion.role === "neighbor" &&
          [motion.departure.tick, motion.arrival.tick].every(tick => {
            const edge = byTick.get(tick);
            return edge && structural[edge.index].some(other => exactFit(other) && chordIdentityEquals(other.identity, anchor.identity)) &&
              voicing.voices.every(item => item.ornament || soundsWrittenEvent(edge.activeNotes, item.voice, item.sounding));
          }));
      if ((!staggered && !mixed && !prepared && !chromatic && !paired && !memberBassNeighbor) || anchor.functionalBaseId === "K46" ||
          [...nearby.values()].some(other => other.functionalBaseId === "K46" &&
            chordIdentityEquals(anchor.identity, other.identity))) continue;
      const bassOrnament = voicing.bass?.ornament;
      if (bassOrnament?.role === "retardation" ||
          (bassOrnament?.role === "suspension" && voicing.voices.filter(item => !item.ornament &&
            soundsWrittenEvent(byTick.get(bassOrnament.arrival.tick)?.activeNotes, item.voice, item.sounding)).length < 2)) continue;
      const candidate = fitStructuralOrnament(anchor, part, voicing);
      if (candidate) fits.push(candidate);
    }
    if (contested && (!fits.length || fits.some(c => !chordIdentityEquals(c.identity, fits[0].identity)))) return existing;
    if (fits.length) return fits.sort(candidateComparator);

    // When arrivals are staggered, no slice need sound the whole target
    // at once. Offer a catalogue hypothesis only if the sounding bass and
    // another member define the arrival and at least two parts have proofs.
    if (!part.bass || part.bass.nonChordToneRole) return existing;
    const key = `${part.key.tonic.step}:${part.key.tonic.alter}:${part.key.mode}`;
    let hypotheses = templates.get(key);
    if (!hypotheses) {
      hypotheses = structuralOrnamentTemplates(part);
      templates.set(key, hypotheses);
    }
    for (const { template, identity } of hypotheses) {
      if (!pitchClassEquals(part.bass.pitch, identity.bass)) continue;
      if ([...nearby.values()].some(other => other.functionalBaseId === "K46" &&
          chordIdentityEquals(other.identity, identity))) continue;
      const voicing = read(index, identity);
      if (!voicing || voicing.unresolved.length) continue;
      const revoicing = !voicing.bass?.ornament && [...nearby.values()].some(other =>
        other.functionalBaseId === template.baseId && !chordIdentityEquals(other.identity, identity) &&
        chordIdentityEqualsWithoutBass(other.identity, identity));
      const motions = voicing.voices.flatMap(item => item.ornament ? [item.ornament] : []);
      if (revoicing && motions.length && motions.every(motion =>
        (motion.role === "suspension" || motion.role === "retardation") &&
        voicing.voices.some(item => !item.ornament && item.voice !== "bass" &&
          soundsWrittenEvent(byTick.get(motion.arrival.tick)?.activeNotes, item.voice, item.sounding)))) {
        const anchor = anchorForStructuralOrnament(part, voicing, template);
        const candidate = anchor && fitStructuralOrnament(anchor, part, voicing);
        if (candidate) fits.push(candidate);
        continue;
      }
      if (voicing.missing.length) continue;
      const held = voicing.voices.filter(item => !item.ornament);
      // A held bass and another independent member can fix a staggered
      // arrival even when the vertical stack is never complete. Each
      // horizontal path must arrive while those actual events still sound.
      const ninth = existing.some(c => c.identity.structure.kind === "tertian" && c.identity.structure.extensions.includes(9));
      const horizontal = !ninth && motions.length > 0 && motions.every(motion => motion.role === "passing" || motion.role === "neighbor");
      if (horizontal && held.some(item => item.voice === "bass") && held.some(item => item.voice !== "bass" &&
          !pitchClassEquals(item.sounding.pitch, part.bass!.pitch)) && motions.every(motion =>
          held.every(item => soundsWrittenEvent(byTick.get(motion.arrival.tick)?.activeNotes, item.voice, item.sounding)) &&
          (motions.length === 2 || motion.ornaments.length > 1))) {
        const anchor = anchorForStructuralOrnament(part, voicing, template);
        const candidate = anchor && fitStructuralOrnament(anchor, part, voicing);
        if (candidate) fits.push(candidate);
        continue;
      }
      if (motions.length !== 2) continue;
      if (pitchClassEquals(held[0].sounding.pitch, held[1].sounding.pitch) ||
          !motions.some(motion => motion.role === "suspension" || motion.role === "retardation") ||
          motions[0].arrival.tick === motions[1].arrival.tick) continue;
      // The same retained bass must actually sound when both lines arrive.
      if (motions.some(motion => motion.arrival.tick >= part.bass!.startTick + part.bass!.durationTicks)) continue;
      const anchor = anchorForStructuralOrnament(part, voicing, template);
      const candidate = anchor && fitStructuralOrnament(anchor, part, voicing);
      if (candidate) fits.push(candidate);
    }
    return fits.length && fits.every(fit => chordIdentityEquals(fit.identity, fits[0].identity))
      ? fits.sort(candidateComparator) : existing;
  });
}
