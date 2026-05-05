// AdminContext — shared GitHub config + catalog snapshot for /admin sections.

import { createContext, useContext } from "react";
import type { CatalogSummary } from "@/lib/admin-api";

export type AdminGithubInfo = {
  owner: string | null;
  repo: string | null;
  baseBranch: string;
};

export type AdminContextValue = {
  githubConfigured: boolean;
  githubInfo: AdminGithubInfo;
  // Direct-write mode (2026-05): when true, catalog mutations write
  // `etfs.ts` on disk and PR-related UI (badges, polling, Operations
  // → Pull requests sub-tab, "Pull request opened" toasts) is hidden.
  directWrite: boolean;
  catalog: CatalogSummary | null;
  catalogError: string | null;
};

const AdminCtx = createContext<AdminContextValue | null>(null);

export const AdminContextProvider = AdminCtx.Provider;

export function useAdminContext(): AdminContextValue {
  const v = useContext(AdminCtx);
  if (!v) throw new Error("useAdminContext used outside <AdminContextProvider>");
  return v;
}
