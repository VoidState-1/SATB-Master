import type {
  KeyEvent,
  MeterEvent,
  ProjectDocument,
  TempoEvent,
} from "./model";
import { buildMeasures, ticksPerBeat } from "./time";

export interface TimingMarkerGroup {
  tick: number;
  tempo?: TempoEvent;
  meter?: MeterEvent;
  key?: KeyEvent;
}

export interface TimelineRulerTick {
  tick: number;
  kind: "beat" | "subdivision";
}

export function buildTimingMarkerGroups(
  project: Pick<ProjectDocument, "tempoEvents" | "meterEvents" | "keyEvents">,
) {
  const groups = new Map<number, TimingMarkerGroup>();
  const groupAtTick = (tick: number) => {
    const current = groups.get(tick) ?? { tick };
    groups.set(tick, current);
    return current;
  };

  project.tempoEvents
    .filter((event) => event.tick > 0)
    .forEach((event) => {
      groupAtTick(event.tick).tempo = event;
    });
  project.meterEvents
    .filter((event) => event.tick > 0)
    .forEach((event) => {
      groupAtTick(event.tick).meter = event;
    });
  project.keyEvents
    .filter((event) => event.tick > 0)
    .forEach((event) => {
      groupAtTick(event.tick).key = event;
    });

  return [...groups.values()].sort((left, right) => left.tick - right.tick);
}

export function buildTimelineRulerTicks(
  project: Pick<ProjectDocument, "ppq" | "meterEvents" | "lengthTicks">,
) {
  const ticks: TimelineRulerTick[] = [];
  buildMeasures(project).forEach((measure) => {
    // 刻度随当前拍号的分母换算拍长；小节起点由小节线承担，避免重复加粗。
    const beatLength = ticksPerBeat(project.ppq, measure.denominator);
    measure.beatTicks.forEach((beatTick) => {
      if (beatTick > measure.startTick)
        ticks.push({ tick: beatTick, kind: "beat" });
      for (let subdivision = 1; subdivision < 4; subdivision += 1) {
        const tick = beatTick + beatLength * (subdivision / 4);
        if (tick < measure.endTick) ticks.push({ tick, kind: "subdivision" });
      }
    });
  });
  return ticks;
}
