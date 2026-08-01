import { useCallback, useEffect, useState } from "react";
import type { InstalledExternalRulePackage } from "../domain/externalRules";
import {
  installExternalRulePackage,
  listExternalRulePackages,
  removeExternalRulePackage,
  selectExternalRulePackage,
} from "../services/externalRuleLibrary";
import { inspectExternalRuleCandidate } from "../services/externalRuleRuntime";

export function useExternalRuleLibrary() {
  const [packages, setPackages] = useState<InstalledExternalRulePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPackages(await listExternalRulePackages());
      setError(undefined);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importPackage = useCallback(async () => {
    const candidate = await selectExternalRulePackage();
    if (!candidate) return undefined;
    // manifest 只在 QuickJS 中求值；通过结构校验后主进程才把源码复制进私有规则库。
    const manifest = await inspectExternalRuleCandidate(candidate);
    const installed = await installExternalRulePackage(candidate, manifest);
    setPackages((current) => [
      ...current.filter((item) => item.contentHash !== installed.contentHash),
      installed,
    ]);
    setError(undefined);
    return installed;
  }, []);

  const removePackage = useCallback(async (contentHash: string) => {
    await removeExternalRulePackage(contentHash);
    setPackages((current) =>
      current.filter((item) => item.contentHash !== contentHash),
    );
  }, []);

  return {
    packages,
    loading,
    error,
    refresh,
    importPackage,
    removePackage,
  };
}
