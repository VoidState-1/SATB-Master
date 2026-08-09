import { chordVoicingPolicy } from "./chordModel";
import type {
  ChordRegion,
  HarmonyInterpretation,
  NoteEvent,
  VoiceId,
} from "./project";

export type DeveloperFieldValue = string | number | boolean | undefined;

export interface DeveloperFieldRow {
  path: string;
  type: string;
  value: DeveloperFieldValue;
}

export interface DeveloperEventInspection {
  modelName: "NoteEvent" | "ChordRegion";
  contextLabel: string;
  rows: DeveloperFieldRow[];
  rawJson: string;
}

function row(
  path: string,
  type: string,
  value: DeveloperFieldValue,
): DeveloperFieldRow {
  return { path, type, value };
}

export function inspectNoteEvent(
  voiceId: VoiceId,
  note: NoteEvent,
): DeveloperEventInspection {
  return {
    modelName: "NoteEvent",
    contextLabel: `satbTracks.${voiceId}.notes`,
    rows: [
      row("id", "string", note.id),
      row("startTick", "number", note.startTick),
      row("durationTicks", "number", note.durationTicks),
      row("pitch.step", "DiatonicStep", note.pitch.step),
      row("pitch.alter", "Alteration", note.pitch.alter),
      row("pitch.octave", "number", note.pitch.octave),
      row("velocity", "number", note.velocity),
      row("locked", "boolean", note.locked),
      row("spellingSource", "string", note.spellingSource),
      row(
        "nonChordToneRole",
        "NonChordToneRole | undefined",
        note.nonChordToneRole,
      ),
      row(
        "importOrigin",
        "MidiImportOrigin | undefined",
        note.importOrigin ? "{…}" : undefined,
      ),
      row(
        "importOrigin.importId",
        "string | undefined",
        note.importOrigin?.importId,
      ),
      row(
        "importOrigin.sourceTrack",
        "number | undefined",
        note.importOrigin?.sourceTrack,
      ),
      row(
        "importOrigin.channel",
        "number | undefined",
        note.importOrigin?.channel,
      ),
      row(
        "importOrigin.sourceStartTick",
        "number | undefined",
        note.importOrigin?.sourceStartTick,
      ),
      row(
        "importOrigin.sourceDurationTicks",
        "number | undefined",
        note.importOrigin?.sourceDurationTicks,
      ),
      row(
        "importOrigin.sourceMidiNote",
        "number | undefined",
        note.importOrigin?.sourceMidiNote,
      ),
    ],
    rawJson: JSON.stringify(note, null, 2),
  };
}

