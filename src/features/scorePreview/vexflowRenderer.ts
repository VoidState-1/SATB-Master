import type { Beam, RenderContext, Stave, StaveNote, Voice } from "vexflow";
import { keySignatureFifths, type DiatonicStep } from "../../domain/pitch";
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

export interface ScoreRenderedNoteRef {
  element: SVGElement;
  fromTick: number;
  toTick: number;
  voiceId: ScoreNoteEvent["voiceId"];
  sourceNoteId: string;
}

export type VexFlowModule = typeof import("vexflow");

let loadedVexFlow: VexFlowModule | undefined;
let vexFlowLoad: Promise<VexFlowModule> | undefined;

export function loadVexFlow() {
  if (loadedVexFlow) return Promise.resolve(loadedVexFlow);
  vexFlowLoad ??= (async () => {
    const module = await import("vexflow");
    if (typeof document !== "undefined" && "fonts" in document) {
      try {
        await Promise.allSettled([
          document.fonts.load("20pt Bravura"),
          document.fonts.load("20pt Academico"),
          document.fonts.ready,
        ]);
      } catch {
        await document.fonts.ready;
      }
    }
    loadedVexFlow = module;
    return module;
  })();
  return vexFlowLoad;
}

export interface RenderScorePreviewOptions {
  scale?: number;
  playheadTick?: number;
  /** Available width in CSS pixels. If omitted, the renderer reads its scroll viewport. */
  availableWidth?: number;
  onNoteClick?(selection: ScoreNoteSelection): void;
  /** Positions in CSS pixels relative to this staff system after VexFlow formatting. */
  onMeasureLayout?(measure: ScoreMeasureLayout): void;
}

export interface ScoreMeasureLayout {
  host: HTMLDivElement;
  measure: ScoreMeasure;
  left: number;
  right: number;
  anchors: { tick: number; x: number }[];
}

export interface RenderScorePreviewResult {
  width: number;
  height: number;
  warnings: readonly ScorePreviewWarning[];
  noteElementRefs: readonly ScoreRenderedNoteRef[];
  cleanup(): void;
}

const DEFAULT_SYSTEM_WIDTH = 920;
const MIN_SYSTEM_WIDTH = 420;
const SYSTEM_START_X = 16;
const SYSTEM_RIGHT_MARGIN = 16;
const NOTE_WIDTH = 36;
const NOTE_AREA_PADDING = 36;
const HEADER_MODIFIERS_WIDTH = 120;
const TREBLE_TOP_PADDING = 20;
const STAFF_GAP = 112;
const STAVE_HEIGHT = 40;
const SYSTEM_BOTTOM_PADDING = 20;

const SHARP_ORDER: readonly DiatonicStep[] = [
  "F",
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
];
const FLAT_ORDER: readonly DiatonicStep[] = ["B", "E", "A", "D", "G", "C", "F"];

const DIATONIC_STEP_INDEX: Record<DiatonicStep, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

interface SystemVerticalLayout {
  trebleY: number;
  bassY: number;
  height: number;
}

interface MeasureLayout {
  measure: ScoreMeasure;
  width: number;
  showClefAndTime: boolean;
  showKeySignature: boolean;
}

interface ScoreSystemLayout {
  measures: readonly MeasureLayout[];
  width: number;
}

function diatonicPosition(step: DiatonicStep, octave: number) {
  return octave * 7 + DIATONIC_STEP_INDEX[step];
}

function eventCount(measure: ScoreMeasure) {
  return Math.max(
    ...Object.values(measure.voices).map(
      (voice) =>
        voice.events.filter((event) => event.kind !== "unsupported").length,
    ),
    1,
  );
}

function measureWidth(
  measure: ScoreMeasure,
  showClefAndTime: boolean,
  showKeySignature: boolean,
) {
  const modifiers =
    (showClefAndTime ? HEADER_MODIFIERS_WIDTH : 0) +
    (showKeySignature && !showClefAndTime ? 25 : 0);
  const content = NOTE_AREA_PADDING + eventCount(measure) * NOTE_WIDTH;
  const minimum = showClefAndTime ? 190 : 120;
  return Math.max(minimum, modifiers + content);
}

