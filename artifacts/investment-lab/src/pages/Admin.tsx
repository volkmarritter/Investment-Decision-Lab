import { useEffect, useState } from "react";
import { Redirect, Route, Switch } from "wouter";
import {
  adminApi,
  clearToken,
  getToken,
  setToken,
  type CatalogSummary,
} from "@/lib/admin-api";
import { AdminContextProvider } from "@/components/admin/AdminContext";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { TokenPrompt } from "@/components/admin/TokenPrompt";
import Overview from "@/pages/admin/Overview";
import Catalog from "@/pages/admin/Catalog";
import Defaults from "@/pages/admin/Defaults";
import Operations from "@/pages/admin/Operations";
import Docs from "@/pages/admin/Docs";

export default function Admin() {
  const [token, setLocalToken] = useState<string | null>(getToken());
  const [authError, setAuthError] = useState<string | null>(null);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [directWrite, setDirectWrite] = useState(false);
  const [githubInfo, setGithubInfo] = useState<{
    owner: string | null;
    repo: string | null;
    baseBranch: string;
  }>({ owner: null, repo: null, baseBranch: "main" });
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    adminApi
      .whoami(token)
      .then((r) => {
        setGithubConfigured(r.githubConfigured);
        setDirectWrite(r.directWrite ?? false);
        setGithubInfo({
          owner: r.githubOwner,
          repo: r.githubRepo,
          baseBranch: r.githubBaseBranch,
        });
      })
      .catch((e: Error) => {
        setAuthError(e.message);
        setLocalToken(null);
        clearToken();
      });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    adminApi
      .catalog()
      .then((r) => {
        setCatalog(r.entries);
        setCatalogError(null);
      })
      .catch((e: Error) => setCatalogError(e.message));
  }, [token]);

  if (!token) {
    return (
      <TokenPrompt
        error={authError}
        onSubmit={(t) => {
          setToken(t);
          setLocalToken(t);
          setAuthError(null);
        }}
      />
    );
  }

  return (
    <AdminContextProvider
      value={{ githubConfigured, directWrite, githubInfo, catalog, catalogError }}
    >
      <AdminLayout
        onSignOut={() => {
          clearToken();
          setLocalToken(null);
        }}
      >
        <Switch>
          <Route path="/admin" component={Overview} />
          <Route path="/admin/catalog">
            <Redirect to="/admin/catalog/browse" />
          </Route>
          <Route path="/admin/catalog/browse" component={Catalog} />
          <Route path="/admin/catalog/instruments" component={Catalog} />
          <Route path="/admin/catalog/add-isin" component={Catalog} />
          <Route path="/admin/catalog/batch" component={Catalog} />
          <Route path="/admin/defaults" component={Defaults} />
          <Route path="/admin/operations">
            <Redirect to="/admin/operations/sync" />
          </Route>
          <Route path="/admin/operations/sync" component={Operations} />
          <Route path="/admin/operations/prs" component={Operations} />
          <Route path="/admin/operations/changes" component={Operations} />
          <Route path="/admin/operations/runs" component={Operations} />
          <Route path="/admin/operations/freshness" component={Operations} />
          <Route path="/admin/docs" component={Docs} />
          <Route component={Overview} />
        </Switch>
      </AdminLayout>
    </AdminContextProvider>
  );
}
