import {
  chordIdentityInversion, chordIdentityToneSpellings, harmonySemanticsConfidence, primaryHarmonyInterpretation,
  type ChordIdentity,
} from "../../chordModel";
import { isWrittenStep, pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval, type SpelledPitchClass } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import type { AnalysisSlice } from "../analysis";
import { soundsCompleteWrittenChord } from "../writtenNeighbors";
import type { CadenceEvidence, CadenceSpanFacts } from "./types";

const inner = ["alto", "tenor"] as const;

function plainChord(facts: CadenceSpanFacts, root: SpelledPitchClass, quality: "minor" | "dominant7", inversion: number) {
  const identity = facts.chord?.identity;
  const structure = identity?.structure;
  return identity && structure?.kind === "tertian" && structure.quality === quality &&
    !structure.extensions.length && !structure.alterations.length && pitchClassEquals(identity.root, root) &&
    chordIdentityInversion(identity) === inversion ? identity : undefined;
}

function writtenVoicing(slice: AnalysisSlice, identity: ChordIdentity, allowOmittedFifth: boolean) {
  if (!slice.completeSatb) return false;
  const notes = VOICE_ORDER.map(voice => slice.notes[voice]!);
  const bass = slice.notes.bass!, soprano = slice.notes.soprano!;
  const floor = toMidi(bass.pitch), ceiling = toMidi(soprano.pitch);
  if (notes.some(note => toMidi(note.pitch) < floor || toMidi(note.pitch) > ceiling)) return false;
  if (soundsCompleteWrittenChord(identity, notes, bass)) return true;
  if (!allowOmittedFifth) return false;
  const [root, third, , seventh] = chordIdentityToneSpellings(identity);
  return pitchClassEquals(bass.pitch, identity.bass) && notes.every(note => !note.nonChordToneRole &&
    [root, third, seventh].some(tone => tone && pitchClassEquals(note.pitch, tone))) &&
    notes.filter(note => pitchClassEquals(note.pitch, root)).length === (seventh ? 2 : 3) &&
    notes.some(note => pitchClassEquals(note.pitch, third)) &&
    (!seventh || notes.some(note => pitchClassEquals(note.pitch, seventh)));
}

function resolvedSource(dominant: ChordIdentity, before: AnalysisSlice, landing: AnalysisSlice, tonic: ChordIdentity) {
  if (!writtenVoicing(before, dominant, false) ||
      !writtenVoicing(landing, tonic, true) ||
      VOICE_ORDER.some(voice => landing.notes[voice]!.startTick !== landing.tick)) return false;
  const [, leading, , seventh] = chordIdentityToneSpellings(dominant);
  const [root, third] = chordIdentityToneSpellings(tonic);
  const bass = writtenInterval(before.notes.bass!.pitch, landing.notes.bass!.pitch);
  return ((bass.diatonicSteps === 3 && bass.semitones === 5) ||
          (bass.diatonicSteps === -4 && bass.semitones === -7)) &&
    (["soprano", ...inner] as const).every(voice => {
      const old = before.notes[voice]!, next = landing.notes[voice]!;
      const motion = writtenInterval(old.pitch, next.pitch);
      if (pitchClassEquals(old.pitch, leading)) {
        return pitchClassEquals(next.pitch, root) && motion.diatonicSteps === 1 && motion.semitones === 1;
      }
      return !pitchClassEquals(old.pitch, seventh) ||
        (pitchClassEquals(next.pitch, third) && motion.diatonicSteps === -1 && motion.semitones === -2);
    });
}

/** A single terminal tonic articulation contains the local V7/iv–iv–i
 * extension under the same written outside notes (Spasobin §48.2–6). */
