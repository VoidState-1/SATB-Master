import type {
  KeyEvent,
  MeterEvent,
  ProjectDocument,
  TempoEvent,
} from "./project";

export interface MeasureInfo {
  number: number;
  startTick: number;
  endTick: number;
  numerator: number;
  denominator: number;
  beatTicks: number[];
}

export function eventAtTick<T extends { tick: number }>(
  events: T[],
  tick: number,
): T {
  let current = events[0];
  for (const event of events) {
    if (event.tick > tick) break;
    current = event;
  }
  if (!current) throw new Error("时间轴至少需要一个位于起点的事件");
  return current;
}

export function ticksPerBeat(ppq: number, denominator: number) {
  return ppq * (4 / denominator);
}

export function snapTickBackward(
  tick: number,
  gridTicks: number,
  maximumTick: number,
) {
  if (
    !Number.isFinite(tick) ||
    !Number.isFinite(maximumTick) ||
    !Number.isFinite(gridTicks) ||
    gridTicks <= 0
  ) {
    throw new Error("吸附时间参数无效");
  }
  // 编辑落点始终归入光标所在格的起点，不能因越过半格而跳到下一格。
  const snappedMaximum =
    Math.floor(Math.max(0, maximumTick) / gridTicks) * gridTicks;
  const snappedTick = Math.floor(Math.max(0, tick) / gridTicks) * gridTicks;
  return Math.min(snappedMaximum, snappedTick);
}

export function snapTickForward(
  tick: number,
  gridTicks: number,
  maximumTick: number,
) {
  if (
    !Number.isFinite(tick) ||
    !Number.isFinite(maximumTick) ||
    !Number.isFinite(gridTicks) ||
    gridTicks <= 0
  ) {
    throw new Error("吸附时间参数无效");
  }
  // 时值右边界归入光标之后的网格线；恰好位于网格线上时保持原位。
  const safeMaximum = Math.max(0, maximumTick);
  const snappedTick = Math.ceil(Math.max(0, tick) / gridTicks) * gridTicks;
  return Math.min(safeMaximum, snappedTick);
}

export function buildMeasures(
  project: Pick<ProjectDocument, "ppq" | "meterEvents" | "lengthTicks">,
): MeasureInfo[] {
  const meters = [...project.meterEvents].sort((a, b) => a.tick - b.tick);
  const measures: MeasureInfo[] = [];
  let tick = 0;
  let number = 1;

  while (tick < project.lengthTicks) {
    const meter = eventAtTick(meters, tick);
    const beatLength = ticksPerBeat(project.ppq, meter.denominator);
    const expectedEnd = tick + beatLength * meter.numerator;
    const nextMeter = meters.find(
      (event) => event.tick > tick && event.tick < expectedEnd,
    );

    // 变拍号理论上应落在小节起点；这里仍切开异常数据，避免小节网格与 MIDI 时间轴失去同步。
    const endTick = Math.min(
      nextMeter?.tick ?? expectedEnd,
      project.lengthTicks,
    );
    const beatTicks: number[] = [];
    for (let beat = tick; beat < endTick; beat += beatLength)
      beatTicks.push(beat);

    measures.push({
      number,
      startTick: tick,
      endTick,
      numerator: meter.numerator,
      denominator: meter.denominator,
      beatTicks,
    });
    tick = endTick;
    number += 1;
  }

  return measures;
}

export function ticksForMeasures(
  project: Pick<ProjectDocument, "ppq" | "meterEvents">,
  measureCount: number,
) {
  const safeCount = Math.max(1, Math.floor(Number(measureCount)));
  const meters = [...project.meterEvents].sort((a, b) => a.tick - b.tick);
  let tick = 0;
  for (let index = 0; index < safeCount; index += 1) {
    const meter = eventAtTick(meters, tick);
    const beatLength = ticksPerBeat(project.ppq, meter.denominator);
    const expectedEnd = tick + beatLength * meter.numerator;
    const nextMeter = meters.find(
      (event) => event.tick > tick && event.tick < expectedEnd,
    );
    tick = nextMeter?.tick ?? expectedEnd;
  }
  return tick;
}

export function tickToPosition(
  project: Pick<ProjectDocument, "ppq" | "meterEvents" | "lengthTicks">,
  tick: number,
) {
  const safeTick = Math.max(0, Math.min(tick, project.lengthTicks));
  const measures = buildMeasures(project);
  const measure =
    measures.find(
      (item) => safeTick >= item.startTick && safeTick < item.endTick,
    ) ?? measures.at(-1);
  if (!measure) return { measure: 1, beat: 1, tick: 0 };
  const beatLength = ticksPerBeat(project.ppq, measure.denominator);
  const local = safeTick - measure.startTick;
  return {
    measure: measure.number,
    beat: Math.floor(local / beatLength) + 1,
    tick: Math.round(local % beatLength),
  };
}

export function formatPosition(
  project: Pick<ProjectDocument, "ppq" | "meterEvents" | "lengthTicks">,
  tick: number,
) {
  const position = tickToPosition(project, tick);
  return `${position.measure}:${position.beat}:${String(position.tick).padStart(3, "0")}`;
}

export function tempoAtTick(events: TempoEvent[], tick: number) {
  return eventAtTick(events, tick);
}

export function keyAtTick(events: KeyEvent[], tick: number) {
  return eventAtTick(events, tick);
}

export function meterAtTick(events: MeterEvent[], tick: number) {
  return eventAtTick(events, tick);
}

export function tickToSeconds(
  project: Pick<ProjectDocument, "ppq" | "tempoEvents">,
  tick: number,
) {
  const events = [...project.tempoEvents].sort((a, b) => a.tick - b.tick);
  let seconds = 0;
  let cursor = 0;

  for (let index = 0; index < events.length; index += 1) {
    const tempo = events[index];
    const nextTick = Math.min(events[index + 1]?.tick ?? tick, tick);
    if (nextTick <= cursor) continue;
    const segmentStart = Math.max(cursor, tempo.tick);
    if (nextTick > segmentStart) {
      seconds += ((nextTick - segmentStart) / project.ppq) * (60 / tempo.bpm);
      cursor = nextTick;
    }
    if (cursor >= tick) break;
  }

  return seconds;
}

export function secondsToTick(
  project: Pick<ProjectDocument, "ppq" | "tempoEvents">,
  seconds: number,
) {
  const events = [...project.tempoEvents].sort((a, b) => a.tick - b.tick);
  let remaining = Math.max(0, seconds);

  for (let index = 0; index < events.length; index += 1) {
    const tempo = events[index];
    const nextTick = events[index + 1]?.tick;
    if (nextTick === undefined)
      return Math.round(
        tempo.tick + remaining * project.ppq * (tempo.bpm / 60),
      );
    const duration = ((nextTick - tempo.tick) / project.ppq) * (60 / tempo.bpm);
    if (remaining <= duration)
      return Math.round(
        tempo.tick + remaining * project.ppq * (tempo.bpm / 60),
      );
    remaining -= duration;
  }

  return 0;
}
