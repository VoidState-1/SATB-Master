import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installGlobalErrorHandlers } from "./services/logging";
import { usesNativeMacWindow } from "./shortcuts/keyboardPlatform";
import "./styles.css";

if (usesNativeMacWindow && window.desktop) {
  document.documentElement.dataset.windowPlatform = "macos";
  const controls = window.desktop.windowControls;
  const updateFullScreen = (fullScreen: boolean) =>
    document.documentElement.toggleAttribute("data-window-fullscreen", fullScreen);
  const unsubscribe = controls.onFullScreenChange(updateFullScreen);
  void controls.isFullScreen().then(updateFullScreen);
  import.meta.hot?.dispose(unsubscribe);
}

const uninstallGlobalErrorHandlers = installGlobalErrorHandlers();
import.meta.hot?.dispose(uninstallGlobalErrorHandlers);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
