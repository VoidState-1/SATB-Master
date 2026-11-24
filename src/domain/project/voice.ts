import type { AuxiliaryTrack, MusicalTrack, SatbTrack, VoiceId } from "./types";

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

export const AUXILIARY_COLOR_PALETTE = [
  "#d45a52",
  "#00899a",
  "#ae7900",
  "#bc4380",
  "#6264db",
  "#778512",
  "#c9692e",
  "#5d8596",
] as const;

export function isValidHexColor(value: string): boolean {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function resolveAuxiliaryTrackColor(
  track: Pick<AuxiliaryTrack, "color">,
  index = 0,
): string {
  if (track.color !== undefined && isValidHexColor(track.color))
    return track.color;
  return (
    AUXILIARY_COLOR_PALETTE[index % AUXILIARY_COLOR_PALETTE.length] ??
    AUXILIARY_COLOR_PALETTE[0]
  );
}

export function resolveTrackColor(
  track: MusicalTrack,
  auxiliaryIndex = 0,
): string {
  return track.kind === "satb"
    ? VOICE_CONFIG[track.id].color
    : resolveAuxiliaryTrackColor(track, auxiliaryIndex);
}

export function isSatbTrackId(trackId: string): trackId is VoiceId {
  return Object.hasOwn(VOICE_CONFIG, trackId);
}

export function deriveAuxiliaryShortName(
  name: string,
  fallbackIndex: number,
): string {
  const compactName = name.replace(/\s/g, "");
  const numberedName = /^额外(?:声部)?([0-9]+)$/.exec(compactName);
  if (numberedName) return "E" + numberedName[1];
  if (!compactName) return "E" + (fallbackIndex + 1);
  return Array.from(compactName.toUpperCase()).slice(0, 2).join("");
}

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