export function closingTonicPedalEvidence(
  dominant: CadenceSpanFacts,
  arrival: CadenceSpanFacts,
  applied: CadenceSpanFacts,
  subdominant: CadenceSpanFacts,
  terminal: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  beatTicks: number,
): CadenceEvidence | undefined {
  const key = arrival.key;
  const sequence = [dominant, arrival, applied, subdominant, terminal];
  if (key.mode !== "minor" || !arrival.isTonic || !terminal.isTonic || subdominant.degree !== 4 ||
      !subdominant.isSubdominant || applied.span.status !== "complete" ||
      [applied, subdominant].some(item => item.span.toTick - item.span.fromTick > beatTicks) ||
      sequence.some((item, i) => item.key.mode !== key.mode || !pitchClassEquals(item.key.tonic, key.tonic) ||
        (i > 0 && sequence[i - 1].span.toTick !== item.span.fromTick))) return;
  const semantics = applied.span.semantics;
  if (!semantics || !["certain", "probable"].includes(harmonySemanticsConfidence(semantics))) return;
  const meaning = primaryHarmonyInterpretation(semantics);
  if (meaning.degree !== 5 || meaning.degreeAlteration !== 0 || meaning.appliedTarget?.degree !== 4 ||
      meaning.designation?.kind !== "applied-dominant") return;

  const root = key.tonic, fourth = scaleDegreePitchClass(key, 4);
  const d = plainChord(dominant, scaleDegreePitchClass(key, 5), "dominant7", 0);
  const t = plainChord(arrival, root, "minor", 0);
  const dOfS = plainChord(applied, root, "dominant7", 0);
  const s = plainChord(subdominant, fourth, "minor", 2);
  const end = plainChord(terminal, root, "minor", 0);
  const before = slices[dominant.span.sliceIndices.at(-1)!];
  const start = arrival.boundarySlice, source = applied.boundarySlice,
    target = subdominant.boundarySlice, finish = terminal.boundarySlice;
  if (!d || !t || !dOfS || !s || !end || !before?.completeSatb || !start?.completeSatb ||
      !source?.completeSatb || !target?.completeSatb || !finish?.completeSatb ||
      before.endTick !== start.tick || !resolvedSource(d, before, start, t)) return;
  const bass = start.notes.bass!, soprano = start.notes.soprano!;
  if (!pitchClassEquals(soprano.pitch, root) ||
      [bass, soprano].some(note => note.startTick + note.durationTicks !== terminal.span.toTick)) return;

  const voicings = [[arrival, t, true], [applied, dOfS, true], [subdominant, s, false], [terminal, end, false]] as const;
  for (const [facts, identity, allowOmittedFifth] of voicings) {
    for (const index of facts.span.sliceIndices) {
      const part = slices[index];
      if (part.key.id !== before.key.id || part.notes.bass?.id !== bass.id || part.notes.soprano?.id !== soprano.id ||
          !writtenVoicing(part, identity, allowOmittedFifth)) return;
    }
  }

  const [, appliedLeading, , appliedSeventh] = chordIdentityToneSpellings(dOfS);
  const [, subdominantThird] = chordIdentityToneSpellings(s);
  const resolvesInsidePedal = inner.every(voice => {
    const old = source.notes[voice]!, middle = target.notes[voice]!, next = finish.notes[voice]!;
    const into = writtenInterval(old.pitch, middle.pitch);
    const out = writtenInterval(middle.pitch, next.pitch);
    return old.startTick === source.tick && middle.startTick === target.tick && next.startTick === finish.tick &&
      out.diatonicSteps === -1 && isWrittenStep(out) &&
      ((pitchClassEquals(old.pitch, appliedLeading) && pitchClassEquals(middle.pitch, fourth) &&
        into.diatonicSteps === 1 && into.semitones === 1) ||
       (pitchClassEquals(old.pitch, appliedSeventh) && pitchClassEquals(middle.pitch, subdominantThird) &&
        into.diatonicSteps === -1 && into.semitones === -2));
  });
  if (!resolvesInsidePedal) return;
  return {
    code: "closing-tonic-pedal",
    value: "落主后两个外声部持续同一主音，内声经下属回主至共同释放",
    refs: [bass.id, soprano.id, ...inner.flatMap(voice =>
      [source.notes[voice]!.id, target.notes[voice]!.id, finish.notes[voice]!.id])],
  };
}
