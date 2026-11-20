import { chordIdentityInversion, chordIdentityToneSpellings } from "../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { ticksPerBeat, type MeasureInfo } from "../../time";
import type { AnalysisSlice, HarmonyAnalysis } from "../analysis";
import { bassStepsUpToSubmediant } from "./articulatedEnding";
import { sameDetachedRhythm, writtenAttack } from "./detachedAttacks";
import type { CadenceEvidence, CadenceSpanFacts } from "./types";

type Score = Pick<HarmonyAnalysis, "project" | "slices">;

// Compare the written parts up to the cadential preparation. Chord labels
// may divide identical notes differently on the two statements.
function reprisesOpening({ project }: Score, start: number, end: number, offset: number) {
  return project.satbTracks.every(track => {
    const window = (left: number, right: number) => track.notes
      .filter(n => n.startTick < right && left < n.startTick + n.durationTicks)
      .sort((a, b) => a.startTick - b.startTick);
    const original = window(start, end), reprise = window(start + offset, end + offset);
    const outer = track.voice === "soprano" || track.voice === "bass";
    return original.length > 0 && original.length === reprise.length &&
      (!outer || original.some(n => !spelledPitchEquals(n.pitch, original[0].pitch))) &&
      original.every((n, i) => n.startTick >= start && n.startTick + n.durationTicks <= end &&
        reprise[i].startTick === n.startTick + offset && reprise[i].durationTicks === n.durationTicks &&
        spelledPitchEquals(reprise[i].pitch, n.pitch));
  });
}

interface ConfirmedEnding {
  readonly preparation: CadenceSpanFacts;
  readonly dominant: CadenceSpanFacts;
  readonly arrival: AnalysisSlice;
  readonly tonic?: CadenceSpanFacts;
  readonly proof: CadenceEvidence;
}

// A template boundary can fall at a rest within the copied material or at the
// first preparation's release. A cut at V, VI or the start of a new clause stands.
function isInternalRest(score: Score, tick: number, opening: number, pre: AnalysisSlice, offset: number) {
  if (!(tick === pre.endTick || (opening < tick && tick < pre.tick) ||
      (opening + offset < tick && tick < pre.tick + offset))) return false;
  const rest = score.slices.find(s => s.tick === tick);
  const attack = rest && score.slices[rest.index - 1];
  return !!rest && !rest.chord && !Object.keys(rest.notes).length && !!attack?.notes.soprano && !!attack.notes.bass &&
    Object.values(attack.notes).length >= 3 && Object.values(attack.notes).every(n => n.startTick + n.durationTicks === tick);
}

/** Spasobin §20.7: the same opening reaches two cadential preparations.
 * Only the earlier dominant avoids the expected tonic. The caller has
 * already established the second, detached authentic ending. */