export function inspectChordRegion(
  chord: ChordRegion,
): DeveloperEventInspection {
  const rows: DeveloperFieldRow[] = [
    row("id", "string", chord.id),
    row("startTick", "number", chord.startTick),
    row("durationTicks", "number", chord.durationTicks),
    row("identity.root.step", "DiatonicStep", chord.identity.root.step),
    row("identity.root.alter", "Alteration", chord.identity.root.alter),
    row("identity.structure.kind", "ChordStructure.kind", chord.identity.structure.kind),
  ];

  if (chord.identity.structure.kind === "tertian") {
    rows.push(
      row(
        "identity.structure.quality",
        "ChordQuality",
        chord.identity.structure.quality,
      ),
      row(
        "identity.structure.extensions",
        "readonly ChordExtension[]",
        JSON.stringify(chord.identity.structure.extensions),
      ),
      row(
        "identity.structure.alterations",
        "readonly ChordToneAlteration[]",
        JSON.stringify(chord.identity.structure.alterations),
      ),
    );
    chord.identity.structure.extensions.forEach((extension, index) => {
      rows.push(
        row(
          `identity.structure.extensions[${index}]`,
          "ChordExtension",
          extension,
        ),
      );
    });
    chord.identity.structure.alterations.forEach((alteration, index) => {
      rows.push(
        row(
          `identity.structure.alterations[${index}].degree`,
          "ChordToneDegree",
          alteration.degree,
        ),
        row(
          `identity.structure.alterations[${index}].alter`,
          "Alteration",
          alteration.alter,
        ),
      );
    });
  } else {
    rows.push(
      row(
        "identity.structure.variant",
        "AugmentedSixthVariant",
        chord.identity.structure.variant,
      ),
    );
  }

  const policy = chordVoicingPolicy(chord.identity);
  rows.push(
    row("identity.bass.step", "DiatonicStep", chord.identity.bass.step),
    row("identity.bass.alter", "Alteration", chord.identity.bass.alter),
    row(
      "voicingPolicy.requiredDegrees",
      "readonly ChordToneDegree[]",
      JSON.stringify(policy.requiredDegrees),
    ),
    row(
      "voicingPolicy.permittedDegrees",
      "readonly ChordToneDegree[]",
      JSON.stringify(policy.permittedDegrees),
    ),
    row(
      "voicingPolicy.forbiddenDegrees",
      "readonly ChordToneDegree[]",
      JSON.stringify(policy.forbiddenDegrees),
    ),
    row(
      "voicingPolicy.doublingHints",
      "readonly ChordDoublingHint[]",
      JSON.stringify(policy.doublingHints),
    ),
    row(
      "semantics",
      "HarmonySemantics | undefined",
      chord.semantics ? "{…}" : undefined,
    ),
    row(
      "semantics.primaryInterpretationId",
      "string | undefined",
      chord.semantics?.primaryInterpretationId,
    ),
    row("semantics.mixture", "string | undefined", chord.semantics?.mixture),
    row(
      "semantics.cadenceRole",
      "string | undefined",
      chord.semantics?.cadenceRole,
    ),
    row(
      "semantics.cadenceType",
      "string | undefined",
      chord.semantics?.cadenceType,
    ),
    row(
      "semantics.pedalContext",
      "PedalContext | undefined",
      chord.semantics?.pedalContext ? "{…}" : undefined,
    ),
    row(
      "semantics.pedalContext.pitch.step",
      "DiatonicStep | undefined",
      chord.semantics?.pedalContext?.pitch.step,
    ),
    row(
      "semantics.pedalContext.pitch.alter",
      "Alteration | undefined",
      chord.semantics?.pedalContext?.pitch.alter,
    ),
    row(
      "semantics.pedalContext.role",
      "string | undefined",
      chord.semantics?.pedalContext?.role,
    ),
    row("locked", "boolean", chord.locked),
  );

  const pushInterpretation = (
    prefix: string,
    interpretation: HarmonyInterpretation,
  ) => {
    rows.push(
      row(`${prefix}.id`, "string", interpretation.id),
      row(
        `${prefix}.localKey`,
        "KeyReference | undefined",
        interpretation.localKey ? "{…}" : undefined,
      ),
      row(
        `${prefix}.localKey.tonic.step`,
        "DiatonicStep | undefined",
        interpretation.localKey?.tonic.step,
      ),
      row(
        `${prefix}.localKey.tonic.alter`,
        "Alteration | undefined",
        interpretation.localKey?.tonic.alter,
      ),
      row(
        `${prefix}.localKey.mode`,
        "KeyMode | undefined",
        interpretation.localKey?.mode,
      ),
      row(`${prefix}.degree`, "ScaleDegree", interpretation.degree),
      row(
        `${prefix}.degreeAlteration`,
        "Alteration",
        interpretation.degreeAlteration,
      ),
      row(
        `${prefix}.appliedTarget.degree`,
        "ScaleDegree | undefined",
        interpretation.appliedTarget?.degree,
      ),
      row(
        `${prefix}.appliedTarget.primaryFunction`,
        "FunctionalFamily | undefined",
        interpretation.appliedTarget?.primaryFunction,
      ),
      row(
        `${prefix}.appliedTarget.secondaryFunction`,
        "FunctionalFamily | undefined",
        interpretation.appliedTarget?.secondaryFunction,
      ),
      row(
        `${prefix}.designation.notationSystem`,
        '"spasobin" | undefined',
        interpretation.designation?.notationSystem,
      ),
      row(
        `${prefix}.designation.kind`,
        "FunctionalDesignationKind | undefined",
        interpretation.designation?.kind,
      ),
      row(
        `${prefix}.designation.primaryFunction`,
        "FunctionalFamily | undefined",
        interpretation.designation?.primaryFunction,
      ),
      row(
        `${prefix}.designation.secondaryFunction`,
        "FunctionalFamily | undefined",
        interpretation.designation?.secondaryFunction,
      ),
      row(
        `${prefix}.designation.specialRole`,
        "string | undefined",
        interpretation.designation?.specialRole,
      ),
      row(`${prefix}.source`, "string", interpretation.source),
      row(
        `${prefix}.confidence`,
        "SemanticConfidence",
        interpretation.confidence,
      ),
    );
  };

  chord.semantics?.interpretations.forEach((interpretation, index) =>
    pushInterpretation(`semantics.interpretations[${index}]`, interpretation),
  );
  chord.semantics?.alternatives?.forEach((interpretation, index) =>
    pushInterpretation(`semantics.alternatives[${index}]`, interpretation),
  );

  return {
    modelName: "ChordRegion",
    contextLabel: "chordTrack.regions",
    rows,
    rawJson: JSON.stringify(chord, null, 2),
  };
}

export function formatDeveloperFieldValue(value: DeveloperFieldValue) {
  if (value === undefined) return "未设置（undefined）";
  if (typeof value === "string") return value === "" ? '空字符串（""）' : value;
  return String(value);
}
