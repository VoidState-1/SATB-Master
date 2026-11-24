import type { ProjectDocument } from "./project";

export interface AuxiliaryTrackExportOptions {
  includeAuxiliaryTracks?: boolean;
  auxiliaryTrackIds?: readonly string[];
}

export function getExportAuxiliaryTracks(
  project: ProjectDocument,
  options: AuxiliaryTrackExportOptions,
) {
  if (options.includeAuxiliaryTracks === false) return [];
  if (options.auxiliaryTrackIds === undefined) return project.auxiliaryTracks;

  const includedIds = new Set(options.auxiliaryTrackIds);
  return project.auxiliaryTracks.filter((track) => includedIds.has(track.id));
}

const MELODIC_MIDI_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15] as const;

export function melodicMidiChannel(index: number): number {
  return MELODIC_MIDI_CHANNELS[index % MELODIC_MIDI_CHANNELS.length];
}
