import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type {
  DesktopInvokeChannel,
  DesktopInvokeMap,
} from "../shared/desktop.js";

type Handler<Channel extends DesktopInvokeChannel> = (
  event: IpcMainInvokeEvent,
  request: DesktopInvokeMap[Channel]["request"],
) =>
  | DesktopInvokeMap[Channel]["response"]
  | Promise<DesktopInvokeMap[Channel]["response"]>;

export function handleDesktop<Channel extends DesktopInvokeChannel>(
  channel: Channel,
  handler: Handler<Channel>,
) {
  ipcMain.handle(channel, (event, request) => handler(event, request));
}

