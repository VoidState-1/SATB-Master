import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import {
  HARMONY_RULE_GROUPS,
  HARMONY_RULE_DEFINITIONS,
  type HarmonyRuleId,
  type HarmonyRuleGroupId,
} from "../../domain/harmony";

interface RuleSearchProps {
  ruleId: HarmonyRuleId;
  onSelect(ruleId: HarmonyRuleId): void;
}

export function RuleSearch({ ruleId, onSelect }: RuleSearchProps) {
  const selected = HARMONY_RULE_DEFINITIONS.find((item) => item.id === ruleId)!;
  const selectedLabel = `${selected.id} · ${selected.label}`;
  const [query, setQuery] = useState(selectedLabel);
  const [groupId, setGroupId] = useState<"all" | HarmonyRuleGroupId>("all");
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  }>({ top: 0, left: 0, width: 0, maxHeight: 360 });

  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setQuery(selectedLabel), [selectedLabel]);

  const updatePosition = () => {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 16;
    const spaceAbove = rect.top - 16;

    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
      setMenuStyle({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        maxHeight: Math.max(160, Math.min(420, spaceBelow)),
      });
    } else {
      const height = Math.max(160, Math.min(360, spaceAbove));
      setMenuStyle({
        top: rect.top - height - 4,
        left: rect.left,
        width: rect.width,
        maxHeight: height,
      });
    }
  };

  const handleOpen = () => {
    updatePosition();
    setQuery("");
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        rootRef.current?.contains(event.target as Node) ||
        menuRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setOpen(false);
      setQuery(selectedLabel);
    };
    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open, selectedLabel]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return HARMONY_RULE_DEFINITIONS.filter((rule) =>
      (groupId === "all" || rule.group === groupId) &&
      `${rule.id} ${rule.label} ${rule.description} ${
        HARMONY_RULE_GROUPS.find((group) => group.id === rule.group)?.label ??
        ""
      }`
        .toLowerCase()
        .includes(needle),
    );
  }, [groupId, query]);

  const groupedMatches = useMemo(
    () =>
      HARMONY_RULE_GROUPS.map((group) => ({
        ...group,
        rules: matches.filter((rule) => rule.group === group.id),
      })).filter((group) => group.rules.length > 0),
    [matches],
  );

  return (
    <div ref={rootRef} className="rule-test-rule-search">
      <div className="rule-search-input-wrapper">
        <Search className="rule-search-icon" aria-hidden="true" />
        <input
          aria-label="搜索目标规则"
          placeholder="搜索规则名称或 ID..."
          value={query}
          onFocus={handleOpen}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) handleOpen();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) {
              onSelect(matches[0].id);
              setQuery(`${matches[0].id} · ${matches[0].label}`);
              setOpen(false);
            }
            if (event.key === "Escape") {
              setQuery(selectedLabel);
              setOpen(false);
            }
          }}
        />
      </div>
      {open && menuStyle.width > 0
        ? createPortal(
            <div
              ref={menuRef}
              className="rule-test-rule-menu is-floating"
              role="listbox"
              style={{
                position: "fixed",
                top: `${menuStyle.top}px`,
                left: `${menuStyle.left}px`,
                width: `${menuStyle.width}px`,
                maxHeight: `${menuStyle.maxHeight}px`,
                zIndex: 1000,
              }}
            >
              <div className="rule-test-rule-filter">
                <label htmlFor="rule-test-rule-group">分类</label>
                <select
                  id="rule-test-rule-group"
                  aria-label="按规则分类筛选"
                  value={groupId}
                  onChange={(event) =>
                    setGroupId(
                      event.target.value as "all" | HarmonyRuleGroupId,
                    )
                  }
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <option value="all">
                    全部规则（{HARMONY_RULE_DEFINITIONS.length}）
                  </option>
                  {HARMONY_RULE_GROUPS.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.label}（
                      {
                        HARMONY_RULE_DEFINITIONS.filter(
                          (rule) => rule.group === group.id,
                        ).length
                      }
                      ）
                    </option>
                  ))}
                </select>
                <span>{matches.length} 条</span>
              </div>
              {groupedMatches.map((group) => (
                <section className="rule-test-rule-group" key={group.id}>
                  <h4>
                    {group.label}
                    <span>{group.rules.length}</span>
                  </h4>
                  {group.rules.map((rule) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={rule.id === ruleId}
                      key={rule.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onSelect(rule.id);
                        setQuery(`${rule.id} · ${rule.label}`);
                        setOpen(false);
                      }}
                    >
                      <strong>{rule.label}</strong>
                      <small>{rule.id}</small>
                    </button>
                  ))}
                </section>
              ))}
              {matches.length === 0 ? (
                <div className="rule-test-rule-empty">没有匹配的规则</div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
