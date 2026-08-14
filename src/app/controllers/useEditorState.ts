import { useMemo, useRef, useState } from "react";
import { defaultChordDraftAtTick } from "../../domain/chords";
import type {
  ChordDraft,
  ChordRegion,
  NoteEvent,
  ProjectDocument,
  VoiceId,
} from "../../domain/project";
import {
  DEFAULT_GRID_TICKS,
  DEFAULT_PIXELS_PER_BEAT,
  type EditorTool,
} from "../../features/editor";

export interface ClipboardNote {
  voiceId: VoiceId;
  note: NoteEvent;
  offset: number;
}

export interface ClipboardChord {
  region: ChordRegion;
  offset: number;
}

export type ClipboardPayload =
  | { kind: "notes"; items: ClipboardNote[] }
  | { kind: "chords"; items: ClipboardChord[] };

export type EditorDomain = "notes" | "chords";

export function useEditorState(
  initialProject: ProjectDocument,
  project: ProjectDocument,
) {
  const [activeVoice, setActiveVoice] = useState<VoiceId>("soprano");
  const [tool, setTool] = useState<EditorTool>("select");
  const [editorDomain, setEditorDomain] = useState<EditorDomain>("notes");
  const [toolModifiers, setToolModifiers] = useState({
    control: false,
    alt: false,
  });
  const [editorInteractionActive, setEditorInteractionActive] = useState(false);
  const [cancelEditorRequest, setCancelEditorRequest] = useState(0);
  const [gridTicks, setGridTicks] = useState(DEFAULT_GRID_TICKS);
  const [pixelsPerBeat, setPixelsPerBeat] = useState(DEFAULT_PIXELS_PER_BEAT);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedChordIds, setSelectedChordIds] = useState<Set<string>>(
    new Set(),
  );
  const [chordBrush, setChordBrush] = useState<ChordDraft>(() =>
    defaultChordDraftAtTick(initialProject, 0),
  );
  const clipboardRef = useRef<ClipboardPayload | undefined>(undefined);

  const effectiveTool: EditorTool =
    tool === "select"
      ? toolModifiers.alt
        ? "eraser"
        : toolModifiers.control
          ? "pencil"
          : "select"
      : tool;

  const selectedNote = useMemo(() => {
    const id = selectedNoteIds.values().next().value as string | undefined;
    if (!id) return undefined;
    for (const track of project.satbTracks) {
      const note = track.notes.find((candidate) => candidate.id === id);
      if (note) return { voiceId: track.id, note };
    }
    return undefined;
  }, [project, selectedNoteIds]);
  const selectedChord =
    selectedChordIds.size === 1
      ? project.chordTrack.regions.find(
          (chord) => chord.id === selectedChordIds.values().next().value,
        )
      : undefined;

  return {
    activeVoice,
    setActiveVoice,
    tool,
    setTool,
    editorDomain,
    setEditorDomain,
    toolModifiers,
    setToolModifiers,
    editorInteractionActive,
    setEditorInteractionActive,
    cancelEditorRequest,
    setCancelEditorRequest,
    gridTicks,
    setGridTicks,
    pixelsPerBeat,
    setPixelsPerBeat,
    selectedNoteIds,
    setSelectedNoteIds,
    selectedChordIds,
    setSelectedChordIds,
    chordBrush,
    setChordBrush,
    effectiveTool,
    selectedNote,
    selectedChord,
    clipboardRef,
  } as const;
}

export type EditorState = ReturnType<typeof useEditorState>;
