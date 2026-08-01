import { useEffect, useState } from "react";
import { Check, Code2, Copy } from "lucide-react";
import {
  formatDeveloperFieldValue,
  type DeveloperEventInspection,
} from "../domain/developerInspection";

interface DeveloperEventInspectorProps {
  inspection: DeveloperEventInspection;
}

export function DeveloperEventInspector({
  inspection,
}: DeveloperEventInspectorProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [inspection.rawJson]);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(inspection.rawJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      className="developer-event-inspector"
      aria-label={`${inspection.modelName} 开发者数据`}
    >
      <header className="developer-event-header">
        <Code2 aria-hidden="true" />
        <div>
          <strong>开发者数据</strong>
          <small>
            {inspection.modelName} · {inspection.contextLabel}
          </small>
        </div>
        <button
          type="button"
          className="developer-copy-button"
          aria-label={`复制 ${inspection.modelName} JSON`}
          onClick={() => void copyJson()}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "已复制" : "复制 JSON"}
        </button>
      </header>

      <div className="developer-field-table" role="table">
        <div className="developer-field-heading" role="row">
          <span role="columnheader">字段路径</span>
          <span role="columnheader">当前值</span>
        </div>
        {inspection.rows.map((item) => (
          <div className="developer-field-row" role="row" key={item.path}>
            <code role="cell" title={item.type}>
              {item.path}
            </code>
            <span
              role="cell"
              className={item.value === undefined ? "is-undefined" : ""}
              title={item.type}
            >
              {formatDeveloperFieldValue(item.value)}
            </span>
          </div>
        ))}
      </div>

      <details className="developer-raw-json">
        <summary>原始 JSON</summary>
        <pre>{inspection.rawJson}</pre>
      </details>
    </section>
  );
}
