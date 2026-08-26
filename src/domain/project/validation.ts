import {
  harmonySemanticsCompatibleWithIdentity,
  type ChordIdentity,
  type ChordQuality,
  type ChordToneAlteration,
  type FunctionalDesignation,
  type FunctionalFamily,
  type FunctionalTarget,
  type HarmonyInterpretation,
  type HarmonySemantics,
  type KeyReference,
} from "../chordModel";
import {
  MAX_RULE_CONFIG_ENTRIES,
  parseRuleConfig,
  parseRuleExceptionPolicy,
} from "../harmony/rules/configSchema";
import {
  isSupportedKeySignature,
  toMidi,
  type SpelledPitch,
  type SpelledPitchClass,
} from "../pitch";
import type {
  ChordRegion,
  CadenceAnnotation,
  KeyEvent,
  PhraseBoundary,
  NonChordToneRole,
  ProjectDocument,
  VoiceId,
} from "./types";
import {
  METER_DENOMINATORS,
  PPQ,
  PROJECT_SCHEMA_VERSION,
} from "./types";
import { VOICE_ORDER } from "./voice";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isInteger(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  return (
    Number.isInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function isNumber(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function hasString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string";
}

export function validatePitchClass(value: unknown): value is SpelledPitchClass {
  return (
    isRecord(value) &&
    ["C", "D", "E", "F", "G", "A", "B"].includes(value.step as string) &&
    isInteger(value.alter, -2, 2)
  );
}

function validatePitch(value: unknown): value is SpelledPitch {
  if (!isRecord(value) || !validatePitchClass(value)) return false;
  const pitch = value as unknown as SpelledPitch;
  return (
    isInteger(pitch.octave, -2, 9) && toMidi(pitch) >= 0 && toMidi(pitch) <= 127
  );
}

const nonChordToneRoles = new Set<NonChordToneRole>([
  "passing",
  "neighbor",
  "suspension",
  "retardation",
  "appoggiatura",
  "anticipation",
  "escape",
  "pedal",
  "other",
]);

export const chordQualities = new Set<ChordQuality>([
  "major",
  "minor",
  "diminished",
  "augmented",
  "dominant7",
  "major7",
  "minor7",
  "halfDiminished7",
  "diminished7",
]);

function validateImportOrigin(value: unknown) {
  return (
    isRecord(value) &&
    hasString(value, "importId") &&
    isInteger(value.sourceTrack, 0) &&
    isInteger(value.channel, 0, 15) &&
    isInteger(value.sourceStartTick, 0) &&
    isInteger(value.sourceDurationTicks, 1) &&
    isInteger(value.sourceMidiNote, 0, 127)
  );
}

function validateNote(value: unknown, projectLength: number) {
  if (!isRecord(value)) return false;
  return (
    hasString(value, "id") &&
    isInteger(value.startTick, 0) &&
    isInteger(value.durationTicks, 1) &&
    (value.startTick as number) + (value.durationTicks as number) <=
      projectLength &&
    validatePitch(value.pitch) &&
    isInteger(value.velocity, 1, 127) &&
    typeof value.locked === "boolean" &&
    ["manual", "migrated", "midi-inferred"].includes(
      value.spellingSource as string,
    ) &&
    (value.nonChordToneRole === undefined ||
      nonChordToneRoles.has(value.nonChordToneRole as NonChordToneRole)) &&
    (value.importOrigin === undefined ||
      validateImportOrigin(value.importOrigin))
  );
}

function validateTrackBase(
  value: Record<string, unknown>,
  projectLength: number,
) {
  return (
    hasString(value, "id") &&
    hasString(value, "name") &&
    hasString(value, "shortName") &&
    Array.isArray(value.notes) &&
    value.notes.every((note) => validateNote(note, projectLength)) &&
    ["visible", "muted", "solo", "locked"].every(
      (key) => typeof value[key] === "boolean",
    ) &&
    isNumber(value.volume, 0, 1) &&
    isNumber(value.pan, -1, 1) &&
    isInteger(value.program, 0, 127)
  );
}

function validateSatbTrack(value: unknown, projectLength: number) {
  if (!isRecord(value) || !validateTrackBase(value, projectLength))
    return false;
  return (
    value.kind === "satb" &&
    VOICE_ORDER.includes(value.id as VoiceId) &&
    value.voice === value.id &&
    ["S", "A", "T", "B"].includes(value.shortName as string) &&
    value.participatesInHarmony === true &&
    value.monophonic === true
  );
}

function validateAuxiliaryTrack(value: unknown, projectLength: number) {
  if (!isRecord(value) || !validateTrackBase(value, projectLength))
    return false;
  return (
    value.kind === "auxiliary" &&
    ["midi-import", "reference", "other"].includes(value.role as string) &&
    value.participatesInHarmony === false &&
    value.monophonic === false
  );
}

function validatePhraseBoundary(
  value: unknown,
  projectLength: number,
): value is PhraseBoundary {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    isInteger(value.tick, 0, projectLength) &&
    ["manual", "inferred"].includes(value.source as string) &&
    ["certain", "probable", "ambiguous"].includes(
      value.confidence as string,
    ) &&
    (value.locked === undefined || typeof value.locked === "boolean") &&
    (value.inferenceFingerprint === undefined ||
      typeof value.inferenceFingerprint === "string") &&
    (value.stale === undefined || typeof value.stale === "boolean")
  );
}

function validateProjectStructure(value: unknown, projectLength: number) {
  if (!isRecord(value) || !Array.isArray(value.phraseBoundaries)) return false;
  const boundaries = value.phraseBoundaries as unknown[];
  if (!boundaries.every((boundary) => validatePhraseBoundary(boundary, projectLength)))
    return false;
  if (boundaries.some((boundary) => (boundary as PhraseBoundary).tick <= 0 || (boundary as PhraseBoundary).tick >= projectLength))
    return false;
  const ticks = boundaries.map((boundary) => (boundary as PhraseBoundary).tick);
  return ticks.every((tick, index) => index === 0 || tick > ticks[index - 1]);
}

function validateCadenceAnnotation(
  value: unknown,
  projectLength: number,
): value is CadenceAnnotation {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "phraseId") &&
    isInteger(value.fromTick, 0, projectLength) &&
    isInteger(value.toTick, 1, projectLength) &&
    (value.toTick as number) > (value.fromTick as number) &&
    ["full", "half", "supplementary", "deceptive"].includes(
      value.kind as string,
    ) &&
    (value.form === undefined || ["authentic", "plagal"].includes(value.form as string)) &&
    (value.completion === undefined ||
      ["perfect", "imperfect"].includes(value.completion as string)) &&
    ["manual", "accepted-candidate"].includes(value.source as string) &&
    ["certain", "probable"].includes(value.confidence as string) &&
    typeof value.locked === "boolean" &&
    (value.stale === undefined || typeof value.stale === "boolean")
    &&
    (value.kind === "full" || value.completion === undefined) &&
    (value.kind !== "supplementary" || value.form === "plagal") &&
    (value.form !== "plagal" || value.kind === "full" || value.kind === "supplementary")
  );
}

