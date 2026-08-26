import type { RenderContext, Stave, StaveNote, Voice } from "vexflow";
import {
  keySignatureFifths,
  type DiatonicStep,
} from "../../domain/pitch";
import type { VoiceId } from "../../domain/project";
import {
  scoreVoiceLayout,
  type ScoreEvent,
  type ScoreMeasure,
  type ScoreNoteEvent,
  type ScorePreviewModel,
  type ScorePreviewWarning,
  type ScoreStaff,
  type ScoreVoice,
} from "../../domain/notation";

export interface ScoreNoteSelection {
  sourceNoteId: string;
  voiceId: ScoreNoteEvent["voiceId"];
  tick: number;
}

export type VexFlowModule = typeof import("vexflow");

let loadedVexFlow: VexFlowModule | undefined;
let vexFlowLoad: Promise<VexFlowModule> | undefined;

export function loadVexFlow() {
  if (loadedVexFlow) return Promise.resolve(loadedVexFlow);
  vexFlowLoad ??= import("vexflow").then((module) => {
    loadedVexFlow = module;
    return module;
  });
  return vexFlowLoad;
}

export interface RenderScorePreviewOptions {
  scale?: number;
  playheadTick?: number;
  onNoteClick?(selection: ScoreNoteSelection): void;
}

export interface RenderScorePreviewResult {
  width: number;
  height: number;
  warnings: readonly ScorePreviewWarning[];
  cleanup(): void;
}

const BASE_SYSTEM_WIDTH = 920;
const BASE_SYSTEM_HEIGHT = 184;
const STAVE_X = 76;
const STAVE_WIDTH = BASE_SYSTEM_WIDTH - STAVE_X - 24;
const TREBLE_Y = 24;
const BASS_Y = 102;

const SHARP_ORDER: readonly DiatonicStep[] = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER: readonly DiatonicStep[] = ["B", "E", "A", "D", "G", "C", "F"];

function accidentalText(alter: number) {
  if (alter === -2) return "bb";
  if (alter === -1) return "b";
  if (alter === 1) return "#";
  if (alter === 2) return "##";
  return "n";
}

function keyForPitch(event: ScoreNoteEvent) {
  return event.pitch.step.toLowerCase() + "/" + event.pitch.octave;
}

function keySignatureAccidentals(measure: ScoreMeasure) {
  const result = new Map<DiatonicStep, number>();
  if (!measure.keySignature) return result;
  const fifths = keySignatureFifths(measure.key);
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  const alter = fifths >= 0 ? 1 : -1;
  order.slice(0, Math.abs(fifths)).forEach((step) => result.set(step, alter));
  return result;
}

function accidentalStateKey(event: ScoreNoteEvent) {
  return `${event.pitch.step}/${event.pitch.octave}`;
}

function notationKey(event: ScoreEvent, staff: ScoreStaff) {
  if (event.kind === "note") return keyForPitch(event);
  return staff === "treble" ? "b/4" : "d/3";
}

function createStaveNote(
  vexflow: VexFlowModule,
  event: Exclude<ScoreEvent, { kind: "unsupported" }>,
  staff: ScoreStaff,
  stemDirection: "up" | "down",
  accidentalState: Map<string, number>,
  keyAccidentals: Map<DiatonicStep, number>,
) {
  const note = new vexflow.StaveNote({
    keys: [notationKey(event, staff)],
    duration:
      event.kind === "rest" ? event.duration.value + "r" : event.duration.value,
    dots: event.duration.dots,
    type: event.kind === "rest" ? "r" : undefined,
    clef: staff,
    stemDirection: stemDirection === "up" ? vexflow.Stem.UP : vexflow.Stem.DOWN,
  });
  if (event.duration.dots > 0) vexflow.Dot.buildAndAttach([note], { all: true });
  if (event.kind !== "note") return note;

  const defaultAlter =
    accidentalState.get(accidentalStateKey(event)) ??
    keyAccidentals.get(event.pitch.step) ??
    0;
  if (event.pitch.alter !== defaultAlter) {
    note.addModifier(new vexflow.Accidental(accidentalText(event.pitch.alter)), 0);
  }
  accidentalState.set(accidentalStateKey(event), event.pitch.alter);
  note.setAttribute("data-source-note-id", event.sourceNoteId);
  note.setAttribute("data-voice-id", event.voiceId);
  note.setAttribute("data-tick", String(event.fromTick));
  note.setAttribute("aria-label", event.sourceNoteId);
  return note;
}