function createVerticalLayout(model: ScorePreviewModel): SystemVerticalLayout {
  const trebleTopLine = diatonicPosition("F", 5);
  const bassTopLine = diatonicPosition("A", 3);
  let trebleMin = 0;
  let bassMax = 0;
  model.measures.forEach((measure) => {
    (Object.values(measure.voices) as ScoreVoice[]).forEach((voice) => {
      const layout = scoreVoiceLayout(voice.voiceId);
      voice.events.forEach((event) => {
        if (event.kind !== "note") return;
        const reference =
          layout.staff === "treble" ? trebleTopLine : bassTopLine;
        const relativeY =
          -(
            diatonicPosition(event.pitch.step, event.pitch.octave) - reference
          ) * 5;
        if (layout.staff === "treble") {
          const top = relativeY - (layout.stemDirection === "up" ? 35 : 5);
          trebleMin = Math.min(trebleMin, top);
        } else {
          const bottom = relativeY + (layout.stemDirection === "down" ? 35 : 5);
          bassMax = Math.max(bassMax, bottom);
        }
      });
    });
  });
  const trebleY = TREBLE_TOP_PADDING - trebleMin;
  const bassY = trebleY + STAFF_GAP;
  const height = Math.max(
    bassY + STAVE_HEIGHT + bassMax + SYSTEM_BOTTOM_PADDING,
    bassY + STAVE_HEIGHT + SYSTEM_BOTTOM_PADDING,
  );
  return { trebleY, bassY, height: Math.ceil(height) };
}

function justifyMeasures(
  measures: readonly MeasureLayout[],
  targetWidth: number,
): MeasureLayout[] {
  if (measures.length === 0) return [];
  const naturalTotal = measures.reduce((sum, m) => sum + m.width, 0);
  if (targetWidth > naturalTotal && naturalTotal >= targetWidth * 0.55) {
    const extra = targetWidth - naturalTotal;
    let distributed = 0;
    return measures.map((m, index) => {
      if (index === measures.length - 1) {
        return { ...m, width: m.width + (extra - distributed) };
      }
      const added = Math.round(extra * (m.width / naturalTotal));
      distributed += added;
      return { ...m, width: m.width + added };
    });
  }
  return measures.map((m) => ({ ...m }));
}

