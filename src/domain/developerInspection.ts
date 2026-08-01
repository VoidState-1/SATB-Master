import type { ChordRegion, NoteEvent, VoiceId } from "./model";

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
    row("identity.quality", "ChordQuality", chord.identity.quality),
    row(
      "identity.extensions",
      "ChordExtension[]",
      JSON.stringify(chord.identity.extensions),
    ),
    row(
      "identity.alterations",
      "ChordToneAlteration[]",
      JSON.stringify(chord.identity.alterations),
    ),
  ];

  chord.identity.extensions.forEach((extension, index) => {
    rows.push(
      row(`identity.extensions[${index}]`, "ChordExtension", extension),
    );
  });
  chord.identity.alterations.forEach((alteration, index) => {
    rows.push(
      row(`identity.alterations[${index}].degree`, "number", alteration.degree),
      row(
        `identity.alterations[${index}].alter`,
        "Alteration",
        alteration.alter,
      ),
    );
  });

  rows.push(
    row("identity.bass.step", "DiatonicStep", chord.identity.bass.step),
    row("identity.bass.alter", "Alteration", chord.identity.bass.alter),
    row(
      "function",
      "FunctionalAnalysis | undefined",
      chord.function ? "{…}" : undefined,
    ),
    row(
      "function.localKey",
      "KeyReference | undefined",
      chord.function?.localKey ? "{…}" : undefined,
    ),
    row(
      "function.localKey.tonic.step",
      "DiatonicStep | undefined",
      chord.function?.localKey?.tonic.step,
    ),
    row(
      "function.localKey.tonic.alter",
      "Alteration | undefined",
      chord.function?.localKey?.tonic.alter,
    ),
    row(
      "function.localKey.mode",
      "KeyMode | undefined",
      chord.function?.localKey?.mode,
    ),
    row("function.degree", "number | undefined", chord.function?.degree),
    row(
      "function.degreeAlteration",
      "Alteration | undefined",
      chord.function?.degreeAlteration,
    ),
    row(
      "function.quality",
      "ChordQuality | undefined",
      chord.function?.quality,
    ),
    row("function.inversion", "number | undefined", chord.function?.inversion),
    row(
      "function.applied",
      "AppliedFunction | undefined",
      chord.function?.applied ? "{…}" : undefined,
    ),
    row(
      "function.applied.targetDegree",
      "number | undefined",
      chord.function?.applied?.targetDegree,
    ),
    row("function.mixture", "string | undefined", chord.function?.mixture),
    row(
      "function.cadenceRole",
      "string | undefined",
      chord.function?.cadenceRole,
    ),
    row("function.source", "string | undefined", chord.function?.source),
    row("locked", "boolean", chord.locked),
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