function validateCadenceAnnotations(
  value: unknown,
  projectLength: number,
  regions: readonly ChordRegion[],
) {
  if (!Array.isArray(value) || !value.every((item) => validateCadenceAnnotation(item, projectLength)))
    return false;
  const annotations = value as CadenceAnnotation[];
  if (new Set(annotations.map((item) => item.id)).size !== annotations.length)
    return false;
  const ordered = [...annotations].sort((left, right) => left.fromTick - right.fromTick);
  if (
    ordered.some(
      (item, index) =>
        index > 0 && ordered[index - 1].toTick > item.fromTick,
    )
  )
    return false;
  return annotations.every((annotation) => {
    const startAligned = regions.some((region) => region.startTick === annotation.fromTick);
    const endAligned = regions.some(
      (region) => region.startTick + region.durationTicks === annotation.toTick,
    );
    return annotation.stale === true || (startAligned && endAligned);
  });
}

function validateKeyReference(value: unknown): value is KeyReference {
  return (
    isRecord(value) &&
    validatePitchClass(value.tonic) &&
    ["major", "minor"].includes(value.mode as string)
  );
}

const functionalFamilies = new Set<FunctionalFamily>([
  "tonic",
  "subdominant",
  "dominant",
]);

function validateFunctionalTarget(value: unknown): value is FunctionalTarget {
  return (
    isRecord(value) &&
    isInteger(value.degree, 1, 7) &&
    functionalFamilies.has(value.primaryFunction as FunctionalFamily) &&
    (value.secondaryFunction === undefined ||
      functionalFamilies.has(value.secondaryFunction as FunctionalFamily))
  );
}

