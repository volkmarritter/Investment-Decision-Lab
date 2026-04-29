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
