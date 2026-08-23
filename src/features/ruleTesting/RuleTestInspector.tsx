import { useMemo } from "react";
import { FolderOpen, RotateCcw, Volume2 } from "lucide-react";
import type {
  ExpectedDiagnostic,
  HarmonyRuleId,
  HarmonyRuleTestCase,
  RuleConfig,
  RuleExceptionPolicy,
} from "../../domain/harmony";
import { HARMONY_RULE_DEFINITIONS } from "../../domain/harmony";
import type { ProjectDocument } from "../../domain/project";
import {
  RuleExceptionFields,
  RuleOptionFields,
} from "../../features/settings";
import { RuleSearch } from "./RuleSearch";

interface RuleTestInspectorProps {
  testCase: HarmonyRuleTestCase;
  project: ProjectDocument;
  selectedExpectationId?: string;
  audioState?: string;
  audioMessage?: string;
  soundFontProgress?: { completedBytes: number; totalBytes: number };
  onUpdateCase(update: (testCase: HarmonyRuleTestCase) => void): void;
  onSetRule(ruleId: HarmonyRuleId): void;
  onChooseSoundFont(): void;
  onUseDefaultSoundFont(): void;
  onSelectExpectation(expectationId: string): void;
  onUpdateExpectation(
    expectationId: string,
    patch: Partial<ExpectedDiagnostic>,
  ): void;
  onDeleteExpectation(expectationId: string): void;
}