function validateFunctionalDesignation(
  value: unknown,
): value is FunctionalDesignation {
  return (
    isRecord(value) &&
    value.notationSystem === "spasobin" &&
    [
      "primary",
      "side-degree",
      "applied-dominant",
      "applied-leading-tone",
      "double-dominant",
      "double-dominant-leading-tone",
      "cadential64",
      "neapolitan",
      "augmented-sixth",
      "altered-dominant",
    ].includes(value.kind as string) &&
    (value.primaryFunction === undefined ||
      functionalFamilies.has(value.primaryFunction as FunctionalFamily)) &&
    (value.secondaryFunction === undefined ||
      functionalFamilies.has(value.secondaryFunction as FunctionalFamily)) &&
    (value.specialRole === undefined ||
      ["neapolitan", "italian6", "french6", "german6"].includes(
        value.specialRole as string,
      ))
  );
}

function validateHarmonyInterpretation(
  value: unknown,
): value is HarmonyInterpretation {
  if (!isRecord(value)) return false;
  return (
    hasString(value, "id") &&
    (value.id as string).length > 0 &&
    isInteger(value.degree, 1, 7) &&
    isInteger(value.degreeAlteration, -2, 2) &&
    ["manual", "inferred", "confirmed"].includes(value.source as string) &&
    ["certain", "probable", "ambiguous", "unknown"].includes(
      value.confidence as string,
    ) &&
    (value.localKey === undefined || validateKeyReference(value.localKey)) &&
    (value.appliedTarget === undefined ||
      validateFunctionalTarget(value.appliedTarget)) &&
    (value.designation === undefined ||
      validateFunctionalDesignation(value.designation))
  );
}

function validateHarmonySemantics(value: unknown): value is HarmonySemantics {
  if (
    !isRecord(value) ||
    !Array.isArray(value.interpretations) ||
    value.interpretations.length === 0 ||
    !value.interpretations.every(validateHarmonyInterpretation) ||
    typeof value.primaryInterpretationId !== "string"
  )
    return false;

  const alternatives = value.alternatives;
  if (
    alternatives !== undefined &&
    (!Array.isArray(alternatives) ||
      !alternatives.every(validateHarmonyInterpretation))
  )
    return false;

  const interpretations = value.interpretations as HarmonyInterpretation[];
  const allInterpretations = [
    ...interpretations,
    ...((alternatives ?? []) as HarmonyInterpretation[]),
  ];
  const ids = allInterpretations.map((item) => item.id);
  if (
    new Set(ids).size !== ids.length ||
    !interpretations.some(
      (item) => item.id === value.primaryInterpretationId,
    ) ||
    interpretations.filter((item) => item.source === "confirmed").length > 2
  )
    return false;

  return (
    (value.mixture === undefined ||
      ["parallel-major", "parallel-minor", "modal"].includes(
        value.mixture as string,
      )) &&
    (value.cadenceRole === undefined ||
      ["cadential64", "passing64", "pedal64", "deceptive"].includes(
        value.cadenceRole as string,
      )) &&
    (value.pedalContext === undefined ||
      (isRecord(value.pedalContext) &&
        validatePitchClass(value.pedalContext.pitch) &&
        ["start", "continue", "end"].includes(
          value.pedalContext.role as string,
        )))
  );
}

