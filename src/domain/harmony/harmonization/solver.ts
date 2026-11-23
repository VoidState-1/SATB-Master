import { pitchClassEquals, serializeSpelledPitch } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import type { MelodyGrid, MelodySlice } from "./melodyGrid";
import { bassStep, scoreChoice, scoreTransition, type Choice, type TransitionState } from "./transitionCost";
import type { HarmonizationRelaxedLevel, HarmonizationStyle } from "./types";
import { buildVocabulary, chromaticVocabulary, enumerateVoicings, lockedVocabulary } from "./vocabulary";

const BEAM_WIDTH = 56;
const VOICINGS_PER_CHORD = 14;

interface SearchState extends TransitionState {
  previous?: SearchState;
  score: number;
  harmonyHash: number;
}

export interface HarmonizationPath {
  choices: Choice[];
  score: number;
  relaxedLevel: HarmonizationRelaxedLevel;
}

function choicesForGrid(grid: MelodyGrid, style: HarmonizationStyle, level: HarmonizationRelaxedLevel) {
  const vocabulary = new Map<MelodySlice["key"], ReturnType<typeof buildVocabulary>>();
  const voicings = new Map<string, Omit<Choice, "index" | "score">[]>();
  const chordIds = new Map<string, number>();
  const givenIndex = grid.givenVoice === "soprano" ? 0 : 3;

  return {
    ids: chordIds,
    at(slice: MelodySlice, index: number) {
      const canOmitFifth = slice.cadence?.zone === "final-authentic" &&
        (slice.cadence.stage === "landing" || slice.cadence.stage === "hold");
      const next = grid.slices[index + 1];
      const beforeNext = next && next.tick === slice.endTick && next.key === slice.key;
      const strongApproach = slice.metricLevel >= 2 && slice.cadence?.stage === "approach" &&
        beforeNext && next.metricLevel < slice.metricLevel;
      const normal = vocabulary.get(slice.key) ?? buildVocabulary(slice.key, style);
      vocabulary.set(slice.key, normal);
      const anchorPitches = VOICE_ORDER.map(voice => slice.lockedPitches[voice]);
      const cacheKey = JSON.stringify([slice.key.tick, slice.lockedChord?.id, canOmitFifth, Boolean(strongApproach),
        Boolean(beforeNext), slice.ornament, serializeSpelledPitch(slice.melody.pitch),
        ...anchorPitches.map(pitch => pitch && serializeSpelledPitch(pitch))]);
      let candidates = voicings.get(cacheKey);
      if (!candidates) {
        const chords = slice.lockedChord ? [lockedVocabulary(slice.lockedChord, slice.key)] : normal;
        const generated: Omit<Choice, "index" | "score">[] = [];
        const collect = (chord: (typeof chords)[number]) => {
          const entries = enumerateVoicings(chord, grid.givenVoice, slice.melody.pitch, slice.lockedPitches,
            level, { allowOmittedTonicFifth: canOmitFifth, ornament: Boolean(slice.ornament) });
          entries.sort((a, b) => a.penalty - b.penalty);
          for (const voicing of entries.slice(0, VOICINGS_PER_CHORD)) {
            generated.push({ chord, voicing, ornament: Boolean(slice.ornament && voicing.notes[givenIndex].tone < 0) });
          }
        };
        const pitch = slice.melody.pitch;
        let hasWrittenMember = false;
        for (const chord of chords) {
          if (!chord.locked && ((chord.role === "cadential64" && !strongApproach) ||
            (chord.role && !beforeNext))) continue;
          const matches = givenIndex === 3 ? pitchClassEquals(chord.identity.bass, pitch)
            : chord.tones.some(tone => pitchClassEquals(tone, pitch));
          if (!matches && !chord.locked && !slice.ornament) continue;
          hasWrittenMember ||= matches;
          collect(chord);
        }
        if (level === 2 && !slice.lockedChord && !hasWrittenMember)
          collect(chromaticVocabulary(pitch, slice.key));
        candidates = generated;
        voicings.set(cacheKey, candidates);
      }
      return candidates.map((candidate, candidateIndex) => {
        if (!chordIds.has(candidate.chord.signature)) chordIds.set(candidate.chord.signature, chordIds.size + 1);
        const choice = { ...candidate, index: candidateIndex, score: 0 };
        choice.score = scoreChoice(choice, slice);
        return choice;
      });
    },
  };
}

