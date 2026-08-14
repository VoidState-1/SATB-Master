import type { SatbTrack, VoiceId } from "./types";

export const VOICE_ORDER: VoiceId[] = ["soprano", "alto", "tenor", "bass"];

export const VOICE_CONFIG: Record<
  VoiceId,
  {
    name: string;
    shortName: SatbTrack["shortName"];
    min: number;
    max: number;
    color: string;
    darkColor: string;
  }
> = {
  soprano: {
    name: "女高音",
    shortName: "S",
    min: 60,
    max: 81,
    color: "#7552a3",
    darkColor: "#4f3671",
  },
  alto: {
    name: "女低音",
    shortName: "A",
    min: 55,
    max: 74,
    color: "#2d7a68",
    darkColor: "#1f5549",
  },
  tenor: {
    name: "男高音",
    shortName: "T",
    min: 48,
    max: 67,
    color: "#3f6fa8",
    darkColor: "#2b4f79",
  },
  bass: {
    name: "男低音",
    shortName: "B",
    min: 40,
    max: 60,
    color: "#87643d",
    darkColor: "#60472b",
  },
};

export function defaultVoiceRanges(): Record<
  VoiceId,
  { minMidi: number; maxMidi: number }
> {
  return Object.fromEntries(
    VOICE_ORDER.map((voiceId) => [
      voiceId,
      {
        minMidi: VOICE_CONFIG[voiceId].min,
        maxMidi: VOICE_CONFIG[voiceId].max,
      },
    ]),
  ) as Record<VoiceId, { minMidi: number; maxMidi: number }>;
}

export function defaultVoiceRange(voiceId: VoiceId) {
  const { min, max } = VOICE_CONFIG[voiceId];
  return { minMidi: min, maxMidi: max };
}
