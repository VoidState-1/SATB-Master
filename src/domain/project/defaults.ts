import type { ProjectDocument, RuleProfile, SatbTrack, VoiceId } from "./types";
import { PPQ, PROJECT_SCHEMA_VERSION } from "./types";
import { VOICE_CONFIG } from "./voice";

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createTrack(id: VoiceId, program: number): SatbTrack {
  const config = VOICE_CONFIG[id];
  return {
    id,
    kind: "satb",
    voice: id,
    name: config.name,
    shortName: config.shortName,
    notes: [],
    participatesInHarmony: true,
    monophonic: true,
    visible: true,
    muted: false,
    solo: false,
    locked: false,
    volume: 0.82,
    pan:
      id === "soprano"
        ? 0.2
        : id === "alto"
          ? 0.08
          : id === "tenor"
            ? -0.08
            : -0.2,
    program,
  };
}

export function createDefaultRuleProfile(): RuleProfile {
  return {
    profileVersion: 1,
    title: "斯波索宾基础规则",
    shared: {
      voiceRanges: {
        soprano: { minMidi: 60, maxMidi: 81 },
        alto: { minMidi: 55, maxMidi: 74 },
        tenor: { minMidi: 48, maxMidi: 67 },
        bass: { minMidi: 40, maxMidi: 60 },
      },
      strictFourPartTexture: false,
    },
    builtin: {},
    external: [],
  };
}

export function createEmptyProject(title = "未命名练习"): ProjectDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId("project"),
    title,
    author: "",
    notes: "",
    createdAt: now,
    updatedAt: now,
    ppq: PPQ,
    lengthTicks: PPQ * 4 * 16,
    tempoEvents: [{ id: createId("tempo"), tick: 0, bpm: 80 }],
    meterEvents: [
      { id: createId("meter"), tick: 0, numerator: 4, denominator: 4 },
    ],
    keyEvents: [
      {
        id: createId("key"),
        tick: 0,
        tonic: { step: "C", alter: 0 },
        mode: "major",
      },
    ],
    satbTracks: [
      createTrack("soprano", 52),
      createTrack("alto", 52),
      createTrack("tenor", 52),
      createTrack("bass", 53),
    ],
    auxiliaryTracks: [],
    chordTrack: {
      visible: true,
      locked: false,
      displayMode: "roman",
      regions: [],
    },
    loop: {
      enabled: false,
      startTick: 0,
      endTick: PPQ * 4,
    },
    ruleProfile: createDefaultRuleProfile(),
    exercise: { instructions: "", editableRanges: [] },
    audio: {
      masterVolume: 0.78,
      soundFont: { kind: "default", name: "SATB Master 默认音色" },
    },
  };
}
