import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installGlobalErrorHandlers } from "./services/logging";
import "./styles.css";

const uninstallGlobalErrorHandlers = installGlobalErrorHandlers();
import.meta.hot?.dispose(uninstallGlobalErrorHandlers);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
