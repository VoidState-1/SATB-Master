import type { Beam, RenderContext, Stave, StaveNote, Voice } from "vexflow";
import { keySignatureFifths, type DiatonicStep, type SpelledPitch } from "../../domain/pitch";
import type { VoiceId } from "../../domain/project";
import {
  scoreVoiceLayout,
  type ScoreAuxiliaryChordEvent,
  type ScoreAuxiliaryStaff,
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
  sourceNoteIds?: readonly string[];
  voiceId: string;
  tick: number;
}

export interface ScoreRenderedNoteRef {
  element: SVGElement;
  fromTick: number;
  toTick: number;
  voiceId: string;
  sourceNoteId: string;
  sourceNoteIds?: readonly string[];
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
const STAVE_LINE_OFFSET = 40;
const STAFF_CLEARANCE = 24;

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
  auxiliaryY: readonly number[];
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
  if (measure.auxiliaryStaves.length > 0) {
    const onsets = new Set<number>();
    for (const lane of [
      ...Object.values(measure.voices),
      ...measure.auxiliaryStaves.flatMap((staff) => staff.lanes),
    ]) {
      lane.events.forEach((event) => onsets.add(event.fromTick));
    }
    return Math.max(1, onsets.size);
  }
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

function createVerticalLayout(
  measures: readonly ScoreMeasure[],
  auxiliaryTrackCount = 0,
): SystemVerticalLayout {
  const trebleTopLine = diatonicPosition("F", 5);
  const bassTopLine = diatonicPosition("A", 3);
  let trebleMin = 0;
  let bassMax = 0;
  const trebleBounds = { top: 0, bottom: STAVE_HEIGHT };
  const bassBounds = { top: 0, bottom: STAVE_HEIGHT };
  const auxiliaryBounds = Array.from({ length: auxiliaryTrackCount }, () => ({
    top: -24, // Space for the track label above the clef.
    bottom: STAVE_HEIGHT,
  }));
  measures.forEach((measure) => {
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
        if (auxiliaryBounds.length) {
          expandStaffBounds(
            layout.staff === "treble" ? trebleBounds : bassBounds,
            relativeY,
            layout.stemDirection,
          );
        } else if (layout.staff === "treble") {
          const top = relativeY - (layout.stemDirection === "up" ? 35 : 5);
          trebleMin = Math.min(trebleMin, top);
        } else {
          const bottom = relativeY + (layout.stemDirection === "down" ? 35 : 5);
          bassMax = Math.max(bassMax, bottom);
        }
      });
    });
    measure.auxiliaryStaves.forEach((staff, index) => {
      const reference = staff.clef === "treble" ? trebleTopLine : bassTopLine;
      for (const lane of staff.lanes) {
        for (const event of lane.events) {
          if (event.kind !== "chord") continue;
          for (const { pitch } of event.notes) {
            expandStaffBounds(
              auxiliaryBounds[index],
              (reference - diatonicPosition(pitch.step, pitch.octave)) * 5,
              lane.stemDirection,
            );
          }
        }
      }
    });
  });
  if (auxiliaryBounds.length) {
    const bounds = [trebleBounds, bassBounds, ...auxiliaryBounds];
    const staveYs = [TREBLE_TOP_PADDING - STAVE_LINE_OFFSET - trebleBounds.top];
    for (let index = 1; index < bounds.length; index++) {
      const gap = bounds[index - 1].bottom - bounds[index].top + STAFF_CLEARANCE;
      staveYs.push(staveYs[index - 1] + Math.max(STAFF_GAP, gap));
    }
    const height = staveYs.at(-1)! + STAVE_LINE_OFFSET +
      bounds.at(-1)!.bottom + SYSTEM_BOTTOM_PADDING;
    return { trebleY: staveYs[0], bassY: staveYs[1], auxiliaryY: staveYs.slice(2), height };
  }
  const trebleY = TREBLE_TOP_PADDING - trebleMin;
  const bassY = trebleY + STAFF_GAP;
  const height = Math.max(
    bassY + STAVE_HEIGHT + bassMax + SYSTEM_BOTTOM_PADDING,
    bassY + STAVE_HEIGHT + SYSTEM_BOTTOM_PADDING,
  );
  return { trebleY, bassY, auxiliaryY: [], height: Math.ceil(height) };
}

