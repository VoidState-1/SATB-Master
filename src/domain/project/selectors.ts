import type { ProjectDocument, VoiceId } from "./types";

export function cloneProject(project: ProjectDocument): ProjectDocument {
  return structuredClone(project);
}

export function getSatbTrack(project: ProjectDocument, voiceId: VoiceId) {
  const track = project.satbTracks.find((item) => item.id === voiceId);
  if (!track) throw new Error(`工程缺少声部：${voiceId}`);
  return track;
}

export const getTrack = getSatbTrack;

export function getAllPlayableTracks(project: ProjectDocument) {
  return [...project.satbTracks, ...project.auxiliaryTracks];
}

export function getMusicalTrack(project: ProjectDocument, trackId: string) {
  const track = getAllPlayableTracks(project).find(
    (item) => item.id === trackId,
  );
  if (!track) throw new Error(`工程缺少轨道：${trackId}`);
  return track;
}
