import { useEffect, useState } from "react";
import type {
  RuleConfig,
  RuleExceptionContext,
  RuleExceptionPolicy,
  RuleOptionDefinition,
} from "../../domain/harmony";

const EXCEPTION_CONTEXT_LABELS: Record<RuleExceptionContext, string> = {
  "same-harmony": "同和弦转换",
  arpeggiation: "分解和弦式进行",
  "voice-exchange": "声部交换",
  "inner-voices": "包含内声部",
  "bass-step-up": "低音上行级进",
  sequence: "模进",
  "pedal-point": "持续低音",
  "nonchord-tone": "已确认非和弦音",
  cadence: "终止语境",
  modulation: "转调语境",
  "ambiguous-semantics": "语义存在歧义",
  "insufficient-context": "上下文不足",
};

function NumberEditor({
  value,
  min,
  max,
  step,
  disabled,
  label,
  onCommit,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  label: string;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (input: HTMLInputElement) => {
    const { valueAsNumber: next, validity } = input;
    if (
      !Number.isFinite(next) ||
      validity.rangeUnderflow ||
      validity.rangeOverflow ||
      (step !== undefined && validity.stepMismatch)
    ) {
      setDraft(String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          // Blur runs before React commits the restored draft.
          const saved = String(value);
          event.currentTarget.value = saved;
          setDraft(saved);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function RuleOptionFields({
  options,
  config,
  disabled,
  onPatch,
}: {
  options: readonly RuleOptionDefinition[];
  config: RuleConfig;
  disabled?: boolean;
  onPatch(patch: RuleConfig): void;
}) {
  if (options.length === 0) return null;
  return (
    <section className="rule-details-section">
      <h4>参数</h4>
      <div className="rule-option-list">
        {options.map((option) => {
          const value = config[option.key] ?? option.defaultValue;
          return (
            <label className="rule-option-field" key={option.key}>
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {option.kind === "boolean" ? (
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  disabled={disabled}
                  onChange={(event) =>
                    onPatch({ [option.key]: event.target.checked })
                  }
                />
              ) : option.kind === "number" ||
                option.kind === "integer" ||
                option.kind === "pitch" ? (
                <span className="rule-number-control">
                  <NumberEditor
                    value={Number(value)}
                    min={option.min}
                    max={option.max}
                    step={option.step}
                    disabled={disabled}
                    label={option.label}
                    onCommit={(next) => onPatch({ [option.key]: next })}
                  />
                  {option.unit ? <small>{option.unit}</small> : null}
                </span>
              ) : option.kind === "enum" ? (
                <select
                  value={String(value)}
                  disabled={disabled}
                  onChange={(event) =>
                    onPatch({ [option.key]: event.target.value })
                  }
                >
                  {option.values.map((candidate) => (
                    <option value={candidate.value} key={candidate.value}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              ) : option.kind === "duration" ? (
                <span className="rule-duration-control">
                  <NumberEditor
                    value={
                      typeof value === "object" && "value" in value
                        ? value.value
                        : option.defaultValue.value
                    }
                    min={option.min}
                    max={option.max}
                    step={option.step}
                    disabled={disabled}
                    label={option.label}
                    onCommit={(next) => {
                      const unit =
                        typeof value === "object" && "unit" in value
                          ? value.unit
                          : option.defaultValue.unit;
                      onPatch({ [option.key]: { value: next, unit } });
                    }}
                  />
                  <select
                    value={
                      typeof value === "object" && "unit" in value
                        ? value.unit
                        : option.defaultValue.unit
                    }
                    disabled={disabled}
                    aria-label={`${option.label}单位`}
                    onChange={(event) => {
                      const nextValue =
                        typeof value === "object" && "value" in value
                          ? value.value
                          : option.defaultValue.value;
                      onPatch({
                        [option.key]: {
                          value: nextValue,
                          unit: event.target.value as
                            "ticks" | "beats" | "measures",
                        },
                      });
                    }}
                  >
                    <option value="beats">拍</option>
                    <option value="measures">小节</option>
                    <option value="ticks">Tick</option>
                  </select>
                </span>
              ) : (
                <span className="rule-range-control">
                  {(() => {
                    const range: { minMidi: number; maxMidi: number } =
                      typeof value === "object" && "minMidi" in value
                        ? (value as { minMidi: number; maxMidi: number })
                        : (option.defaultValue as {
                            minMidi: number;
                            maxMidi: number;
                          });
                    return (
                      <>
                        <NumberEditor
                          value={range.minMidi}
                          min={0}
                          max={range.maxMidi}
                          step={1}
                          disabled={disabled}
                          label={`${option.label}下界`}
                          onCommit={(next) =>
                            onPatch({
                              [option.key]: {
                                minMidi: next,
                                maxMidi: range.maxMidi,
                              },
                            })
                          }
                        />
                        <span className="rule-range-separator">至</span>
                        <NumberEditor
                          value={range.maxMidi}
                          min={range.minMidi}
                          max={127}
                          step={1}
                          disabled={disabled}
                          label={`${option.label}上界`}
                          onCommit={(next) =>
                            onPatch({
                              [option.key]: {
                                minMidi: range.minMidi,
                                maxMidi: next,
                              },
                            })
                          }
                        />
                      </>
                    );
                  })()}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}

export function RuleExceptionFields({
  contexts,
  defaults,
  exceptions,
  disabled,
  onChange,
}: {
  contexts: readonly RuleExceptionContext[];
  defaults: RuleExceptionPolicy;
  exceptions: RuleExceptionPolicy;
  disabled?: boolean;
  onChange(policy: RuleExceptionPolicy | undefined): void;
}) {
  if (contexts.length === 0) return null;
  return (
    <section className="rule-details-section">
      <h4>特例策略</h4>
      {contexts.map((context) => (
        <label className="rule-detail-field" key={context}>
          <span>{EXCEPTION_CONTEXT_LABELS[context]}</span>
          <select
            value={exceptions[context] ?? "default"}
            disabled={disabled}
            aria-label={`${EXCEPTION_CONTEXT_LABELS[context]}处理方式`}
            onChange={(event) => {
              const current = { ...exceptions };
              const mode = event.target.value;
              if (mode === "default") delete current[context];
              else
                current[context] = mode as NonNullable<
                  RuleExceptionPolicy[typeof context]
                >;
              onChange(Object.keys(current).length > 0 ? current : undefined);
            }}
          >
            <option value="default">
              规则默认（
              {defaults[context] === "exempt"
                ? "豁免"
                : defaults[context] === "downgrade"
                  ? "降一级"
                  : "严格检查"}
              ）
            </option>
            <option value="exempt">豁免</option>
            <option value="downgrade">降一级</option>
            <option value="strict">严格检查</option>
          </select>
        </label>
      ))}
    </section>
  );
}
