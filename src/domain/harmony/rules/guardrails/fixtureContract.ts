import { PPQ, type VoiceId } from "../../../project";
import type { HarmonyRuleId } from "../catalog";

type Part = "S" | "A" | "T" | "B" | "H";

export interface Score {
  readonly voices: Readonly<Record<Part, string>>;
  readonly key?: string;
  readonly annotations?: readonly string[];
}

// Indices count score tokens in the named part, starting at zero and ignoring barlines.
type Edit = readonly [part: Part, index: number, original: string, replacement: string];

export type ExpectedFinding = {
  readonly tick: number;
  readonly missing?: string;
  readonly noteEvidenceVoices?: readonly VoiceId[];
} & (
  { readonly voiceIds: readonly [VoiceId, ...VoiceId[]]; readonly chordTicks?: never }
  | { readonly voiceIds: readonly []; readonly chordTicks: readonly [number, ...number[]] }
);

interface Counterexample {
  readonly name: string;
  readonly edits: readonly Edit[];
  readonly expected: readonly ExpectedFinding[];
  readonly blindSkipReason?: string;
}

interface Pair {
  readonly name: string;
  readonly control: Score;
  readonly counterexamples?: readonly Counterexample[];
}

type EntryPoints = { readonly blind: true } | {
  readonly blind: false;
  readonly blindSkipReason: string;
};

export interface RuleGuardrail {
  readonly ruleId: HarmonyRuleId;
  readonly entryPoints: EntryPoints;
  readonly enableAt?: "warning";
  readonly pairs: readonly Pair[];
}

export function scoreText(score: Score, edits: readonly Edit[] = []): string {
  const rows = (["S", "A", "T", "B", "H"] as const).map(part => {
    const replacements = edits.filter(edit => edit[0] === part);
    let index = 0;
    const line = score.voices[part].replace(/[^\s|]+/g, token => {
      const tokenIndex = index++;
      const edit = replacements.find(([, position]) => position === tokenIndex);
      if (!edit) return token;
      const [, , before, after] = edit;
      if (before !== token || before === after) {
        throw new Error(`Invalid edit for ${part} token ${tokenIndex}: ${before} → ${after}`);
      }
      return after;
    });
    if (replacements.some(([, position]) => position < 0 || position >= index)) {
      throw new Error(`Invalid edit position for ${part}`);
    }
    return `  ${part}: | ${line} |`;
  });
  const lastBar = score.voices.H.split("|").length;
  const annotations = score.annotations?.length
    ? `\nannotations {\n  ${score.annotations.join("\n  ")}\n}`
    : "";
  return `satb 1\nkey ${score.key ?? "C major"}\nmeter 4/4\nbars 1..${lastBar} {\n${rows.join("\n")}\n}${annotations}`;
}

const beat = (fromStart: number) => fromStart * PPQ;
export const voices = (fromStart: number, ...voiceIds: [VoiceId, ...VoiceId[]]): ExpectedFinding =>
  ({ tick: beat(fromStart), voiceIds });
export const chords = (fromStart: number, firstChordBeat: number, ...otherChordBeats: number[]): ExpectedFinding =>
  ({ tick: beat(fromStart), voiceIds: [], chordTicks: [beat(firstChordBeat), ...otherChordBeats.map(beat)] });
export const blind = { blind: true } as const;
