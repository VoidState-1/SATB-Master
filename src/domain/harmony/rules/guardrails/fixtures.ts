import { voiceGuardrails } from "./fixturesVoice";
import { melodyGuardrails } from "./fixturesMelody";
import { chordGuardrails } from "./fixturesChord";
import { resolutionGuardrails } from "./fixturesResolution";
import { nonchordGuardrails } from "./fixturesNonchord";
import { functionRhythmGuardrails } from "./fixturesFunctionRhythm";

export const counterexampleGuardrails = [
  ...voiceGuardrails,
  ...melodyGuardrails,
  ...chordGuardrails,
  ...resolutionGuardrails,
  ...nonchordGuardrails,
  ...functionRhythmGuardrails,
];
