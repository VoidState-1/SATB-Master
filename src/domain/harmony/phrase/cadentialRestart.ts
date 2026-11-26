import { chordIdentityInversion, chordIdentityToneSpellings, primaryHarmonyInterpretation } from "../../chordModel";
import { isWrittenStep, keyEquals, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval } from "../../pitch";
import type { ChordRegion } from "../../project/types";
import type { PhraseAnalysisInput, PhraseEvidence } from "./types";

interface RestartContext {
  project: PhraseAnalysisInput;
  previous: ChordRegion;
  terminal: ChordRegion;
  following?: ChordRegion;
  tick: number;
  beatLength: number;
  barLength: number;
  periodicDistance: number;
  tonicRestart: boolean;
  endsOnDominant: boolean;
  fromDominant: boolean;
  stableEnding: boolean;
  pickup: boolean;
  onBarline: boolean;
}

export function releasesRevoicedSubmediant(
  project: PhraseAnalysisInput, dominant: ChordRegion | undefined, arrival: ChordRegion | undefined,
  last: ChordRegion | undefined, next: ChordRegion | undefined, tick: number, beat: number,
) {
  if (!dominant?.semantics || !arrival?.semantics || !last?.semantics || !next?.semantics ||
      !pitchClassEquals(arrival.identity.root, last.identity.root) ||
      pitchClassEquals(last.identity.root, next.identity.root) || chordIdentityInversion(arrival.identity) !== 0 ||
      chordIdentityInversion(last.identity) !== 1 || chordIdentityInversion(dominant.identity) !== 0 ||
      tick - arrival.startTick < 2 * beat) return false;
  const vi = primaryHarmonyInterpretation(arrival.semantics);
  const revoiced = primaryHarmonyInterpretation(last.semantics);
  if (vi.degree !== 6 || revoiced.degree !== 6 || vi.appliedTarget || revoiced.appliedTarget ||
      vi.degreeAlteration || revoiced.degreeAlteration ||
      (vi.localKey && revoiced.localKey && !keyEquals(vi.localKey, revoiced.localKey))) return false;
  const tracks = project.satbTracks ?? [];
  const bass = tracks.find(track => track.id === "bass")?.notes;
  const from = bass?.find(note => note.startTick + note.durationTicks === arrival.startTick);
  const to = bass?.find(note => note.startTick === arrival.startTick);
  if (!from?.pitch || !to?.pitch || !pitchClassEquals(from.pitch, dominant.identity.root) ||
      !pitchClassEquals(to.pitch, arrival.identity.root)) return false;
  const into = writtenInterval(from.pitch, to.pitch);
  return isWrittenStep(into) && into.diatonicSteps === 1 && tracks.filter(track => track.id !== "bass" &&
    track.notes.some(note => note.startTick <= arrival.startTick && note.startTick + note.durationTicks === tick)).length >= 2;
}

/** Evaluate the release of the closing harmony, independently of its onset.
 * A continuing inner part is compatible with a new melodic attack. */