function expectedReferenceSummary(item: ExpectedDiagnostic) {
  return [
    item.voiceIds?.join("/"),
    item.noteIds?.join(", "),
    item.chordIds?.join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function RuleTestInspector({
  testCase,
  project,
  selectedExpectationId,
  audioState,
  audioMessage,
  soundFontProgress,
  onUpdateCase,
  onSetRule,
  onChooseSoundFont,
  onUseDefaultSoundFont,
  onSelectExpectation,
  onUpdateExpectation,
  onDeleteExpectation,
}: RuleTestInspectorProps) {
  const definition = HARMONY_RULE_DEFINITIONS.find(
    (item) => item.id === testCase.target.ruleId,
  )!;
  const selectedExpectation = useMemo(
    () =>
      testCase.expected.diagnostics.find(
        (item) => item.id === selectedExpectationId,
      ),
    [selectedExpectationId, testCase.expected.diagnostics],
  );
  const patchConfig = (patch: RuleConfig) =>
    onUpdateCase((next) => {
      next.execution.config = { ...next.execution.config, ...patch };
    });
  const patchExceptions = (exceptions: RuleExceptionPolicy | undefined) =>
    onUpdateCase((next) => {
      next.execution.exceptions = exceptions ?? {};
    });
  const soundFontPercent =
    soundFontProgress && soundFontProgress.totalBytes > 0
      ? Math.round(
          (soundFontProgress.completedBytes / soundFontProgress.totalBytes) *
            100,
        )
      : undefined;

  return (
    <aside className="rule-test-inspector" aria-label="规则测试用例详情">
      <div className="rule-test-inspector-tabs">
        <span className="is-active">用例</span>
        <span>选中对象</span>
      </div>
      <div className="rule-test-inspector-content">
        <section className="rule-test-form-section">
          <h3>用例</h3>
          <label className="rule-test-field">
            <span>标题</span>
            <input
              value={testCase.title}
              onChange={(event) =>
                onUpdateCase((next) => {
                  next.title = event.target.value;
                })
              }
            />
          </label>
          <label className="rule-test-field">
            <span>说明</span>
            <textarea
              rows={3}
              value={testCase.description ?? ""}
              onChange={(event) =>
                onUpdateCase((next) => {
                  next.description = event.target.value || undefined;
                })
              }
            />
          </label>
          <label className="rule-test-field">
            <span>标签</span>
            <input
              value={testCase.tags.join(", ")}
              onChange={(event) =>
                onUpdateCase((next) => {
                  next.tags = event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean);
                })
              }
            />
          </label>
        </section>
        <section className="rule-test-form-section">
          <h3>测试规则</h3>
          <RuleSearch
            ruleId={testCase.target.ruleId}
            onSelect={onSetRule}
          />
          <p className="rule-test-rule-description" style={{ marginTop: "8px" }}>
            {definition.description}
          </p>
          <label className="rule-test-field">
            <span>严重程度</span>
            <select
              value={testCase.execution.severity}
              onChange={(event) =>
                onUpdateCase((next) => {
                  next.execution.severity = event.target.value as typeof next.execution.severity;
                })
              }
            >
              <option value="error">错误</option>
              <option value="warning">警告</option>
              <option value="suggestion">建议</option>
            </select>
          </label>
          <RuleOptionFields
            options={definition.options}
            config={testCase.execution.config}
            onPatch={patchConfig}
          />
          <RuleExceptionFields
            contexts={definition.supportedExceptionContexts}
            defaults={definition.defaultExceptionPolicies}
            exceptions={testCase.execution.exceptions}
            onChange={patchExceptions}
          />
        </section>
        <section className="rule-test-form-section">
          <h3>SoundFont 音源</h3>
          <div className="rule-test-soundfont-card">
            <div className="rule-test-soundfont-name">
              <Volume2 aria-hidden="true" />
              <strong>{project.audio.soundFont.name || "默认音色"}</strong>
            </div>
            <div className="rule-test-soundfont-status">
              <small>{audioMessage || "SoundFont 已就绪"}</small>
              {soundFontPercent !== undefined ? (
                <progress
                  max="100"
                  value={soundFontPercent}
                  aria-label="SoundFont 加载进度"
                />
              ) : null}
            </div>
            <div className="rule-test-soundfont-actions">
              <button
                type="button"
                className="command-button primary"
                onClick={onChooseSoundFont}
              >
                <FolderOpen aria-hidden="true" />
                选择本地 SF2
              </button>
              {project.audio.soundFont.kind === "user" ? (
                <button
                  type="button"
                  className="command-button"
                  onClick={onUseDefaultSoundFont}
                >
                  <RotateCcw aria-hidden="true" />
                  恢复默认音色
                </button>
              ) : null}
            </div>
          </div>
        </section>
        <section className="rule-test-form-section">
          <div className="rule-test-section-heading">
            <h3>预期诊断</h3>
            <span>{testCase.expected.diagnostics.length}</span>
          </div>
          <label className="rule-test-check-field">
            <input
              type="checkbox"
              checked={testCase.expected.allowUnexpectedDiagnostics}
              onChange={(event) =>
                onUpdateCase((next) => {
                  next.expected.allowUnexpectedDiagnostics = event.target.checked;
                })
              }
            />
            <span>允许额外诊断</span>
          </label>
          <div className="rule-test-expectation-list">
            {testCase.expected.diagnostics.map((expectation) => (
              <button
                type="button"
                className={`rule-test-expectation ${selectedExpectationId === expectation.id ? "is-selected" : ""}`}
                key={expectation.id}
                onClick={() => onSelectExpectation(expectation.id)}
              >
                <strong>{expectation.messageKey}</strong>
                <small>{expectation.id}</small>
                <small>
                  Tick {expectation.tick} · {expectedReferenceSummary(expectation) || "未限制对象"}
                </small>
              </button>
            ))}
            {testCase.expected.diagnostics.length === 0 ? (
              <div className="rule-test-empty">暂无预期。可从实际结果添加。</div>
            ) : null}
          </div>
        </section>
        {selectedExpectation ? (
          <section className="rule-test-form-section">
            <div className="rule-test-section-heading">
              <h3>预期属性</h3>
              <button
                type="button"
                className="text-button danger"
                onClick={() => onDeleteExpectation(selectedExpectation.id)}
              >
                删除
              </button>
            </div>
            <label className="rule-test-field">
              <span>诊断 ID</span>
              <input value={selectedExpectation.id} readOnly />
            </label>
            <label className="rule-test-field">
              <span>消息键</span>
              <input
                value={selectedExpectation.messageKey}
                onChange={(event) =>
                  onUpdateExpectation(selectedExpectation.id, {
                    messageKey: event.target.value,
                  })
                }
              />
            </label>
            <div className="rule-test-inline-fields">
              <label className="rule-test-field">
                <span>起点 Tick</span>
                <input
                  type="number"
                  min={0}
                  max={project.lengthTicks}
                  value={selectedExpectation.tick}
                  onChange={(event) =>
                    onUpdateExpectation(selectedExpectation.id, {
                      tick: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="rule-test-field">
                <span>终点 Tick</span>
                <input
                  type="number"
                  min={selectedExpectation.tick}
                  max={project.lengthTicks}
                  value={selectedExpectation.endTick ?? ""}
                  onChange={(event) =>
                    onUpdateExpectation(selectedExpectation.id, {
                      endTick: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    })
                  }
                />
              </label>
            </div>
            <label className="rule-test-field">
              <span>声部引用</span>
              <input
                value={selectedExpectation.voiceIds?.join(", ") ?? ""}
                placeholder="soprano, alto"
                onChange={(event) =>
                  onUpdateExpectation(selectedExpectation.id, {
                    voiceIds: event.target.value
                      ? (event.target.value
                          .split(",")
                          .map((item) => item.trim()) as ExpectedDiagnostic["voiceIds"])
                      : undefined,
                  })
                }
              />
            </label>
            <label className="rule-test-field">
              <span>音符引用</span>
              <input
                value={selectedExpectation.noteIds?.join(", ") ?? ""}
                placeholder="通过结果自动填充"
                onChange={(event) =>
                  onUpdateExpectation(selectedExpectation.id, {
                    noteIds: event.target.value
                      ? event.target.value.split(",").map((item) => item.trim())
                      : undefined,
                  })
                }
              />
            </label>
            <label className="rule-test-field">
              <span>和弦引用</span>
              <input
                value={selectedExpectation.chordIds?.join(", ") ?? ""}
                placeholder="通过结果自动填充"
                onChange={(event) =>
                  onUpdateExpectation(selectedExpectation.id, {
                    chordIds: event.target.value
                      ? event.target.value.split(",").map((item) => item.trim())
                      : undefined,
                  })
                }
              />
            </label>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
