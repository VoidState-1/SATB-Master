import { useMemo } from "react";
import {
  FileText,
  FolderOpen,
  ListChecks,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Volume2,
} from "lucide-react";
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
      <div className="rule-test-inspector-content">
        <section className="rule-test-form-section">
          <div className="rule-test-section-heading">
            <h3>
              <FileText aria-hidden="true" />
              用例属性
            </h3>
          </div>
          <label className="rule-test-field">
            <span className="rule-test-field-label">标题</span>
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
            <span className="rule-test-field-label">说明</span>
            <textarea
              rows={2}
              value={testCase.description ?? ""}
              placeholder="添加用例说明（可选）"
              onChange={(event) =>
                onUpdateCase((next) => {
                  next.description = event.target.value || undefined;
                })
              }
            />
          </label>
          <label className="rule-test-field">
            <span className="rule-test-field-label">标签</span>
            <input
              value={testCase.tags.join(", ")}
              placeholder="用逗号分隔标签"
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
          <div className="rule-test-section-heading">
            <h3>
              <ShieldCheck aria-hidden="true" />
              测试规则
            </h3>
          </div>
          <RuleSearch
            ruleId={testCase.target.ruleId}
            onSelect={onSetRule}
          />
          <p className="rule-test-rule-description">
            {definition.description}
          </p>
          <label className="rule-test-field">
            <span className="rule-test-field-label">严重程度</span>
            <select
              value={testCase.execution.severity}
              onChange={(event) =>
                onUpdateCase((next) => {
                  next.execution.severity = event.target.value as typeof next.execution.severity;
                })
              }
            >
              <option value="error">错误 (Error)</option>
              <option value="warning">警告 (Warning)</option>
              <option value="suggestion">建议 (Suggestion)</option>
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
          <div className="rule-test-section-heading">
            <h3>
              <Volume2 aria-hidden="true" />
              SoundFont 音源
            </h3>
          </div>
          <div className="rule-test-soundfont-card">
            <div className="rule-test-soundfont-header">
              <span className="rule-test-soundfont-name" title={project.audio.soundFont.name || "默认音色"}>
                {project.audio.soundFont.name || "默认音色 (General MIDI)"}
              </span>
              <span className={`rule-test-soundfont-badge ${audioState === "ready" || !audioState ? "is-ready" : "is-loading"}`}>
                {audioMessage || "SoundFont 已就绪"}
              </span>
            </div>
            {soundFontPercent !== undefined ? (
              <div className="rule-test-soundfont-progress">
                <progress
                  max="100"
                  value={soundFontPercent}
                  aria-label="SoundFont 加载进度"
                />
                <small>{soundFontPercent}%</small>
              </div>
            ) : null}
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
            <h3>
              <ListChecks aria-hidden="true" />
              预期诊断
            </h3>
            <span className="rule-test-count-badge">
              {testCase.expected.diagnostics.length}
            </span>
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
            <span>允许额外诊断（忽略未预期的诊断）</span>
          </label>
          <div className="rule-test-expectation-list">
            {testCase.expected.diagnostics.map((expectation) => (
              <button
                type="button"
                className={`rule-test-expectation ${selectedExpectationId === expectation.id ? "is-selected" : ""}`}
                key={expectation.id}
                onClick={() => onSelectExpectation(expectation.id)}
              >
                <div className="rule-test-expectation-header">
                  <strong>{expectation.messageKey}</strong>
                  <small>{expectation.id}</small>
                </div>
                <div className="rule-test-expectation-meta">
                  <span>Tick {expectation.tick}</span>
                  <span>
                    {expectedReferenceSummary(expectation) || "未限制声部/音符"}
                  </span>
                </div>
              </button>
            ))}
            {testCase.expected.diagnostics.length === 0 ? (
              <div className="rule-test-empty-box">
                <span>暂无预期诊断</span>
                <small>运行测试后可从实际结果一键添加预期</small>
              </div>
            ) : null}
          </div>
        </section>

        {selectedExpectation ? (
          <section className="rule-test-form-section">
            <div className="rule-test-section-heading">
              <h3>
                <Settings2 aria-hidden="true" />
                预期属性
              </h3>
              <button
                type="button"
                className="text-button danger"
                onClick={() => onDeleteExpectation(selectedExpectation.id)}
              >
                删除预期
              </button>
            </div>
            <label className="rule-test-field">
              <span className="rule-test-field-label">诊断 ID</span>
              <input value={selectedExpectation.id} readOnly />
            </label>
            <label className="rule-test-field">
              <span className="rule-test-field-label">消息键</span>
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
                <span className="rule-test-field-label">起点 Tick</span>
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
                <span className="rule-test-field-label">终点 Tick</span>
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
              <span className="rule-test-field-label">声部引用</span>
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
              <span className="rule-test-field-label">音符引用</span>
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
              <span className="rule-test-field-label">和弦引用</span>
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
