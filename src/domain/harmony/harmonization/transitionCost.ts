import type { MelodySlice } from "./melodyGrid";
import type { HarmonizationGivenVoice, HarmonizationRelaxedLevel } from "./types";
import { type HarmonizationChord, type Voicing, type WrittenNote } from "./vocabulary";

export interface Choice {
  index: number;
  chord: HarmonizationChord;
  voicing: Voicing;
  ornament: boolean;
  score: number;
}

export interface Obligations {
  entryLevel: number;
  bassDirection: number;
  pedalOrigin?: string;
  sopranoHeldTicks: number;
}

export interface TransitionState {
  choice: Choice;
  previous?: TransitionState;
  obligations: Obligations;
}

const REJECT = Number.NEGATIVE_INFINITY;
const OUTER_PAIR = 1 << 2;

function movingPairs(voices: number) {
  return (voices & 1 ? voices >> 1 : 0) |
    (voices & 2 ? (voices & 12) << 1 : 0) | (voices & 4 ? (voices & 8) << 2 : 0);
}

function stepDirection(from: WrittenNote, to: WrittenNote) {
  const distance = to.midi - from.midi;
  return Math.abs(to.diatonic - from.diatonic) === 1 && Math.abs(distance) <= 2
    ? Math.sign(distance) : 0;
}

export function bassStep(from: Choice, to: Choice) {
  return stepDirection(from.voicing.notes[3], to.voicing.notes[3]);
}

function isTonic(chord: HarmonizationChord) {
  return chord.degree === 1 && chord.family === "tonic" && !chord.applied;
}

function isDominant(chord: HarmonizationChord) {
  return chord.degree === 5 && chord.family === "dominant" && !chord.applied;
}

function isRootDominant(chord: HarmonizationChord) {
  return isDominant(chord) && chord.inversion === 0;
}

export function scoreChoice(choice: Choice, slice: MelodySlice) {
  const { chord, voicing } = choice;
  let score = chord.weight - voicing.penalty;
  const cadence = slice.cadence;
  if (slice.phraseStart && isTonic(chord) && chord.inversion === 0) score += 5;
  if (!cadence) return score;
  if (cadence.stage === "approach") {
    if (chord.role === "cadential64") score += 16;
    if (chord.family === "subdominant" && !chord.role) score += 2;
  } else if (cadence.zone === "medial-cadence") {
    if (isRootDominant(chord)) score += chord.tones.length === 3 ? 11 : 6;
  } else if (cadence.stage === "dominant") {
    if (isRootDominant(chord)) score += chord.tones.length === 4 ? 15 : 8;
  } else if (isTonic(chord) && chord.inversion === 0) {
    score += cadence.stage === "landing" ? 16 : 7;
    if (voicing.notes[0].tone === 0) score += cadence.stage === "landing" ? 8 : 2;
  }
  return score;
}

