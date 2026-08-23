import {
  useState,
  useMemo,
  type FormEvent,
  useEffect,
  useRef,
} from "react";
import { FolderTree, X } from "lucide-react";
import type { HarmonyRuleId } from "../../domain/harmony";
import { RuleSearch } from "./RuleSearch";

export interface CreateTestCaseDialogOptions {
  initialRuleId?: HarmonyRuleId;
  libraryDirectory?: string;
  onOpenDirectory(): void;
  onClose(): void;
  onCreate(params: {
    title: string;
    ruleId: HarmonyRuleId;
    fileName: string;
    template: "blank" | "inherit";
  }): void;
}

function sanitizeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_");
  if (!cleaned) return "new-test-case";
  return cleaned.endsWith(".satb-rule-case.json")
    ? cleaned
    : `${cleaned}.satb-rule-case.json`;
}

export function CreateTestCaseDialog({
  initialRuleId = "voice.range",
  libraryDirectory,
  onOpenDirectory,
  onClose,
  onCreate,
}: CreateTestCaseDialogOptions) {
  const [title, setTitle] = useState("");
  const [ruleId, setRuleId] = useState<HarmonyRuleId>(initialRuleId);
  const [customFileName, setCustomFileName] = useState("");
  const [isFileNameEdited, setIsFileNameEdited] = useState(false);
  const [template, setTemplate] = useState<"blank" | "inherit">("blank");
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  // 自动根据用例标题推荐文件名
  const autoFileName = useMemo(() => {
    if (!title.trim()) return `${ruleId}.satb-rule-case.json`;
    return sanitizeFileName(title);
  }, [title, ruleId]);

  const effectiveFileName = isFileNameEdited ? customFileName : autoFileName;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !libraryDirectory) return;
    onCreate({
      title: title.trim(),
      ruleId,
      fileName: sanitizeFileName(effectiveFileName),
      template,
    });
  };

  return (
    <div className="confirmation-backdrop" onClick={onClose}>
      <div
        className="confirmation-dialog create-test-case-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-test-case-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="create-test-case-header">
          <h2 id="create-test-case-title">新建规则测试用例</h2>
          <button
            type="button"
            className="dialog-close-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="create-test-case-form">
          <div className="create-test-case-field">
            <label htmlFor="test-case-title">用例标题</label>
            <input
              id="test-case-title"
              ref={titleInputRef}
              type="text"
              required
              value={title}
              placeholder="例如：平行五度测试用例"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="create-test-case-field">
            <label>目标测试规则</label>
            <RuleSearch
              ruleId={ruleId}
              onSelect={(nextRuleId) => setRuleId(nextRuleId)}
            />
          </div>

          <div className="create-test-case-field">
            <label htmlFor="test-case-filename">保存文件名</label>
            <input
              id="test-case-filename"
              type="text"
              value={effectiveFileName}
              placeholder="文件名.satb-rule-case.json"
              onChange={(e) => {
                setIsFileNameEdited(true);
                setCustomFileName(e.target.value);
              }}
            />
          </div>

          <div className="create-test-case-field">
            <label>乐谱初始内容</label>
            <div className="create-test-case-segmented">
              <button
                type="button"
                className={template === "blank" ? "is-active" : ""}
                onClick={() => setTemplate("blank")}
              >
                空白 SATB 声部
              </button>
              <button
                type="button"
                className={template === "inherit" ? "is-active" : ""}
                onClick={() => setTemplate("inherit")}
              >
                继承当前编辑乐谱
              </button>
            </div>
          </div>

          <div className="create-test-case-directory-info">
            <FolderTree aria-hidden="true" />
            <div className="create-test-case-directory-text">
              <span>保存用例目录：</span>
              <strong title={libraryDirectory}>
                {libraryDirectory ? (
                  libraryDirectory.split(/[\\/]/).filter(Boolean).at(-1)
                ) : (
                  <span className="is-warning">尚未选择用例目录</span>
                )}
              </strong>
            </div>
            {!libraryDirectory ? (
              <button
                type="button"
                className="command-button secondary"
                onClick={onOpenDirectory}
              >
                选择目录
              </button>
            ) : null}
          </div>

          <div className="confirmation-actions" style={{ marginTop: 20 }}>
            <button
              type="button"
              className="command-button secondary"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="command-button primary"
              disabled={!title.trim() || !libraryDirectory}
            >
              创建用例
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
