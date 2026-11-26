import { createDefaultRuleProfile, type RuleProfile } from "../domain/project";
import { createPortableRuleProfile, prepareRuleProfileImport } from "../domain/ruleProfile";

const NEW_PROJECT_RULE_PROFILE_KEY = "satb-master-new-project-rule-profile-v1";

export function saveNewProjectRuleProfile(profile: RuleProfile) {
  localStorage.setItem(NEW_PROJECT_RULE_PROFILE_KEY, JSON.stringify(createPortableRuleProfile(profile)));
}

export function loadNewProjectRuleProfile(): RuleProfile | undefined {
  const raw = localStorage.getItem(NEW_PROJECT_RULE_PROFILE_KEY);
  if (!raw) return undefined;
  try {
    return prepareRuleProfileImport(JSON.parse(raw), createDefaultRuleProfile()).profile;
  } catch {
    // 损坏的应用级模板不能阻止编辑器启动；保留数据，供用户后续覆盖。
    return undefined;
  }
}