function voiceFor(
  vexflow: VexFlowModule,
  measure: ScoreMeasure,
  scoreVoice: ScoreVoice,
  staff: ScoreStaff,
  accidentalState: Map<string, number>,
  keyAccidentals: Map<DiatonicStep, number>,
) {
  const layout = scoreVoiceLayout(scoreVoice.voiceId);
  const voice = new vexflow.Voice({
    numBeats: measure.numerator,
    beatValue: measure.denominator,
  });
  voice.setMode(vexflow.Voice.Mode.SOFT);
  const noteRefs: Array<{ event: ScoreNoteEvent; note: StaveNote }> = [];
  const tickables = scoreVoice.events
    .filter(
      (event): event is Exclude<ScoreEvent, { kind: "unsupported" }> =>
        event.kind !== "unsupported",
    )
    .map((event) => {
      const note = createStaveNote(
        vexflow,
        event,
        staff,
        layout.stemDirection,
        accidentalState,
        keyAccidentals,
      );
      if (event.kind === "note") noteRefs.push({ event, note });
      return note;
    });
  voice.addTickables(tickables);
  return { voice, noteRefs };
}

function formatStaff(
  vexflow: VexFlowModule,
  context: RenderContext,
  stave: Stave,
  voices: Voice[],
) {
  if (voices.length === 0) return;
  new vexflow.Formatter()
    .joinVoices(voices)
    .format(voices, stave.getNoteEndX() - stave.getNoteStartX() - 14, {
      alignRests: true,
      autoBeam: false,
    });
  voices.forEach((voice) => voice.draw(context, stave));
}

function drawTies(
  vexflow: VexFlowModule,
  context: RenderContext,
  noteRefs: Array<{ event: ScoreNoteEvent; note: StaveNote }>,
) {
  for (let index = 1; index < noteRefs.length; index += 1) {
    const previous = noteRefs[index - 1];
    const current = noteRefs[index];
    if (
      previous.event.sourceNoteId !== current.event.sourceNoteId ||
      !current.event.tieFromPrevious
    )
      continue;
    new vexflow.StaveTie({ firstNote: previous.note, lastNote: current.note })
      .setContext(context)
      .draw();
  }
}

interface RenderedNoteRef {
  event: ScoreNoteEvent;
  note: StaveNote;
  context: RenderContext;
}

function drawPartialTie(
  vexflow: VexFlowModule,
  context: RenderContext,
  note: StaveNote,
  side: "start" | "end",
) {
  new vexflow.StaveTie({
    firstNote: side === "end" ? note : undefined,
    lastNote: side === "start" ? note : undefined,
  })
    .setContext(context)
    .draw();
}

function drawMeasure(
  vexflow: VexFlowModule,
  host: HTMLDivElement,
  context: RenderContext,
  measure: ScoreMeasure,
  options: RenderScorePreviewOptions,
  previousNotes: Map<ScoreNoteEvent["voiceId"], RenderedNoteRef | undefined>,
) {
  const treble = new vexflow.Stave(STAVE_X, TREBLE_Y, STAVE_WIDTH, {
    leftBar: true,
    rightBar: true,
  });
  const bass = new vexflow.Stave(STAVE_X, BASS_Y, STAVE_WIDTH, {
    leftBar: true,
    rightBar: true,
  });
  treble
    .addClef("treble")
    .addTimeSignature(measure.numerator + "/" + measure.denominator);
  bass
    .addClef("bass")
    .addTimeSignature(measure.numerator + "/" + measure.denominator);
  if (measure.keySignature) {
    treble.addKeySignature(measure.keySignature);
    bass.addKeySignature(measure.keySignature);
  }
  treble.setMeasure(measure.number);
  bass.setMeasure(measure.number);
  treble.setContext(context).draw();
  bass.setContext(context).draw();
  new vexflow.StaveConnector(treble, bass)
    .setType(vexflow.StaveConnector.type.BRACE)
    .setContext(context)
    .draw();
  new vexflow.StaveConnector(treble, bass)
    .setType(vexflow.StaveConnector.type.SINGLE_LEFT)
    .setContext(context)
    .draw();

  const trebleAccidentals = keySignatureAccidentals(measure);
  const bassAccidentals = keySignatureAccidentals(measure);
  const sopranoAccidentals = new Map<string, number>();
  const altoAccidentals = new Map<string, number>();
  const tenorAccidentals = new Map<string, number>();
  const bassAccidentalsByVoice = new Map<string, number>();
  const trebleVoices = [
    voiceFor(
      vexflow,
      measure,
      measure.voices.soprano,
      "treble",
      sopranoAccidentals,
      trebleAccidentals,
    ),
    voiceFor(
      vexflow,
      measure,
      measure.voices.alto,
      "treble",
      altoAccidentals,
      trebleAccidentals,
    ),
  ];
  const bassVoices = [
    voiceFor(
      vexflow,
      measure,
      measure.voices.tenor,
      "bass",
      tenorAccidentals,
      bassAccidentals,
    ),
    voiceFor(
      vexflow,
      measure,
      measure.voices.bass,
      "bass",
      bassAccidentalsByVoice,
      bassAccidentals,
    ),
  ];
  formatStaff(vexflow, context, treble, trebleVoices.map((item) => item.voice));
  formatStaff(vexflow, context, bass, bassVoices.map((item) => item.voice));
  const voiceResults = [
    { ...trebleVoices[0], voiceId: "soprano" as const },
    { ...trebleVoices[1], voiceId: "alto" as const },
    { ...bassVoices[0], voiceId: "tenor" as const },
    { ...bassVoices[1], voiceId: "bass" as const },
  ] as const;
  voiceResults.forEach(({ noteRefs }) => drawTies(vexflow, context, noteRefs));
  const renderedNotes: RenderedNoteRef[] = [];
  voiceResults.forEach(({ voiceId, noteRefs }) => {
    const first = noteRefs[0];
    const previous = previousNotes.get(voiceId);
    if (
      first &&
      previous &&
      first.event.sourceNoteId === previous.event.sourceNoteId &&
      first.event.tieFromPrevious &&
      previous.event.tieToNext
    ) {
      drawPartialTie(vexflow, previous.context, previous.note, "end");
      drawPartialTie(vexflow, context, first.note, "start");
    }
    const last = noteRefs.at(-1);
    previousNotes.set(
      voiceId,
      last ? { event: last.event, note: last.note, context } : undefined,
    );
    noteRefs.forEach(({ event, note }) =>
      renderedNotes.push({ event, note, context }),
    );
  });

  const allNotes = renderedNotes;
  const listeners: (() => void)[] = [];
  allNotes.forEach(({ event, note }) => {
    const element = note.getSVGElement();
    if (!element) return;
    element.dataset.sourceNoteId = event.sourceNoteId;
    element.dataset.voiceId = event.voiceId;
    element.dataset.tick = String(event.fromTick);
    element.style.cursor = options.onNoteClick ? "pointer" : "default";
    if (!options.onNoteClick) return;
    const handler = () =>
      options.onNoteClick?.({
        sourceNoteId: event.sourceNoteId,
        voiceId: event.voiceId,
        tick: event.fromTick,
      });
    element.addEventListener("click", handler);
    listeners.push(() => element.removeEventListener("click", handler));
  });
  host.dataset.fromTick = String(measure.fromTick);
  host.dataset.toTick = String(measure.toTick);
  if (
    options.playheadTick !== undefined &&
    options.playheadTick >= measure.fromTick &&
    options.playheadTick < measure.toTick
  ) {
    host.dataset.active = "true";
  }
  return listeners;
}