function createSystemLayout(
  model: ScorePreviewModel,
  availableLogicalWidth: number,
): readonly ScoreSystemLayout[] {
  const usableWidth = Math.max(
    MIN_SYSTEM_WIDTH - SYSTEM_START_X - SYSTEM_RIGHT_MARGIN,
    availableLogicalWidth - SYSTEM_START_X - SYSTEM_RIGHT_MARGIN,
  );
  const systems: ScoreSystemLayout[] = [];
  let current: MeasureLayout[] = [];
  let currentWidth = 0;
  let previousKeySignature: string | undefined;

  model.measures.forEach((measure) => {
    const startsSystem = current.length === 0;
    const showClefAndTime = startsSystem;
    const showKeySignature =
      startsSystem || measure.keySignature !== previousKeySignature;
    const width = measureWidth(measure, showClefAndTime, showKeySignature);

    if (current.length > 0 && currentWidth + width > usableWidth) {
      const justified = justifyMeasures(current, usableWidth);
      const totalWidth =
        justified.reduce((s, m) => s + m.width, 0) +
        SYSTEM_START_X +
        SYSTEM_RIGHT_MARGIN;
      systems.push({ measures: Object.freeze(justified), width: totalWidth });
      current = [];
      currentWidth = 0;
      const nextWidth = measureWidth(measure, true, true);
      current.push({
        measure,
        width: nextWidth,
        showClefAndTime: true,
        showKeySignature: true,
      });
      currentWidth = nextWidth;
    } else {
      current.push({
        measure,
        width,
        showClefAndTime,
        showKeySignature,
      });
      currentWidth += width;
    }
    previousKeySignature = measure.keySignature;
  });

  if (current.length > 0) {
    const justified = justifyMeasures(current, usableWidth);
    const totalWidth =
      justified.reduce((s, m) => s + m.width, 0) +
      SYSTEM_START_X +
      SYSTEM_RIGHT_MARGIN;
    systems.push({ measures: Object.freeze(justified), width: totalWidth });
  }

  return Object.freeze(systems);
}

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
  if (event.duration.dots > 0)
    vexflow.Dot.buildAndAttach([note], { all: true });
  if (event.kind !== "note") return note;

  const defaultAlter =
    accidentalState.get(accidentalStateKey(event)) ??
    keyAccidentals.get(event.pitch.step) ??
    0;
  if (event.pitch.alter !== defaultAlter) {
    note.addModifier(
      new vexflow.Accidental(accidentalText(event.pitch.alter)),
      0,
    );
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

  let beams: Beam[] = [];
  try {
    const timeSig = `${measure.numerator}/${measure.denominator}`;
    const stemDirection =
      layout.stemDirection === "up" ? vexflow.Stem.UP : vexflow.Stem.DOWN;
    beams = vexflow.Beam.generateBeams(tickables, {
      groups: vexflow.Beam.getDefaultBeamGroups(timeSig),
      maintainStemDirections: true,
      beamRests: false,
      stemDirection,
    });
  } catch {
    beams = [];
  }

  return { voice, noteRefs, beams };
}

function formatGrandStaff(
  vexflow: VexFlowModule,
  context: RenderContext,
  treble: Stave,
  bass: Stave,
  trebleVoices: Voice[],
  bassVoices: Voice[],
) {
  trebleVoices.forEach((voice) => voice.setStave(treble));
  bassVoices.forEach((voice) => voice.setStave(bass));

  const allVoices = [...trebleVoices, ...bassVoices];
  if (allVoices.length === 0) return;

  const startX = Math.max(treble.getNoteStartX(), bass.getNoteStartX());
  const endX = Math.min(treble.getNoteEndX(), bass.getNoteEndX());
  const justifyWidth = Math.max(20, endX - startX - 10);

  const formatter = new vexflow.Formatter();
  if (trebleVoices.length > 0) formatter.joinVoices(trebleVoices);
  if (bassVoices.length > 0) formatter.joinVoices(bassVoices);

  formatter.format(allVoices, justifyWidth, { alignRests: true });
  formatter.postFormat();

  trebleVoices.forEach((voice) => voice.draw(context, treble));
  bassVoices.forEach((voice) => voice.draw(context, bass));
}

interface RenderedNoteRef {
  event: ScoreNoteEvent;
  note: StaveNote;
  context: RenderContext;
}

interface MeasureDrawContext {
  isFirstInSystem: boolean;
  isLastInSystem: boolean;
  isVeryLastMeasure: boolean;
}