export function cadentialRestart({
  project, previous, terminal, following, tick, beatLength, barLength, periodicDistance,
  tonicRestart, endsOnDominant, fromDominant, stableEnding, pickup, onBarline,
}: RestartContext): PhraseEvidence | undefined {
  if (!previous.semantics || !terminal.semantics || !stableEnding ||
      terminal.startTick + terminal.durationTicks !== tick) return;
  const approach = primaryHarmonyInterpretation(previous.semantics);
  const arrival = primaryHarmonyInterpretation(terminal.semantics);
  if (approach.localKey && arrival.localKey && !keyEquals(approach.localKey, arrival.localKey)) return;
  const inversion = chordIdentityInversion(terminal.identity);
  const exactPeriod = periodicDistance > 0 && Number.isInteger(periodicDistance / 4);
  const periodicBar = periodicDistance >= 3 && Math.abs(periodicDistance - Math.round(periodicDistance / 4) * 4) < 1;
  const resolves = fromDominant && approach.degree === 5 && (arrival.degree === 1 || arrival.degree === 6) &&
    inversion <= (arrival.degree === 1 ? 1 : 0) && !arrival.degreeAlteration;
  if (!(endsOnDominant && tonicRestart && exactPeriod) && !resolves) return;
  const tonic = endsOnDominant ? following?.identity.root : arrival.degree === 1 ? terminal.identity.root : undefined;
  const dominantRoot = endsOnDominant ? terminal.identity.root : previous.identity.root;
  if (tonic && !pitchClassEquals(dominantRoot, scaleDegreePitchClass({ tonic, mode: "major" }, 5))) return;

  const soprano = project.satbTracks?.find(track => track.id === "soprano")?.notes;
  const release = soprano?.find(note => note.startTick + note.durationTicks === tick);
  const attack = soprano?.find(note => note.startTick === tick);
  if (!release?.pitch || !attack?.pitch ||
      !chordIdentityToneSpellings(terminal.identity).some(tone => pitchClassEquals(tone, release.pitch!))) return;
  const bass = project.satbTracks?.find(track => track.id === "bass")?.notes;
  const bassBefore = bass?.find(note => note.startTick < tick && note.startTick + note.durationTicks >= tick);
  if (!bassBefore?.pitch || !pitchClassEquals(bassBefore.pitch, terminal.identity.bass)) return;
  const changesPitch = !spelledPitchEquals(release.pitch, attack.pitch);
  const accelerates = attack.durationTicks < release.durationTicks;
  if (endsOnDominant) {
    if (!following) return;
    // A seventh added to a stable V can decorate its release. Require a
    // preceding root-position V and the written 5–4–3 bass into I6.
    const sustainedRoot = fromDominant && approach.degree === 5 && chordIdentityInversion(previous.identity) === 0 &&
      pitchClassEquals(previous.identity.root, terminal.identity.root);
    if (inversion !== 0) {
      const nextBass = bass?.find(note => note.startTick === tick);
      const rootBass = bass?.find(note => note.startTick < terminal.startTick &&
        note.startTick + note.durationTicks === terminal.startTick);
      if (inversion !== 3 || !sustainedRoot || !nextBass?.pitch || !rootBass?.pitch ||
          chordIdentityInversion(following.identity) !== 1 || !pitchClassEquals(rootBass.pitch, previous.identity.root) ||
          !pitchClassEquals(nextBass.pitch, following.identity.bass)) return;
      const steps = [writtenInterval(rootBass.pitch, bassBefore.pitch), writtenInterval(bassBefore.pitch, nextBass.pitch)];
      if (!steps.every(step => isWrittenStep(step) && step.diatonicSteps === -1)) return;
    }
    const length = terminal.durationTicks + (sustainedRoot ? previous.durationTicks : 0);
    if (length < barLength / 2 || release.durationTicks < beatLength ||
        !(release.durationTicks >= barLength / 2 || accelerates)) return;
  } else {
    const revoicesTonic = arrival.degree === 1 && tonicRestart;
    if (revoicesTonic && !(pickup && exactPeriod && inversion === 1 && following &&
        chordIdentityInversion(following.identity) === 0 && changesPitch)) return;
    if (following && pitchClassEquals(terminal.identity.root, following.identity.root) && !revoicesTonic) return;
    const lengthened = terminal.durationTicks > previous.durationTicks &&
      terminal.durationTicks > (following?.durationTicks ?? attack.durationTicks);
    const bassHold = bassBefore.startTick <= terminal.startTick &&
      bassBefore.startTick + bassBefore.durationTicks === tick;
    const sustained = terminal.durationTicks >= barLength / 2 &&
      (release.durationTicks >= beatLength || (bassHold && changesPitch));
    const melodicLeap = Math.abs(writtenInterval(release.pitch, attack.pitch).diatonicSteps) >= 2;
    const restartSupport = exactPeriod || (periodicBar && (melodicLeap ||
      terminal.durationTicks > barLength / 2 || (bassHold && !onBarline && changesPitch))) ||
      (periodicDistance >= 3 && pickup && terminal.durationTicks >= barLength * 0.75);
    if (inversion === 1 && !exactPeriod && terminal.durationTicks <= barLength / 2) return;
    if (!restartSupport || !sustained || !(changesPitch || accelerates) ||
        !(lengthened || (exactPeriod && (onBarline || pickup) && accelerates))) return;
  }
  return { code: "cadential-restart", value: "前一收束和声释放，外声在新的乐句节奏上重起",
    refs: [previous.id, terminal.id, ...(following ? [following.id] : [])] };
}