export function renderScorePreview(
  container: HTMLDivElement,
  model: ScorePreviewModel,
  options: RenderScorePreviewOptions = {},
  vexflow?: VexFlowModule,
): RenderScorePreviewResult {
  const scale = Math.max(0.75, Math.min(1.5, options.scale ?? 1));
  const width = BASE_SYSTEM_WIDTH * scale;
  const height = BASE_SYSTEM_HEIGHT * scale * Math.max(1, model.measures.length);
  container.replaceChildren();
  const cleanups: (() => void)[] = [];
  const warnings: ScorePreviewWarning[] = [];
  const previousNotes = new Map<VoiceId, RenderedNoteRef | undefined>();
  const activeVexFlow = vexflow ?? loadedVexFlow;
  if (!activeVexFlow) {
    const host = document.createElement("div");
    host.className = "score-preview-system";
    host.dataset.renderError = "true";
    host.textContent = "乐谱引擎尚未加载";
    host.style.width = String(width) + "px";
    host.style.height = String(BASE_SYSTEM_HEIGHT * scale) + "px";
    container.append(host);
    warnings.push({
      code: "render-error",
      message: "乐谱预览不可用：VexFlow 尚未加载。",
    });
    return {
      width,
      height,
      warnings: Object.freeze(warnings),
      cleanup: () => container.replaceChildren(),
    };
  }

  model.measures.forEach((measure) => {
    const host = document.createElement("div");
    host.className = "score-preview-system";
    host.style.width = String(width) + "px";
    host.style.height = String(BASE_SYSTEM_HEIGHT * scale) + "px";
    host.dataset.measure = String(measure.number);
    container.append(host);
    try {
      const context = activeVexFlow.Renderer.buildContext(
        host,
        activeVexFlow.Renderer.Backends.SVG,
        width,
        BASE_SYSTEM_HEIGHT * scale,
      );
      context.scale(scale, scale);
      const listeners =
        drawMeasure(
          activeVexFlow,
          host,
          context,
          measure,
          options,
          previousNotes,
        ) ??
        [];
      cleanups.push(...listeners);
    } catch (error) {
      host.dataset.renderError = "true";
      const message = error instanceof Error ? error.message : "乐谱渲染失败";
      host.textContent = message;
      warnings.push({
        code: "render-error",
        message: `第 ${measure.number} 小节渲染失败：${message}`,
        fromTick: measure.fromTick,
        toTick: measure.toTick,
      });
      previousNotes.clear();
    }
  });

  return {
    width,
    height,
    warnings: Object.freeze(warnings),
    cleanup: () => {
      cleanups.forEach((cleanup) => cleanup());
      container.replaceChildren();
    },
  };
}