export function scoreTransition(
  state: TransitionState,
  current: Choice,
  from: MelodySlice,
  to: MelodySlice,
  givenVoice: HarmonizationGivenVoice,
  level: HarmonizationRelaxedLevel,
) {
  const prior = state.choice;
  const left = prior.chord;
  const right = current.chord;
  const a = prior.voicing.notes;
  const b = current.voicing.notes;
  const ds = b[0].midi - a[0].midi;
  const da = b[1].midi - a[1].midi;
  const dt = b[2].midi - a[2].midi;
  const db = b[3].midi - a[3].midi;
  const strict = level < 2;
  const sameKey = from.key === to.key;
  const sameChord = sameKey && left.signature === right.signature;
  const contiguous = from.endTick === to.tick;
  let score = 0;

  if (!contiguous) {
    return ((left.role || prior.ornament) && strict && !left.locked) || current.ornament ? REJECT : 0;
  }

  const commonPerfect = prior.voicing.perfectMask & current.voicing.perfectMask;
  if (commonPerfect) {
    const moving = (ds !== 0 ? 1 : 0) | (da !== 0 ? 2 : 0) | (dt !== 0 ? 4 : 0) | (db !== 0 ? 8 : 0);
    const pairs = movingPairs(moving);
    if (commonPerfect & (pairs | (pairs << 6))) {
      if (strict) return REJECT;
      score -= 140;
    }
  }
  const unequalFifths = prior.voicing.diminishedFifthMask & (current.voicing.perfectMask >> 6);
  if (unequalFifths) {
    const rising = (ds > 0 ? 1 : 0) | (da > 0 ? 2 : 0) | (dt > 0 ? 4 : 0) | (db > 0 ? 8 : 0);
    const falling = (ds < 0 ? 1 : 0) | (da < 0 ? 2 : 0) | (dt < 0 ? 4 : 0) | (db < 0 ? 8 : 0);
    const similar = unequalFifths & (movingPairs(rising) | movingPairs(falling));
    if (similar & OUTER_PAIR) {
      if (strict) return REJECT;
      score -= 140;
    }
    if ((similar & ~OUTER_PAIR) && bassStep(prior, current) !== 1) score -= 7;
  }

  if (b[0].midi < a[1].midi || b[1].midi > a[0].midi ||
    b[1].midi < a[2].midi || b[2].midi > a[1].midi ||
    b[2].midi < a[3].midi || b[3].midi > a[2].midi) {
    if (strict) return REJECT;
    score -= 10;
  }

  const prePrevious = state.previous?.choice.voicing.notes;
  for (let voice = 0; voice < 4; voice++) {
    const motion = b[voice].midi - a[voice].midi;
    const distance = Math.abs(motion);
    const written = Math.abs(b[voice].diatonic - a[voice].diatonic);
    const irregular = (written === 1 && distance >= 3) ||
      ((written === 3 || written === 4) && distance === 6) || (written === 3 && distance === 4);
    if (distance > 12 || irregular) {
      if (strict) return REJECT;
      score -= distance > 12 ? 140 : 13;
    }
    score += distance === 0 ? 0.9 : distance <= 2 ? (voice === 1 || voice === 2 ? 0.7 : 0.4)
      : -distance * (voice === 3 ? 0.15 : 0.29);
    if (prePrevious && motion) {
      const into = a[voice].midi - prePrevious[voice].midi;
      if (Math.abs(into) >= 7 && (into * motion >= 0 || distance > 2)) score -= voice === 3 ? 0.8 : 1.5;
    }
  }

  if (sameKey) {
    const finalHold = to.cadence?.zone === "final-authentic" && to.cadence.stage === "hold";
    if (!left.role && state.obligations.entryLevel < 2 && to.metricLevel > state.obligations.entryLevel &&
      !finalHold && !left.locked && !right.locked) {
      if (sameChord && strict) return REJECT;
      if (left.rootSignature === right.rootSignature && left.applied === right.applied && !right.role)
        score -= 9;
    }

    if (left.role === "cadential64" && !(left.locked && sameChord)) {
      let valid = isRootDominant(right) && db === 0 && from.metricLevel > to.metricLevel;
      for (let voice = 0; voice < 3 && valid; voice++) {
        if (a[voice].tone === 0 || a[voice].tone === 1)
          valid = stepDirection(a[voice], b[voice]) === -1 && b[voice].tone === (a[voice].tone === 0 ? 1 : 2);
      }
      if (!valid) {
        if (strict) return REJECT;
        // A misplaced K46 with the wrong target produces an Error, unlike a voicing exception.
        score -= isRootDominant(right) && db === 0 ? 24 : 160;
      }
    }
    if (right.role === "passing64" && !bassStep(prior, current) && !right.locked) {
      if (strict) return REJECT;
      score -= 18;
    }
    if (left.role === "passing64" && (!state.obligations.bassDirection ||
      bassStep(prior, current) !== state.obligations.bassDirection)) {
      if (strict) return REJECT;
      score -= 18;
    }
    if ((right.role === "pedal64" && db !== 0 && !right.locked) ||
      (left.role === "pedal64" && (db !== 0 || state.obligations.pedalOrigin !== right.signature))) {
      if (strict) return REJECT;
      score -= 18;
    }
    if (!sameChord && (prior.ornament || current.ornament)) {
      if (strict) return REJECT;
      score -= 18;
    }
    if (left.tones.length === 4) {
      const retainsSeventh = left.rootSignature === right.rootSignature;
      for (let voice = 0; voice < 4; voice++) {
        if (a[voice].tone !== 3) continue;
        const step = stepDirection(a[voice], b[voice]);
        if (!retainsSeventh && step !== -1) {
          if (strict) return REJECT;
          score -= 16;
        }
        if (retainsSeventh && b[voice].tone === 0 && step === 1) {
          if (strict && voice === 3 && isRootDominant(right)) return REJECT;
          score -= 7;
        }
      }
    }
    if (left.family === "dominant" && left.role !== "cadential64" && !left.applied && isTonic(right)) {
      for (const voice of [0, 3] as const) {
        if (!a[voice].leading || (b[voice].tone === 0 && stepDirection(a[voice], b[voice]) === 1)) continue;
        if (strict) return REJECT;
        score -= 18;
      }
    }
    if (right.degree === 1 && right.inversion === 0 && current.voicing.present === 3 &&
      !((sameChord && prior.voicing.present === 3) || isRootDominant(left)) && !current.ornament) {
      if (strict) return REJECT;
      score -= 15;
    }
  }

  if (current.voicing.perfectMask & ((1 << 2) | (1 << 8))) {
    if (ds * db > 0 && Math.abs(ds) > 2) score -= level === 0 ? 5 : 2;
  }
  if (ds * db < 0) score += 1.4;
  if (ds && ds * da > 0 && ds * dt > 0 && ds * db > 0) score -= 3;

  if (givenVoice === "bass") {
    if (ds === 0 && state.obligations.sopranoHeldTicks >= 2 * to.beatLength)
      score -= to.cadence?.stage === "hold" ? 0 : 3.3;
    if (Math.abs(ds) > 0 && Math.abs(ds) <= 2) score += 2;
    if (prePrevious && (a[0].midi - prePrevious[0].midi) * ds < 0 && Math.abs(ds) <= 3) score += 0.8;
  }

  if (sameChord) {
    if (to.cadence?.stage === "hold") score += 8;
    else score += to.metricLevel >= 2 ? -1 : 0.6;
  } else {
    score += to.metricLevel >= 2 ? 1.3 : to.metricLevel === 0 ? -3.7 : -0.25;
    if (left.family === "tonic" && right.family === "subdominant") score += 1.2;
    if (left.family === "subdominant" && isDominant(right)) score += 2.4;
    if (left.family === "dominant" && isTonic(right)) score += 2.6;
    if (left.family === "dominant" && right.family === "subdominant" && !to.phraseStart) score -= 6;
    if (left.family === "dominant" && !to.phraseStart && right.role !== "cadential64" &&
      !b.some(note => note.leading)) {
      for (let voice = 0; voice < 4; voice++) {
        if (a[voice].leading && !b[voice].leading && stepDirection(a[voice], b[voice]) !== 1 &&
          !((voice === 1 || voice === 2) && isTonic(right) && b[voice].tone === 2)) score -= 4;
      }
    }
    if ((isTonic(left) && right.degree === 6) || (left.degree === 6 && right.degree === 4)) score += 1.6;
    if (to.cadence?.stage === "landing" && to.cadence.zone === "final-authentic" &&
      isRootDominant(left) && isTonic(right) && right.inversion === 0) score += 20;
    if (left.role === "cadential64" && isRootDominant(right)) score += right.tones.length === 4 ? 7 : 4;
  }
  return score;
}
