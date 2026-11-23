import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  DESKTOP_CHANNELS,
  type DesktopInvokeChannel,
  type DesktopInvokeMap,
} from "../shared/desktop.js";

type Handler<Channel extends DesktopInvokeChannel> = (
  event: IpcMainInvokeEvent,
  request: DesktopInvokeMap[Channel]["request"],
) =>
  | DesktopInvokeMap[Channel]["response"]
  | Promise<DesktopInvokeMap[Channel]["response"]>;

type IpcReporter = (
  level: "warn" | "error",
  context: { channel: DesktopInvokeChannel; durationMs: number },
  error?: unknown,
) => void;

let reportIpc: IpcReporter | undefined;

export function setDesktopIpcReporter(reporter?: IpcReporter) {
  reportIpc = reporter;
}

export function handleDesktop<Channel extends DesktopInvokeChannel>(
  channel: Channel,
  handler: Handler<Channel>,
) {
  if (channel === DESKTOP_CHANNELS.logAppendBatch) {
    ipcMain.handle(channel, (event, request) => handler(event, request));
    return;
  }

  ipcMain.handle(channel, async (event, request) => {
    const start = performance.now();
    const report = (level: "warn" | "error", durationMs: number, error?: unknown) => {
      try {
        reportIpc?.(level, { channel, durationMs }, error);
      } catch {
        // Instrumentation cannot change the IPC result or the original error.
      }
    };

    try {
      const result = await handler(event, request);
      const durationMs = performance.now() - start;
      if (durationMs >= 500) report("warn", durationMs);
      return result;
    } catch (error) {
      report("error", performance.now() - start, error);
      throw error;
    }
  });
}