function expandStaffBounds(
  bounds: { top: number; bottom: number },
  relativeY: number,
  stemDirection?: "up" | "down",
) {
  bounds.top = Math.min(bounds.top, relativeY - (stemDirection === "down" ? 20 : 48));
  bounds.bottom = Math.max(bounds.bottom, relativeY + (stemDirection === "up" ? 20 : 48));
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

function keyForPitch(pitch: SpelledPitch) {
  return pitch.step.toLowerCase() + "/" + pitch.octave;
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

function accidentalStateKey(pitch: SpelledPitch) {
  return `${pitch.step}/${pitch.octave}`;
}

function restKey(staff: ScoreStaff) {
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
    keys: [event.kind === "note" ? keyForPitch(event.pitch) : restKey(staff)],
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
    accidentalState.get(accidentalStateKey(event.pitch)) ??
    keyAccidentals.get(event.pitch.step) ??
    0;
  if (event.pitch.alter !== defaultAlter) {
    note.addModifier(
      new vexflow.Accidental(accidentalText(event.pitch.alter)),
      0,
    );
  }
  accidentalState.set(accidentalStateKey(event.pitch), event.pitch.alter);
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

interface AuxiliaryNoteRef {
  event: ScoreAuxiliaryChordEvent;
  note: StaveNote;
}

interface AuxiliaryTieEndpoint {
  note: StaveNote;
  index: number;
  tick: number;
  context: RenderContext;
}

function auxiliaryTieHeadX(vexflow: VexFlowModule, { note, index }: AuxiliaryTieEndpoint) {
  const head = note.noteHeads[index];
  const displacement = head.isDisplaced()
    ? (head.getWidth() - vexflow.Stem.WIDTH / 2) * note.getStemDirection()
    : 0;
  return note.getNoteHeadBeginX() + displacement;
}

function drawAuxiliaryTie(
  vexflow: VexFlowModule,
  first: AuxiliaryTieEndpoint | undefined,
  last: AuxiliaryTieEndpoint | undefined,
  context: RenderContext,
  direction: number,
) {
  const tie = new vexflow.StaveTie({
    firstNote: first?.note,
    lastNote: last?.note,
    firstIndexes: first ? [first.index] : undefined,
    lastIndexes: last ? [last.index] : undefined,
  }).setDirection(direction);
  if (first) {
    const head = first.note.noteHeads[first.index];
    tie.renderOptions.firstXShift = auxiliaryTieHeadX(vexflow, first) + head.getWidth() + 2 - tie.getFirstX();
  }
  if (last) {
    tie.renderOptions.lastXShift = auxiliaryTieHeadX(vexflow, last) - 2 - tie.getLastX();
  }
  tie.setContext(context).draw();
}

function drawAuxiliaryTies(
  vexflow: VexFlowModule,
  context: RenderContext,
  refs: readonly AuxiliaryNoteRef[],
  pending: Map<string, AuxiliaryTieEndpoint>,
) {
  for (const { event, note } of refs) {
    event.notes.forEach((entry, index) => {
      const key = JSON.stringify([event.trackId, entry.sourceNoteId]);
      const first = pending.get(key);
      if (entry.tieFromPrevious && first?.tick === event.fromTick) {
        const last = { note, index, context, tick: event.fromTick };
        const direction = note.getStemDirection();
        if (first.context === context) {
          drawAuxiliaryTie(vexflow, first, last, context, direction);
        } else {
          drawAuxiliaryTie(vexflow, first, undefined, first.context, direction);
          drawAuxiliaryTie(vexflow, undefined, last, context, direction);
        }
      }
      if (entry.tieToNext) {
        pending.set(key, { note, index, context, tick: event.toTick });
      } else {
        pending.delete(key);
      }
    });
  }
}

function auxiliaryVoicesFor(
  vexflow: VexFlowModule,
  measure: ScoreMeasure,
  staff: ScoreAuxiliaryStaff,
  ppq: number,
) {
  const noteRefs: AuxiliaryNoteRef[] = [];
  const beams: Beam[] = [];
  const voices = staff.lanes.map((lane) => {
    const voice = new vexflow.Voice({
      numBeats: measure.numerator,
      beatValue: measure.denominator,
    }).setMode(vexflow.Voice.Mode.SOFT);
    const stemDirection = lane.stemDirection === undefined
      ? undefined
      : lane.stemDirection === "up" ? vexflow.Stem.UP : vexflow.Stem.DOWN;
    const tickables = lane.events.map((event) => {
      if (event.kind === "unsupported") {
        // Preserve the timing of subsequent events even when this glyph cannot be drawn.
        const spacer = new vexflow.GhostNote("w");
        spacer.applyTickMultiplier(event.toTick - event.fromTick, 4 * ppq);
        return spacer;
      }
      const isRest = event.kind === "rest";
      const note = new vexflow.StaveNote({
        keys: isRest ? [restKey(staff.clef)] : event.notes.map(({ pitch }) => keyForPitch(pitch)),
        duration: event.duration.value,
        dots: event.duration.dots,
        type: isRest ? "r" : undefined,
        clef: staff.clef,
        stemDirection,
        autoStem: !isRest && stemDirection === undefined,
      });
      if (event.duration.dots > 0)
        vexflow.Dot.buildAndAttach([note], { all: true });
      if (event.kind === "chord") noteRefs.push({ event, note });
      return note;
    });
    voice.addTickables(tickables);
    try {
      beams.push(...vexflow.Beam.generateBeams(tickables, {
        groups: vexflow.Beam.getDefaultBeamGroups(`${measure.numerator}/${measure.denominator}`),
        maintainStemDirections: stemDirection !== undefined,
        beamRests: false,
        stemDirection,
      }));
    } catch {
      // Individual note flags remain available when beaming is unsupported.
    }
    return voice;
  });

  const byOnset = new Map<number, AuxiliaryNoteRef[]>();
  for (const ref of noteRefs) {
    const onset = byOnset.get(ref.event.fromTick);
    if (onset) onset.push(ref);
    else byOnset.set(ref.event.fromTick, [ref]);
  }
  const keyAccidentals = keySignatureAccidentals(measure);
  const state = new Map<string, number | undefined>();
  for (const tick of [...byOnset.keys()].sort((a, b) => a - b)) {
    const attacks = byOnset.get(tick)!.flatMap(({ event, note }) =>
      event.notes.flatMap(({ pitch, tieFromPrevious }, index) =>
        tieFromPrevious ? [] : [{ pitch, index, note, key: accidentalStateKey(pitch) }],
      ),
    );
    const alterations = new Map<string, Set<number>>();
    for (const { key, pitch } of attacks) {
      const values = alterations.get(key) ?? new Set<number>();
      values.add(pitch.alter);
      alterations.set(key, values);
    }
    for (const { key, pitch, note, index } of attacks) {
      const sameOnset = alterations.get(key)!;
      const previous = state.has(key) ? state.get(key) : keyAccidentals.get(pitch.step) ?? 0;
      if (sameOnset.size > 1 || pitch.alter !== previous) {
        note.addModifier(new vexflow.Accidental(accidentalText(pitch.alter)), index);
      }
    }
    for (const [key, values] of alterations) {
      // Simultaneous conflicting alterations require an explicit accidental at the next attack.
      state.set(key, values.size === 1 ? values.values().next().value : undefined);
    }
  }
  return { voices, noteRefs, beams };
}

function formatStaves(
  vexflow: VexFlowModule,
  context: RenderContext,
  staves: readonly { stave: Stave; voices: Voice[] }[],
) {
  for (const { stave, voices } of staves) {
    voices.forEach((voice) => voice.setStave(stave));
  }
  const allVoices = staves.flatMap(({ voices }) => voices);
  if (allVoices.length === 0) return;

  const startX = Math.max(...staves.map(({ stave }) => stave.getNoteStartX()));
  const endX = Math.min(...staves.map(({ stave }) => stave.getNoteEndX()));
  const justifyWidth = Math.max(20, endX - startX - 10);

  const formatter = new vexflow.Formatter();
  for (const { voices } of staves) {
    if (voices.length > 0) formatter.joinVoices(voices);
  }

  formatter.format(allVoices, justifyWidth, { alignRests: true });
  formatter.postFormat();

  for (const { stave, voices } of staves) {
    voices.forEach((voice) => voice.draw(context, stave));
  }
}

interface SelectableNote extends ScoreNoteSelection {
  note: StaveNote;
  toTick: number;
  color?: string;
}

function drawAuxiliaryLabel(context: RenderContext, stave: Stave, staff: ScoreAuxiliaryStaff) {
  const label = staff.shortName.trim() || staff.name;
  const characters = Array.from(label);
  const compactLabel = characters.length > 12 ? characters.slice(0, 11).join("") + "…" : label;
  const x = stave.getX() + 6;
  const y = stave.getTopLineTopY() - 12;
  context.save();
  const group: SVGGElement = context.openGroup("score-aux-staff-label");
  group.dataset.trackId = staff.trackId;
  group.style.setProperty("--score-aux-color", staff.color);
  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = staff.name;
  group.append(title);
  context.fillRect(x, y - 7, 6, 6);
  context.setFont("sans-serif", "11px", "600").fillText(compactLabel, x + 11, y);
  context.closeGroup();
  context.restore();
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
  ppq: number,
  options: RenderScorePreviewOptions,
) {
  const staveWidth = measureLayout.width;
  const treble = new vexflow.Stave(staveX, verticalLayout.trebleY, staveWidth);
  const bass = new vexflow.Stave(staveX, verticalLayout.bassY, staveWidth);
  const auxStaves = measure.auxiliaryStaves.map((staff, index) => {
    const stave = new vexflow.Stave(staveX, verticalLayout.auxiliaryY[index], staveWidth);
    const { isFirstInSystem } = drawCtx;
    stave.setBegBarType(isFirstInSystem ? vexflow.Barline.type.SINGLE : vexflow.Barline.type.NONE);
    if (isFirstInSystem) {
      stave.addClef(staff.clef).addTimeSignature(`${measure.numerator}/${measure.denominator}`);
    } else {
      // Key signatures still need the clef when the clef glyph is absent.
      stave.getClef = () => staff.clef;
    }
    if (measureLayout.showKeySignature && measure.keySignature)
      stave.addKeySignature(measure.keySignature);
    stave.setEndBarType(drawCtx.isVeryLastMeasure ? vexflow.Barline.type.END : vexflow.Barline.type.SINGLE);
    return { staff, stave };
  });
  const bottomStave = auxStaves.at(-1)?.stave ?? bass;

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

  // Format beginning modifiers together so the note columns start at the same X.
  try {
    vexflow.Stave.formatBegModifiers([treble, bass, ...auxStaves.map(({ stave }) => stave)]);
  } catch {
    // fallback
  }

  treble.setContext(context).draw();
  bass.setContext(context).draw();
  auxStaves.forEach(({ staff, stave }) => {
    stave.setContext(context).draw();
    if (drawCtx.isFirstInSystem) drawAuxiliaryLabel(context, stave, staff);
  });

  if (drawCtx.isFirstInSystem) {
    new vexflow.StaveConnector(treble, bass)
      .setType(vexflow.StaveConnector.type.BRACE)
      .setContext(context)
      .draw();
    new vexflow.StaveConnector(treble, bottomStave)
      .setType(vexflow.StaveConnector.type.SINGLE_LEFT)
      .setContext(context)
      .draw();
  }

  if (auxStaves.length > 0 || drawCtx.isLastInSystem) {
    new vexflow.StaveConnector(treble, bottomStave)
      .setType(auxStaves.length > 0 && drawCtx.isVeryLastMeasure
        ? vexflow.StaveConnector.type.BOLD_DOUBLE_RIGHT
        : vexflow.StaveConnector.type.SINGLE_RIGHT)
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

  const auxiliaryResults = auxStaves.map(({ staff, stave }) => ({
    stave,
    staff,
    ...auxiliaryVoicesFor(vexflow, measure, staff, ppq),
  }));
  formatStaves(vexflow, context, [
    { stave: treble, voices: [sopranoResult.voice, altoResult.voice] },
    { stave: bass, voices: [tenorResult.voice, bassResult.voice] },
    ...auxiliaryResults,
  ]);

  const allBeams = [
    ...sopranoResult.beams,
    ...altoResult.beams,
    ...tenorResult.beams,
    ...bassResult.beams,
    ...auxiliaryResults.flatMap(({ beams }) => beams),
  ];
  allBeams.forEach((beam) => {
    try {
      beam.setContext(context).draw();
    } catch {
      // safe fallback
    }
  });

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

  const selectableNotes: SelectableNote[] = voiceResults.flatMap(({ noteRefs }) =>
    noteRefs.map(({ event, note }) => ({
      note,
      sourceNoteId: event.sourceNoteId,
      voiceId: event.voiceId,
      tick: event.fromTick,
      toTick: event.toTick,
    })),
  );
  for (const { staff, noteRefs } of auxiliaryResults) {
    for (const { event, note } of noteRefs) {
      const ids = event.notes.map(({ sourceNoteId }) => sourceNoteId);
      selectableNotes.push({
        note,
        sourceNoteId: ids[0],
        sourceNoteIds: ids.length > 1 ? ids : undefined,
        voiceId: event.trackId,
        tick: event.fromTick,
        toTick: event.toTick,
        color: staff.color,
      });
    }
  }

  const listeners: (() => void)[] = [];
  const noteElementRefs: ScoreRenderedNoteRef[] = [];
  selectableNotes.forEach(({ note, toTick, color, ...selection }) => {
    const element =
      note.getSVGElement() ??
      host.querySelector<SVGElement>(`#vf-${note.getAttribute("id")}`);
    if (!element) return;
    element.dataset.sourceNoteId = selection.sourceNoteId;
    element.dataset.voiceId = selection.voiceId;
    element.dataset.tick = String(selection.tick);
    element.dataset.fromTick = String(selection.tick);
    element.dataset.toTick = String(toTick);
    element.classList.add("score-note");
    if (color) {
      element.classList.add("score-aux-note");
      element.style.setProperty("--score-aux-color", color);
    }
    noteElementRefs.push({
      element,
      fromTick: selection.tick,
      toTick,
      voiceId: selection.voiceId,
      sourceNoteId: selection.sourceNoteId,
      sourceNoteIds: selection.sourceNoteIds,
    });
    element.style.cursor = options.onNoteClick ? "pointer" : "default";
    if (!options.onNoteClick) return;
    const handler = () => options.onNoteClick?.(selection);
    element.addEventListener("click", handler);
    listeners.push(() => element.removeEventListener("click", handler));
  });

  return {
    listeners,
    noteElementRefs,
    auxiliaryNoteRefs: auxiliaryResults.flatMap(({ noteRefs }) => noteRefs),
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
  const auxiliaryTrackCount = model.includedAuxiliaryTrackIds.length;
  const satbLayout = auxiliaryTrackCount > 0 ? undefined : createVerticalLayout(model.measures);
  const verticalLayouts = systems.map((system) =>
    satbLayout ?? createVerticalLayout(
      system.measures.map(({ measure }) => measure),
      auxiliaryTrackCount,
    ),
  );
  const width = Math.max(
    viewportWidth,
    ...systems.map((system) => system.width * scale),
  );
  const systemHeight = verticalLayouts[0]?.height ?? satbLayout?.height ??
    createVerticalLayout([], auxiliaryTrackCount).height;
  const height = scale * (verticalLayouts.length
    ? verticalLayouts.reduce((total, layout) => total + layout.height, 0)
    : systemHeight);
  container.replaceChildren();
  const cleanups: (() => void)[] = [];
  const warnings: ScorePreviewWarning[] = [];
  const allNoteElementRefs: ScoreRenderedNoteRef[] = [];
  const pendingAuxiliaryTies = new Map<string, AuxiliaryTieEndpoint>();
  const activeVexFlow = vexflow ?? loadedVexFlow;
  if (!activeVexFlow) {
    const host = document.createElement("div");
    host.className = "score-preview-system";
    host.dataset.renderError = "true";
    host.textContent = "乐谱引擎尚未加载";
    host.style.width = String(width) + "px";
    host.style.height = String(systemHeight * scale) + "px";
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
    const verticalLayout = verticalLayouts[systemIndex];
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
      const systemAuxiliaryNotes: AuxiliaryNoteRef[] = [];
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
            model.ppq,
            options,
          );
          cleanups.push(...result.listeners);
          allNoteElementRefs.push(...result.noteElementRefs);
          systemAuxiliaryNotes.push(...result.auxiliaryNoteRefs);
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
      drawAuxiliaryTies(activeVexFlow, context, systemAuxiliaryNotes, pendingAuxiliaryTies);
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