function drawMeasure(
  vexflow: VexFlowModule,
  host: HTMLDivElement,
  context: RenderContext,
  measure: ScoreMeasure,
  measureLayout: MeasureLayout,
  verticalLayout: SystemVerticalLayout,
  staveX: number,
  drawCtx: MeasureDrawContext,
  options: RenderScorePreviewOptions,
) {
  const staveWidth = measureLayout.width;
  const treble = new vexflow.Stave(staveX, verticalLayout.trebleY, staveWidth);
  const bass = new vexflow.Stave(staveX, verticalLayout.bassY, staveWidth);

  if (drawCtx.isFirstInSystem) {
    treble.setBegBarType(vexflow.Barline.type.SINGLE);
    bass.setBegBarType(vexflow.Barline.type.SINGLE);
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
  } else {
    treble.setBegBarType(vexflow.Barline.type.NONE);
    bass.setBegBarType(vexflow.Barline.type.NONE);
    if (measureLayout.showKeySignature && measure.keySignature) {
      treble.addKeySignature(measure.keySignature);
      bass.addKeySignature(measure.keySignature);
    }
  }

  if (drawCtx.isVeryLastMeasure) {
    treble.setEndBarType(vexflow.Barline.type.END);
    bass.setEndBarType(vexflow.Barline.type.END);
  } else {
    treble.setEndBarType(vexflow.Barline.type.SINGLE);
    bass.setEndBarType(vexflow.Barline.type.SINGLE);
  }

  // Format beginning modifiers across treble and bass so note start X lines up identically
  try {
    vexflow.Stave.formatBegModifiers([treble, bass]);
  } catch {
    // fallback
  }

  treble.setContext(context).draw();
  bass.setContext(context).draw();

  if (drawCtx.isFirstInSystem) {
    new vexflow.StaveConnector(treble, bass)
      .setType(vexflow.StaveConnector.type.BRACE)
      .setContext(context)
      .draw();
    new vexflow.StaveConnector(treble, bass)
      .setType(vexflow.StaveConnector.type.SINGLE_LEFT)
      .setContext(context)
      .draw();
  }

  if (drawCtx.isLastInSystem) {
    new vexflow.StaveConnector(treble, bass)
      .setType(vexflow.StaveConnector.type.SINGLE_RIGHT)
      .setContext(context)
      .draw();
  }

  const trebleAccidentals = keySignatureAccidentals(measure);
  const bassAccidentals = keySignatureAccidentals(measure);
  const sopranoAccidentals = new Map<string, number>();
  const altoAccidentals = new Map<string, number>();
  const tenorAccidentals = new Map<string, number>();
  const bassAccidentalsByVoice = new Map<string, number>();

  const sopranoResult = voiceFor(
    vexflow,
    measure,
    measure.voices.soprano,
    "treble",
    sopranoAccidentals,
    trebleAccidentals,
  );
  const altoResult = voiceFor(
    vexflow,
    measure,
    measure.voices.alto,
    "treble",
    altoAccidentals,
    trebleAccidentals,
  );
  const tenorResult = voiceFor(
    vexflow,
    measure,
    measure.voices.tenor,
    "bass",
    tenorAccidentals,
    bassAccidentals,
  );
  const bassResult = voiceFor(
    vexflow,
    measure,
    measure.voices.bass,
    "bass",
    bassAccidentalsByVoice,
    bassAccidentals,
  );

  formatGrandStaff(
    vexflow,
    context,
    treble,
    bass,
    [sopranoResult.voice, altoResult.voice],
    [tenorResult.voice, bassResult.voice],
  );

  const allBeams = [
    ...sopranoResult.beams,
    ...altoResult.beams,
    ...tenorResult.beams,
    ...bassResult.beams,
  ];
  allBeams.forEach((beam) => {
    try {
      beam.setContext(context).draw();
    } catch {
      // safe fallback
    }
  });

  const renderedNotes: RenderedNoteRef[] = [];
  const voiceResults = [
    { ...sopranoResult, voiceId: "soprano" as const },
    { ...altoResult, voiceId: "alto" as const },
    { ...tenorResult, voiceId: "tenor" as const },
    { ...bassResult, voiceId: "bass" as const },
  ];

  if (options.onMeasureLayout) {
    const scale = Math.max(0.75, Math.min(1.5, options.scale ?? 1));
    const positions = new Map<number, number>([[measure.fromTick, treble.getNoteStartX()]]);
    const soundingTicks = new Set<number>();
    for (const { voice, voiceId } of voiceResults) {
      const events = measure.voices[voiceId].events.filter(event => event.kind !== "unsupported");
      const tickables = voice.getTickables() as StaveNote[];
      events.forEach((event, index) => {
        // A whole-measure rest is centered on the page, not placed at the beat.
        if (event.kind === "rest" && (soundingTicks.has(event.fromTick) || event.toTick - event.fromTick === measure.toTick - measure.fromTick)) return;
        const note = tickables[index];
        positions.set(event.fromTick, (note.getNoteHeadBeginX() + note.getNoteHeadEndX()) / 2);
        if (event.kind === "note") soundingTicks.add(event.fromTick);
      });
    }
    positions.set(measure.toTick, staveX + staveWidth);
    options.onMeasureLayout({
      host, measure, left: staveX * scale, right: (staveX + staveWidth) * scale,
      anchors: [...positions].sort(([a], [b]) => a - b).map(([tick, x]) => ({ tick, x: x * scale })),
    });
  }

  voiceResults.forEach(({ noteRefs }) => {
    noteRefs.forEach(({ event, note }) =>
      renderedNotes.push({ event, note, context }),
    );
  });

  const listeners: (() => void)[] = [];
  const noteElementRefs: ScoreRenderedNoteRef[] = [];
  renderedNotes.forEach(({ event, note }) => {
    const element =
      note.getSVGElement() ??
      host.querySelector<SVGElement>(`#vf-${note.getAttribute("id")}`);
    if (!element) return;
    element.dataset.sourceNoteId = event.sourceNoteId;
    element.dataset.voiceId = event.voiceId;
    element.dataset.tick = String(event.fromTick);
    element.dataset.fromTick = String(event.fromTick);
    element.dataset.toTick = String(event.toTick);
    element.classList.add("score-note");
    noteElementRefs.push({
      element,
      fromTick: event.fromTick,
      toTick: event.toTick,
      voiceId: event.voiceId,
      sourceNoteId: event.sourceNoteId,
    });
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

  return {
    listeners,
    noteElementRefs,
    noteRefsByVoice: {
      soprano: sopranoResult.noteRefs,
      alto: altoResult.noteRefs,
      tenor: tenorResult.noteRefs,
      bass: bassResult.noteRefs,
    },
  };
}

export function renderScorePreview(
  container: HTMLDivElement,
  model: ScorePreviewModel,
  options: RenderScorePreviewOptions = {},
  vexflow?: VexFlowModule,
): RenderScorePreviewResult {
  const scale = Math.max(0.75, Math.min(1.5, options.scale ?? 1));
  const scrollElement = container.parentElement;
  const padding = scrollElement
    ? parseFloat(getComputedStyle(scrollElement).paddingLeft || "0") +
      parseFloat(getComputedStyle(scrollElement).paddingRight || "0") +
      parseFloat(getComputedStyle(container).paddingLeft || "0") +
      parseFloat(getComputedStyle(container).paddingRight || "0")
    : 48;
  const rawViewportWidth =
    (options.availableWidth ??
      scrollElement?.clientWidth ??
      DEFAULT_SYSTEM_WIDTH) - padding;
  const viewportWidth = Math.max(MIN_SYSTEM_WIDTH, rawViewportWidth);
  const availableLogicalWidth = Math.max(
    MIN_SYSTEM_WIDTH,
    viewportWidth / scale,
  );
  const systems = createSystemLayout(model, availableLogicalWidth);
  const verticalLayout = createVerticalLayout(model);
  const width = Math.max(
    viewportWidth,
    ...systems.map((system) => system.width * scale),
  );
  const height = verticalLayout.height * scale * Math.max(1, systems.length);
  container.replaceChildren();
  const cleanups: (() => void)[] = [];
  const warnings: ScorePreviewWarning[] = [];
  const allNoteElementRefs: ScoreRenderedNoteRef[] = [];
  const activeVexFlow = vexflow ?? loadedVexFlow;
  if (!activeVexFlow) {
    const host = document.createElement("div");
    host.className = "score-preview-system";
    host.dataset.renderError = "true";
    host.textContent = "乐谱引擎尚未加载";
    host.style.width = String(width) + "px";
    host.style.height = String(verticalLayout.height * scale) + "px";
    container.append(host);
    warnings.push({
      code: "render-error",
      message: "乐谱预览不可用：VexFlow 尚未加载。",
    });
    return {
      width,
      height,
      warnings: Object.freeze(warnings),
      noteElementRefs: Object.freeze([]),
      cleanup: () => container.replaceChildren(),
    };
  }

  systems.forEach((system, systemIndex) => {
    const host = document.createElement("div");
    host.className = "score-preview-system";
    host.style.width = String(system.width * scale) + "px";
    host.style.height = String(verticalLayout.height * scale) + "px";
    const firstMeasure = system.measures[0]?.measure;
    const lastMeasure = system.measures.at(-1)?.measure;
    if (!firstMeasure || !lastMeasure) return;
    host.dataset.fromTick = String(firstMeasure.fromTick);
    host.dataset.toTick = String(lastMeasure.toTick);
    host.dataset.measures = system.measures
      .map(({ measure }) => measure.number)
      .join(",");
    if (
      options.playheadTick !== undefined &&
      options.playheadTick >= firstMeasure.fromTick &&
      options.playheadTick < lastMeasure.toTick
    ) {
      host.dataset.active = "true";
    }
    container.append(host);
    try {
      const context = activeVexFlow.Renderer.buildContext(
        host,
        activeVexFlow.Renderer.Backends.SVG,
        system.width * scale,
        verticalLayout.height * scale,
      );
      context.scale(scale, scale);
      let staveX = SYSTEM_START_X;
      const systemNotesByVoice: Record<
        VoiceId,
        Array<{ event: ScoreNoteEvent; note: StaveNote }>
      > = {
        soprano: [],
        alto: [],
        tenor: [],
        bass: [],
      };

      system.measures.forEach((measureLayout, measureIndex) => {
        const isFirstInSystem = measureIndex === 0;
        const isLastInSystem = measureIndex === system.measures.length - 1;
        const isVeryLastMeasure =
          systemIndex === systems.length - 1 && isLastInSystem;

        try {
          const result = drawMeasure(
            activeVexFlow,
            host,
            context,
            measureLayout.measure,
            measureLayout,
            verticalLayout,
            staveX,
            { isFirstInSystem, isLastInSystem, isVeryLastMeasure },
            options,
          );
          cleanups.push(...result.listeners);
          allNoteElementRefs.push(...result.noteElementRefs);
          (["soprano", "alto", "tenor", "bass"] as const).forEach((voiceId) => {
            systemNotesByVoice[voiceId].push(
              ...result.noteRefsByVoice[voiceId],
            );
          });
        } catch (error) {
          host.dataset.renderError = "true";
          const message =
            error instanceof Error ? error.message : "乐谱渲染失败";
          warnings.push({
            code: "render-error",
            message:
              "第 " +
              measureLayout.measure.number +
              " 小节渲染失败：" +
              message,
            fromTick: measureLayout.measure.fromTick,
            toTick: measureLayout.measure.toTick,
          });
        }
        staveX += measureLayout.width;
      });

      // Draw all ties within this system
      (["soprano", "alto", "tenor", "bass"] as const).forEach((voiceId) => {
        const refs = systemNotesByVoice[voiceId];
        for (let i = 0; i < refs.length - 1; i++) {
          const current = refs[i];
          const next = refs[i + 1];
          if (
            current.event.sourceNoteId === next.event.sourceNoteId &&
            current.event.tieToNext &&
            next.event.tieFromPrevious
          ) {
            new activeVexFlow.StaveTie({
              firstNote: current.note,
              lastNote: next.note,
            })
              .setContext(context)
              .draw();
          }
        }
      });
    } catch (error) {
      host.dataset.renderError = "true";
      const message = error instanceof Error ? error.message : "乐谱渲染失败";
      warnings.push({
        code: "render-error",
        message: "谱表行渲染失败：" + message,
        fromTick: firstMeasure.fromTick,
        toTick: lastMeasure.toTick,
      });
    }
  });

  return {
    width,
    height,
    warnings: Object.freeze(warnings),
    noteElementRefs: Object.freeze(allNoteElementRefs),
    cleanup: () => {
      cleanups.forEach((cleanup) => cleanup());
      container.replaceChildren();
    },
  };
}
