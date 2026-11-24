import type { AuxiliaryTrackExportOptions } from "../exportTracks";
import { formatPitchClass } from "../pitch";
import type { ProjectDocument } from "../project";

export type MusicXmlLayout = "single-staff" | "grand-staff" | "satb-separate";

export interface MusicXmlExportOptions extends AuxiliaryTrackExportOptions {
  layout?: MusicXmlLayout;
  includeChords?: boolean;
  includeRomanNumerals?: boolean;
}

export type MusicXmlExportPreferences = Required<
  Omit<MusicXmlExportOptions, "auxiliaryTrackIds">
>;

export const DEFAULT_MUSICXML_EXPORT_OPTIONS: MusicXmlExportPreferences =
  Object.freeze({
    layout: "grand-staff",
    includeChords: true,
    includeRomanNumerals: true,
    includeAuxiliaryTracks: true,
  });

export function musicXmlFileName(
  project: ProjectDocument,
  layout: MusicXmlLayout = "grand-staff",
) {
  const safe = (project.title || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ");
  const baseName =
    safe ||
    `${formatPitchClass(project.keyEvents[0]?.tonic ?? { step: "C", alter: 0 })}调四部和声`;
  const suffix =
    layout === "single-staff"
      ? "（单轨）"
      : layout === "grand-staff"
        ? "（大谱表）"
        : "（分轨总谱）";
  return `${baseName}${suffix}`;
}