export function precedingDetachedDeception(
  score: Score, openingTick: number, facts: readonly CadenceSpanFacts[], ending: ConfirmedEnding,
  measureFor: (tick: number) => MeasureInfo | undefined, inferredCuts: readonly number[] = [],
) {
  const { preparation: laterPre, dominant: laterV, arrival: finalOnset, tonic } = ending;
  const key = tonic?.key ?? laterV.key;
  const opening = measureFor(openingTick);
  if (!opening || opening.startTick !== openingTick || !laterPre.chord || key.mode !== "major" ||
      score.project.meterEvents.some(e => openingTick < e.tick && e.tick < finalOnset.endTick) ||
      score.slices.some(s => openingTick <= s.tick && s.tick < finalOnset.endTick && s.key.id !== finalOnset.key.id)) return;
  const inKey = (f: CadenceSpanFacts) => f.interpretationStatus === "resolved" &&
    keyEquals(f.key, key) &&
    f.span.semantics?.interpretations.length === 1 && !f.span.semantics.alternatives?.length && !f.span.semantics?.mixture &&
    !f.span.semantics?.cadenceRole && !f.span.semantics?.pedalContext;
  if (!inKey(laterPre) || !inKey(laterV) || (tonic && !inKey(tonic))) return;
  let found: { dominant: CadenceSpanFacts; vi: CadenceSpanFacts; evidence: CadenceEvidence } | undefined;
  for (let i = 2; i < facts.length; i++) {
    const pre = facts[i - 2], dominant = facts[i - 1], vi = facts[i];
    if (!pre.isSubdominant || pre.degree !== laterPre.degree || !pre.chord ||
        !pitchClassEquals(pre.chord.identity.root, laterPre.chord.identity.root) ||
        !pitchClassEquals(pre.chord.identity.bass, laterPre.chord.identity.bass) ||
        !dominant.isDominant || dominant.degree !== 5 || vi.family !== "tonic" || vi.degree !== 6 ||
        ![pre, dominant, vi].every(inKey)) continue;
    const d = dominant.chord?.identity, t = vi.chord?.identity;
    if (!d || !t || d.structure.kind !== "tertian" || d.structure.quality !== "major" ||
        t.structure.kind !== "tertian" || t.structure.quality !== "minor" ||
        [d.structure, t.structure].some(s => s.extensions.length || s.alterations.length) ||
        chordIdentityInversion(d) !== 0 || chordIdentityInversion(t) !== 0 ||
        !pitchClassEquals(d.root, scaleDegreePitchClass(key, 5)) ||
        !pitchClassEquals(t.root, scaleDegreePitchClass(key, 6))) continue;

    const p = pre.boundarySlice, v = dominant.boundarySlice, arrival = vi.boundarySlice;
    const bar = measureFor(vi.span.fromTick);
    const offset = laterPre.span.fromTick - pre.span.fromTick;
    const restart = openingTick + offset;
    if (!bar || opening.endTick > pre.span.fromTick || bar.startTick !== vi.span.fromTick || measureFor(restart)?.startTick !== restart ||
        restart < vi.span.toTick || !p || !v || !arrival ||
        laterV.span.fromTick !== v.tick + offset || finalOnset.tick !== arrival.tick + offset ||
        laterPre.span.toTick !== p.endTick + offset || laterV.span.toTick !== v.endTick + offset ||
        !sameDetachedRhythm(p, v, arrival, score.slices, ticksPerBeat(score.project.ppq, bar.denominator)) ||
        !writtenAttack(pre, chordIdentityToneSpellings(pre.chord.identity)) ||
        !writtenAttack(dominant, chordIdentityToneSpellings(d)) || !writtenAttack(vi, chordIdentityToneSpellings(t))) continue;
    const leading = chordIdentityToneSpellings(d)[1];
    if (!bassStepsUpToSubmediant(v, arrival) || VOICE_ORDER.some(voice => {
      const before = v.notes[voice], after = arrival.notes[voice];
      if (!before || !after || !pitchClassEquals(before.pitch, leading)) return false;
      const motion = writtenInterval(before.pitch, after.pitch);
      return motion.diatonicSteps !== 1 || motion.semitones !== 1;
    })) continue;
    // After VI releases, a single-line pickup can lead into the reprise.
    // An intervening harmonic clause gives the return a different context.
    if (score.slices.some(s => vi.span.toTick <= s.tick && s.tick < restart &&
        (s.chord || Object.keys(s.notes).length > 1)) ||
        inferredCuts.some(tick => !isInternalRest(score, tick, openingTick, p, offset)) ||
        !reprisesOpening(score, openingTick, p.tick, offset)) continue;
    if (found) return;
    found = { dominant, vi, evidence: {
      code: "detached-deceptive-reprise", value: "前段属至六级，原材料重奏后以相同的顿奏节奏落主",
      refs: [pre.span.id, dominant.span.id, vi.span.id, ...(ending.proof.refs ?? [])],
    } };
  }
  return found;
}
