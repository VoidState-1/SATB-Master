import { isSupportedKeySignature, toMidi, type KeyLike, type SpelledPitch, type SpelledPitchClass } from "../pitch";
import { PPQ, type MeterDenominator } from "../project";
import type { MeasureInfo } from "../time";
import { fail, type SourceLocation } from "./types";

export function readPitchClass(text: string, location?: SourceLocation): SpelledPitchClass {
  const match = /^([A-G])([#b]{0,2})$/.exec(text);
  if (!match || (match[2].includes("#") && match[2].includes("b")))
    fail(`无效音名 ${text}；使用 C、F#、Bbb 等绝对拼写`, location);
  return { step: match[1] as SpelledPitchClass["step"], alter: (match[2].startsWith("b") ? -match[2].length : match[2].length) as SpelledPitchClass["alter"] };
}

export function readPitch(text: string, location?: SourceLocation): SpelledPitch {
  const match = /^([A-G][#b]{0,2})(-?\d+)$/.exec(text);
  if (!match) fail(`无效音高 ${text}；音名必须带八度，例如 E#4`, location);
  const pitch = { ...readPitchClass(match[1], location), octave: Number(match[2]) };
  if (toMidi(pitch) < 0 || toMidi(pitch) > 127) fail(`音高 ${text} 超出 MIDI 0–127`, location);
  return pitch;
}

export function pitchText(pitch: SpelledPitchClass & { octave?: number }) {
  return `${pitch.step}${pitch.alter < 0 ? "b".repeat(-pitch.alter) : "#".repeat(pitch.alter)}${pitch.octave ?? ""}`;
}

export function readKey(text: string, location?: SourceLocation): KeyLike {
  const match = /^([A-G][#b]{0,2})\s+(major|minor)$/.exec(text.trim());
  if (!match) fail(`无效调性 ${text}；使用 C major 或 F# minor`, location);
  const key: KeyLike = { tonic: readPitchClass(match[1], location), mode: match[2] as KeyLike["mode"] };
  if (!isSupportedKeySignature(key)) fail(`不支持的调号 ${text}`, location);
  return key;
}

export function readMeter(text: string, location?: SourceLocation) {
  const match = /^(\d+)\/(2|4|8|16)$/.exec(text);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 32) fail(`无效拍号 ${text}`, location);
  return { numerator: Number(match[1]), denominator: Number(match[2]) as MeterDenominator };
}

/** /4 = quarter, /4. = dotted quarter, /8*2/3 = triplet eighth; tN is exact ticks. */
export function durationTicks(text: string, location?: SourceLocation): number {
  if (/^t\d+$/.test(text)) {
    const value = Number(text.slice(1));
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  const match = /^(\d+)(\.{0,3})(?:\*(\d+)\/(\d+))?$/.exec(text.replace(/^1\//, ""));
  if (!match) fail(`无效时值 ${text}`, location);
  const dots = match[2].length;
  const numerator = PPQ * 4 * (2 ** (dots + 1) - 1) * Number(match[3] ?? 1);
  const denominator = Number(match[1]) * 2 ** dots * Number(match[4] ?? 1);
  const ticks = numerator / denominator;
  if (!Number.isSafeInteger(ticks) || ticks <= 0) fail(`时值 ${text} 无法精确表示为 PPQ=${PPQ} 的正整数 tick`, location);
  return ticks;
}

export function durationText(ticks: number) {
  for (const denominator of [1, 2, 4, 8, 16, 32, 64, 128]) {
    for (const dots of [0, 1, 2]) {
      const text = `${denominator}${".".repeat(dots)}`;
      if (PPQ * 4 / denominator * (2 ** (dots + 1) - 1) / 2 ** dots === ticks) return text;
    }
  }
  return `t${ticks}`;
}

export function positionTick(text: string, measures: readonly MeasureInfo[], location?: SourceLocation): number {
  const match = /^(\d+):(\d+)(?:\+(\d+)\/(\d+))?$/.exec(text);
  if (!match) fail(`无效位置 ${text}；使用 小节:拍 或 小节:拍+分数`, location);
  const number = Number(match[1]);
  const beat = Number(match[2]);
  const offset = match[3] === undefined ? 0 : Number(match[3]) / Number(match[4]);
  if (!Number.isFinite(offset) || offset < 0 || offset >= 1) fail(`位置 ${text} 的拍内偏移必须在 [0,1) 内`, location);
  if (number === measures.length + 1 && beat === 1 && offset === 0) return measures.at(-1)!.endTick;
  const measure = measures[number - 1];
  if (!measure || beat < 1 || beat > measure.numerator) fail(`位置 ${text} 超出小节或拍范围`, location);
  const tick = measure.startTick + (beat - 1 + offset) * PPQ * 4 / measure.denominator;
  if (!Number.isSafeInteger(tick) || tick >= measure.endTick) fail(`位置 ${text} 无法精确表示或超出小节`, location);
  return tick;
}

export function rangeTicks(text: string, measures: readonly MeasureInfo[], location?: SourceLocation): [number, number] {
  const match = /^\[([^,]+),([^\)]+)\)$/.exec(text);
  if (!match) fail(`无效范围 ${text}；使用 [1:1,5:1)`, location);
  const start = positionTick(match[1], measures, location);
  const end = positionTick(match[2], measures, location);
  if (end <= start) fail("范围结束位置必须晚于开始位置", location);
  return [start, end];
}

export function positionText(tick: number, measures: readonly MeasureInfo[]) {
  if (tick === measures.at(-1)?.endTick) return `${measures.length + 1}:1`;
  const measure = measures.find((item) => item.startTick <= tick && tick < item.endTick);
  if (!measure) return `tick=${tick}`;
  const beatTicks = PPQ * 4 / measure.denominator;
  const offset = tick - measure.startTick;
  const beat = Math.floor(offset / beatTicks);
  const remainder = offset % beatTicks;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(remainder, beatTicks);
  return `${measure.number}:${beat + 1}${remainder ? `+${remainder / divisor}/${beatTicks / divisor}` : ""}`;
}