function search(grid: MelodyGrid, style: HarmonizationStyle, level: HarmonizationRelaxedLevel) {
  const rows = choicesForGrid(grid, style, level);
  let beam: SearchState[] = [];
  for (let index = 0; index < grid.slices.length; index++) {
    const slice = grid.slices[index];
    const previous = grid.slices[index - 1];
    const contiguous = previous?.endTick === slice.tick;
    const sameKey = previous?.key === slice.key;
    const best: SearchState[] = [];
    for (const choice of rows.at(slice, index)) {
      const { chord } = choice;
      if (level < 2 && !chord.locked && !contiguous &&
        (chord.role === "passing64" || chord.role === "pedal64" ||
          (chord.degree === 1 && chord.inversion === 0 && choice.voicing.present === 3))) continue;
      if (!contiguous && choice.ornament) continue;
      const chordId = rows.ids.get(chord.signature)!;
      if (!previous) {
        best.push({
          choice, score: choice.score, harmonyHash: chordId,
          obligations: { entryLevel: slice.metricLevel, bassDirection: 0, sopranoHeldTicks: slice.durationTicks },
        });
        continue;
      }

      // Future hard constraints depend on how a passing or pedal six-four was entered
      // and on the strength at which a prolongation began.
      const byObligation = new Map<number | string, SearchState>();
      const keepFinalAlternatives = index >= grid.slices.length - 3;
      for (const state of beam) {
        const cost = scoreTransition(state, choice, previous, slice, grid.givenVoice, level);
        if (cost === Number.NEGATIVE_INFINITY) continue;
        const score = state.score + cost + choice.score;
        const sameChord = contiguous && sameKey && state.choice.chord.signature === chord.signature;
        const entryLevel = sameChord ? state.obligations.entryLevel : slice.metricLevel;
        const bassDirection = chord.role === "passing64" ? bassStep(state.choice, choice) : 0;
        const pedalOrigin = chord.role === "pedal64" && contiguous ? state.choice.chord.signature : undefined;
        const harmonyHash = Math.imul(state.harmonyHash, 31) + chordId | 0;
        const key = keepFinalAlternatives || pedalOrigin
          ? `${entryLevel}|${bassDirection}|${pedalOrigin ?? ""}|${keepFinalAlternatives ? harmonyHash : ""}`
          : entryLevel * 3 + bassDirection;
        const existing = byObligation.get(key);
        if (existing && existing.score >= score) continue;
        const sameSoprano = contiguous && choice.voicing.notes[0].midi === state.choice.voicing.notes[0].midi;
        byObligation.set(key, {
          choice, previous: state, score, harmonyHash,
          obligations: {
            entryLevel, bassDirection, pedalOrigin,
            sopranoHeldTicks: slice.durationTicks + (sameSoprano ? state.obligations.sopranoHeldTicks : 0),
          },
        });
      }
      if (keepFinalAlternatives && byObligation.size > 2) {
        best.push(...[...byObligation.values()].sort((a, b) => b.score - a.score).slice(0, 2));
      } else {
        best.push(...byObligation.values());
      }
    }

    if (!best.length) return [];
    best.sort((a, b) => b.score - a.score);
    if (index === grid.slices.length - 1) return best;
    beam = best.slice(0, BEAM_WIDTH);
  }
  return [];
}

function reconstruct(state: SearchState) {
  const choices: Choice[] = [];
  for (let current: SearchState | undefined = state; current; current = current.previous) {
    choices.push(current.choice);
  }
  return choices.reverse();
}

export function solveHarmonization(
  grid: MelodyGrid,
  style: HarmonizationStyle,
  limit: number,
  startLevel: HarmonizationRelaxedLevel = 0,
): HarmonizationPath[] {
  for (const level of [0, 1, 2] as const) {
    if (level < startLevel) continue;
    const states = search(grid, style, level);
    if (!states.length) continue;
    const seen = new Set<string>();
    const distinct: HarmonizationPath[] = [];
    for (const state of states) {
      const choices = reconstruct(state);
      const key = choices.map(choice => choice.chord.signature).join("\n");
      if (seen.has(key)) continue;
      seen.add(key);
      distinct.push({ choices, score: state.score, relaxedLevel: level });
      if (distinct.length >= 32) break;
    }
    if (distinct.length <= limit) return distinct;
    const chosen = [distinct.shift()!];
    while (chosen.length < limit) {
      let bestIndex = 0;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < distinct.length; index++) {
        const path = distinct[index];
        const distance = Math.min(...chosen.map(other => path.choices.reduce((total, choice, tick) =>
          total + Number(choice.chord.signature !== other.choices[tick].chord.signature), 0)));
        const score = path.score + Math.min(distance, 5) * 1.6;
        if (score > bestScore) {
          bestIndex = index;
          bestScore = score;
        }
      }
      chosen.push(distinct.splice(bestIndex, 1)[0]);
    }
    return chosen;
  }
  return [];
}