function validateChordIdentity(value: unknown): value is ChordIdentity {
  if (
    !isRecord(value) ||
    !validatePitchClass(value.root) ||
    !validatePitchClass(value.bass) ||
    !isRecord(value.structure)
  )
    return false;
  if (value.structure.kind === "augmented-sixth")
    return ["italian", "french", "german"].includes(
      value.structure.variant as string,
    );
  if (value.structure.kind !== "tertian") return false;
  return (
    chordQualities.has(value.structure.quality as ChordQuality) &&
    Array.isArray(value.structure.extensions) &&
    value.structure.extensions.every((extension) =>
      [6, 7, 9, 11, 13].includes(extension),
    ) &&
    new Set(value.structure.extensions).size ===
      value.structure.extensions.length &&
    Array.isArray(value.structure.alterations) &&
    value.structure.alterations.every(
      (alteration) =>
        isRecord(alteration) &&
        [5, 9, 11, 13].includes(alteration.degree as number) &&
        isInteger(alteration.alter, -2, 2) &&
        (alteration.tendency === undefined ||
          alteration.tendency === "up" ||
          alteration.tendency === "down"),
    ) &&
    new Set(
      value.structure.alterations.map(
        (alteration) => (alteration as ChordToneAlteration).degree,
      ),
    ).size === value.structure.alterations.length
  );
}

function validateChordRegion(value: unknown, projectLength: number) {
  if (!isRecord(value)) return false;
  return (
    hasString(value, "id") &&
    isInteger(value.startTick, 0) &&
    isInteger(value.durationTicks, 1) &&
    (value.startTick as number) + (value.durationTicks as number) <=
      projectLength &&
    validateChordIdentity(value.identity) &&
    (value.semantics === undefined ||
      validateHarmonySemantics(value.semantics)) &&
    typeof value.locked === "boolean"
  );
}

function validateRuleProfile(value: unknown) {
  if (
    !isRecord(value) ||
    value.profileVersion !== 2 ||
    !isInteger(value.catalogRevision, 1) ||
    typeof value.title !== "string" ||
    value.title.length > 120 ||
    !isRecord(value.shared) ||
    !isRecord(value.builtin) ||
    !Array.isArray(value.external)
  )
    return false;
  if (
    value.external.length > 256 ||
    Object.keys(value.builtin).length > 256 ||
    !isRecord(value.shared)
  )
    return false;
  const shared = value.shared;
  if (
    typeof shared.strictFourPartTexture !== "boolean" ||
    !isRecord(shared.voiceRanges)
  )
    return false;
  const voiceRanges = shared.voiceRanges;
  const severities = ["error", "warning", "suggestion", "off"];
  const stableIdPattern =
    /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
  const config = (candidate: unknown) =>
    parseRuleConfig(candidate, {
      keyPattern: stableIdPattern,
      maximumEntries: MAX_RULE_CONFIG_ENTRIES,
    }) !== undefined;
  const exceptions = (candidate: unknown) =>
    parseRuleExceptionPolicy(candidate) !== undefined;
  if (
    !VOICE_ORDER.every((voiceId) => {
      const range = voiceRanges[voiceId];
      return (
        isRecord(range) &&
        isInteger(range.minMidi, 0, 127) &&
        isInteger(range.maxMidi, 0, 127) &&
        (range.minMidi as number) <= (range.maxMidi as number)
      );
    })
  )
    return false;
  const ids = stableIdPattern;
  const versions = /^[0-9A-Za-z](?:[0-9A-Za-z.+-]{0,62}[0-9A-Za-z])?$/;
  const hashes = /^[a-f0-9]{64}$/;
  if (
    !Object.entries(value.builtin).every(
      ([ruleId, settings]) =>
        ids.test(ruleId) &&
        isRecord(settings) &&
        severities.includes(settings.severity as string) &&
        isInteger(settings.configVersion, 1) &&
        config(settings.config) &&
        exceptions(settings.exceptions),
    )
  )
    return false;
  const references = new Set<string>();
  return value.external.every((rule) => {
    if (
      !isRecord(rule) ||
      typeof rule.ruleId !== "string" ||
      !ids.test(rule.ruleId) ||
      typeof rule.packageId !== "string" ||
      !ids.test(rule.packageId) ||
      typeof rule.version !== "string" ||
      !versions.test(rule.version) ||
      typeof rule.contentHash !== "string" ||
      !hashes.test(rule.contentHash) ||
      !severities.includes(rule.severity as string) ||
      typeof rule.enabled !== "boolean" ||
      !isInteger(rule.configVersion, 1) ||
      !config(rule.config) ||
      !exceptions(rule.exceptions)
    )
      return false;
    const key = `${rule.packageId}@${rule.version}:${rule.contentHash}:${rule.ruleId}`;
    if (references.has(key)) return false;
    references.add(key);
    return true;
  });
}

