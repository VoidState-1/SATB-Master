import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { sanitizePath, serializeError, type SerializedError } from "../../shared/logging";
import { exportDiagnosticBundleFile } from "../services/desktop";
import { buildDiagnosticBundle, logger } from "../services/logging";
import "./appErrorBoundary.css";

interface AppErrorBoundaryProps {
  children: ReactNode;
  onEmergencyBackup?: () => void | Promise<void>;
}

interface AppErrorBoundaryState {
  error?: SerializedError;
  componentStack?: string;
  exporting?: boolean;
  feedback?: string;
  backupStatus?: string;
}

function describeError(error: SerializedError): string {
  const details = error.stack || error.name + ": " + error.message;
  return error.cause ? details + "\n\nCaused by:\n" + describeError(error.cause) : details;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // The preview can run in a browser context without Clipboard API access.
  }
  const active = document.activeElement;
  const input = document.createElement("textarea");
  input.value = text;
  input.readOnly = true;
  input.className = "app-error-copy-buffer";
  document.body.append(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw new Error("无法访问剪贴板");
  } finally {
    input.remove();
    if (active instanceof HTMLElement) active.focus();
  }
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error: serializeError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const componentStack = info.componentStack ?? undefined;
    logger.fatal("ui", "RENDER_CRASH", {
      message: "界面渲染失败",
      error,
      context: { componentStack },
    });
    this.setState({ componentStack });

    const backup = this.props.onEmergencyBackup;
    if (backup) {
      this.setState({ backupStatus: "正在尝试备份当前工程…" });
      void Promise.resolve().then(backup).then(
        () => this.setState({ backupStatus: "当前工程已备份。" }),
        (failure: unknown) => {
          logger.error("file", "紧急备份失败", { code: "RECOVERY_FAILED", error: failure });
          this.setState({ backupStatus: "未能备份当前工程。" });
        },
      );
    }
  }

  private focusHeading = (element: HTMLHeadingElement | null) => {
    element?.focus();
  };

  private copyError = async () => {
    if (!this.state.error) return;
    try {
      await copyText("RENDER_CRASH\n" + sanitizePath(this.technicalDetails(this.state.error)));
      this.setState({ feedback: "已复制错误信息。" });
    } catch {
      this.setState({ feedback: "复制失败。可展开技术详情并手动复制。" });
    }
  };

  private exportBundle = async () => {
    if (this.state.exporting) return;
    this.setState({ exporting: true, feedback: "正在准备排错包…" });
    try {
      const bundle = await buildDiagnosticBundle({ redactPaths: true });
      const result = await exportDiagnosticBundleFile(JSON.stringify(bundle, null, 2));
      this.setState({ feedback: result.canceled ? "已取消导出。" : "已导出排错包。" });
    } catch (error) {
      logger.error("file", "排错包导出失败", { code: "FILE_WRITE_FAILED", error });
      this.setState({ feedback: "导出失败。可复制错误信息以便排查。" });
    } finally {
      this.setState({ exporting: false });
    }
  };

  private technicalDetails(error: SerializedError) {
    return [describeError(error), this.state.componentStack].filter(Boolean).join("\n\n");
  }

  render() {
    const { error, backupStatus, exporting, feedback } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="app-error-page" aria-labelledby="app-error-title">
        <section className="app-error-content">
          <header className="app-error-header">
            <TriangleAlert aria-hidden="true" className="app-error-icon" />
            <div>
              <h1 id="app-error-title" tabIndex={-1} ref={this.focusHeading}>界面意外停止</h1>
              <p>重新加载界面可继续使用。你也可以在重新加载前导出排错包。</p>
            </div>
          </header>

          <details className="app-error-details">
            <summary>技术详情 <code>RENDER_CRASH</code></summary>
            <pre tabIndex={0}>{sanitizePath(this.technicalDetails(error))}</pre>
          </details>

          <div className="app-error-actions">
            <button type="button" className="app-error-reload" onClick={() => window.location.reload()}>
              重新加载界面
            </button>
            <button type="button" onClick={this.copyError}>复制错误信息</button>
            <button type="button" onClick={this.exportBundle} disabled={exporting}>导出排错包</button>
          </div>

          <div className="app-error-status" role="status">
            {backupStatus && <p>{backupStatus}</p>}
            {feedback && <p>{feedback}</p>}
          </div>
        </section>
      </main>
    );
  }
}
