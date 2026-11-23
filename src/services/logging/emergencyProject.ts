import type { ProjectDocument } from "../../domain/project";

let emergencyProjectProvider: (() => ProjectDocument) | undefined;

export function registerEmergencyProjectProvider(provider: () => ProjectDocument) {
  emergencyProjectProvider = provider;
  return () => {
    if (emergencyProjectProvider === provider) emergencyProjectProvider = undefined;
  };
}

export function hasEmergencyProjectProvider() {
  return emergencyProjectProvider !== undefined;
}

export function getEmergencyProject() {
  return emergencyProjectProvider?.();
}

export function summarizeEmergencyProject(project: ProjectDocument) {
  return {
    schemaVersion: project.schemaVersion,
    lengthTicks: project.lengthTicks,
    noteCounts: Object.fromEntries(project.satbTracks.map(track => [track.id, track.notes.length])),
    chordRegionCount: project.chordTrack.regions.length,
    auxiliaryTrackCount: project.auxiliaryTracks.length,
    externalRuleCount: project.ruleProfile.external.length,
    soundFontKind: project.audio.soundFont.kind,
  };
}
