import type {
  ExternalRuleFailure,
  InstalledExternalRulePackage,
} from "../../domain/externalRules";
import type {
  HarmonyRuleId,
  HarmonyRuleSeverities,
  HarmonyRuleSeverity,
  RuleConfig,
  RuleExceptionPolicy,
} from "../../domain/harmonyRules";
import type { RuleProfile } from "../../domain/model";
import type {
  ShortcutBindings,
  ShortcutCommandId,
} from "../../shortcuts/shortcutRegistry";

export interface SettingsDialogProps {
  bindings: ShortcutBindings;
  onSetBinding(commandId: ShortcutCommandId, binding: string): void;
  onClearBinding(commandId: ShortcutCommandId): void;
  onResetBinding(commandId: ShortcutCommandId): void;
  onResetAll(): void;
  profileTitle: string;
  ruleHitCounts: Record<string, number>;
  ruleSeverities: HarmonyRuleSeverities;
  ruleConfigs: Partial<Record<HarmonyRuleId, RuleConfig>>;
  ruleExceptions: Partial<Record<HarmonyRuleId, RuleExceptionPolicy>>;
  onSetRuleSeverity(ruleId: HarmonyRuleId, severity: HarmonyRuleSeverity): void;
  onSetRuleConfig(ruleId: HarmonyRuleId, patch: RuleConfig): void;
  onSetRuleException(
    ruleId: HarmonyRuleId,
    policy: RuleExceptionPolicy | undefined,
  ): void;
  onResetRule(ruleId: HarmonyRuleId): void;
  onResetAllRules(): void;
  onImportRuleProfile(): void;
  onExportRuleProfile(): void;
  onSetDefaultRuleProfile(): void;
  externalRulePackages: InstalledExternalRulePackage[];
  externalRuleReferences: RuleProfile["external"];
  externalRuleFailures: ExternalRuleFailure[];
  externalRuleLibraryLoading: boolean;
  externalRuleLibraryError?: string;
  onImportExternalRulePackage(): void;
  onMountExternalRulePackage(
    installedPackage: InstalledExternalRulePackage,
  ): void;
  onRemoveExternalRulePackage(
    installedPackage: InstalledExternalRulePackage,
  ): void;
  onSetExternalRuleEnabled(
    reference: RuleProfile["external"][number],
    enabled: boolean,
  ): void;
  onSetExternalRuleSeverity(
    reference: RuleProfile["external"][number],
    severity: HarmonyRuleSeverity,
  ): void;
  onSetExternalRuleConfig(
    reference: RuleProfile["external"][number],
    patch: RuleConfig,
  ): void;
  onSetExternalRuleException(
    reference: RuleProfile["external"][number],
    policy: RuleExceptionPolicy | undefined,
  ): void;
  onResetExternalRule(reference: RuleProfile["external"][number]): void;
  developerMode: boolean;
  onSetDeveloperMode(enabled: boolean): void;
  onClose(): void;
}

export type RuleSettingsProps = Pick<
  SettingsDialogProps,
  | "profileTitle"
  | "ruleHitCounts"
  | "ruleSeverities"
  | "ruleConfigs"
  | "ruleExceptions"
  | "onSetRuleSeverity"
  | "onSetRuleConfig"
  | "onSetRuleException"
  | "onResetRule"
  | "onResetAllRules"
  | "onImportRuleProfile"
  | "onExportRuleProfile"
  | "onSetDefaultRuleProfile"
  | "externalRulePackages"
  | "externalRuleReferences"
  | "externalRuleFailures"
  | "externalRuleLibraryLoading"
  | "externalRuleLibraryError"
  | "onImportExternalRulePackage"
  | "onMountExternalRulePackage"
  | "onRemoveExternalRulePackage"
  | "onSetExternalRuleEnabled"
  | "onSetExternalRuleSeverity"
  | "onSetExternalRuleConfig"
  | "onSetExternalRuleException"
  | "onResetExternalRule"
>;