export function validateProject(value: unknown): value is ProjectDocument {
  if (!isRecord(value)) return false;
  const project = value;
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION || project.ppq !== PPQ)
    return false;
  if (
    !["id", "title", "author", "notes", "createdAt", "updatedAt"].every((key) =>
      hasString(project, key),
    ) ||
    !isInteger(project.lengthTicks, 1)
  )
    return false;

  if (
    !Array.isArray(project.satbTracks) ||
    project.satbTracks.length !== VOICE_ORDER.length ||
    !project.satbTracks.every((track) =>
      validateSatbTrack(track, project.lengthTicks as number),
    ) ||
    !Array.isArray(project.auxiliaryTracks) ||
    !project.auxiliaryTracks.every((track) =>
      validateAuxiliaryTrack(track, project.lengthTicks as number),
    )
  )
    return false;
  const voiceIds = new Set(
    project.satbTracks.map((track) => (track as Record<string, unknown>).id),
  );
  if (!VOICE_ORDER.every((voiceId) => voiceIds.has(voiceId))) return false;
  const allTrackIds = [...project.satbTracks, ...project.auxiliaryTracks].map(
    (track) => (track as Record<string, unknown>).id,
  );
  if (new Set(allTrackIds).size !== allTrackIds.length) return false;

  if (
    !Array.isArray(project.tempoEvents) ||
    project.tempoEvents.length === 0 ||
    !project.tempoEvents.every(
      (event) =>
        isRecord(event) &&
        hasString(event, "id") &&
        isInteger(event.tick, 0) &&
        isNumber(event.bpm, 1, 1000),
    ) ||
    !project.tempoEvents.some((event) => isRecord(event) && event.tick === 0)
  )
    return false;

  if (
    !Array.isArray(project.meterEvents) ||
    project.meterEvents.length === 0 ||
    !project.meterEvents.every(
      (event) =>
        isRecord(event) &&
        hasString(event, "id") &&
        isInteger(event.tick, 0) &&
        isInteger(event.numerator, 1, 32) &&
        METER_DENOMINATORS.includes(
          event.denominator as (typeof METER_DENOMINATORS)[number],
        ) &&
        (event.beatGrouping === undefined ||
          (Array.isArray(event.beatGrouping) &&
            event.beatGrouping.length > 0 &&
            event.beatGrouping.every((value) => isInteger(value, 1, 32)) &&
            event.beatGrouping.reduce(
              (total, value) => total + (value as number),
              0,
            ) === event.numerator)),
    ) ||
    !project.meterEvents.some((event) => isRecord(event) && event.tick === 0)
  )
    return false;

  if (
    !Array.isArray(project.keyEvents) ||
    project.keyEvents.length === 0 ||
    !project.keyEvents.every(
      (event) =>
        isRecord(event) &&
        hasString(event, "id") &&
        isInteger(event.tick, 0) &&
        validatePitchClass(event.tonic) &&
        ["major", "minor"].includes(event.mode as string) &&
        isSupportedKeySignature(event as unknown as KeyEvent),
    ) ||
    !project.keyEvents.some((event) => isRecord(event) && event.tick === 0)
  )
    return false;

  if (!validateProjectStructure(project.structure, project.lengthTicks as number))
    return false;

  if (
    !isRecord(project.chordTrack) ||
    typeof project.chordTrack.visible !== "boolean" ||
    typeof project.chordTrack.locked !== "boolean" ||
    ![
      "functional",
      "roman",
      "absolute",
      "functional-absolute",
      "roman-absolute",
    ].includes(project.chordTrack.displayMode as string) ||
    !Array.isArray(project.chordTrack.regions) ||
    !project.chordTrack.regions.every((region) =>
      validateChordRegion(region, project.lengthTicks as number),
    ) ||
    !validateCadenceAnnotations(
      project.chordTrack.cadenceAnnotations,
      project.lengthTicks as number,
      project.chordTrack.regions as ChordRegion[],
    )
  )
    return false;

  const orderedChords = [...project.chordTrack.regions].sort(
    (a, b) => (a as ChordRegion).startTick - (b as ChordRegion).startTick,
  ) as ChordRegion[];
  if (
    orderedChords.some(
      (region, index) =>
        index > 0 &&
        orderedChords[index - 1].startTick +
          orderedChords[index - 1].durationTicks >
          region.startTick,
    )
  )
    return false;
  for (const region of orderedChords) {
    if (!region.semantics) continue;
    const key = [...(project.keyEvents as KeyEvent[])]
      .sort((a, b) => a.tick - b.tick)
      .filter((event) => event.tick <= region.startTick)
      .at(-1);
    if (
      !key ||
      !harmonySemanticsCompatibleWithIdentity(
        region.identity,
        region.semantics,
        key,
      )
    )
      return false;
  }

  if (
    !isRecord(project.loop) ||
    typeof project.loop.enabled !== "boolean" ||
    !isInteger(project.loop.startTick, 0, project.lengthTicks as number) ||
    !isInteger(project.loop.endTick, 1, project.lengthTicks as number) ||
    (project.loop.endTick as number) <= (project.loop.startTick as number)
  )
    return false;

  if (!validateRuleProfile(project.ruleProfile)) return false;

  if (
    !isRecord(project.exercise) ||
    typeof project.exercise.instructions !== "string" ||
    !Array.isArray(project.exercise.editableRanges) ||
    !project.exercise.editableRanges.every(
      (range) =>
        isRecord(range) &&
        hasString(range, "id") &&
        Array.isArray(range.voiceIds) &&
        range.voiceIds.every((voiceId) =>
          VOICE_ORDER.includes(voiceId as VoiceId),
        ) &&
        isInteger(range.fromTick, 0) &&
        isInteger(range.toTick, 1) &&
        (range.toTick as number) > (range.fromTick as number) &&
        typeof range.editable === "boolean",
    )
  )
    return false;

  if (
    !isRecord(project.audio) ||
    !isNumber(project.audio.masterVolume, 0, 1) ||
    !isRecord(project.audio.soundFont)
  )
    return false;
  const soundFont = project.audio.soundFont;
  if (
    (soundFont.kind !== "default" && soundFont.kind !== "user") ||
    typeof soundFont.name !== "string" ||
    (soundFont.path !== undefined && typeof soundFont.path !== "string") ||
    (soundFont.hash !== undefined && typeof soundFont.hash !== "string")
  )
    return false;
  return true;
}
