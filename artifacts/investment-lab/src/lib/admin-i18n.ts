// ----------------------------------------------------------------------------
// admin-i18n — small inline-translation helper for the /admin route.
// ----------------------------------------------------------------------------
// The main app uses a centralized key-based dictionary (lib/i18n.tsx) which is
// great for the public surface. The admin route however contains hundreds of
// short, context-specific strings (panel titles, button labels, alert copy,
// validation messages) that are only ever read by the operator. Folding them
// into the central dict would balloon it by 200-400 keys with no benefit.
//
// Instead we provide useAdminT() which returns:
//   - lang / setLang: passthrough to the central LanguageProvider so the
//     existing `investment-lab.lang.v1` localStorage key is honoured and a
//     language switch in admin propagates to the rest of the app.
//   - t({ de, en }): returns the string for the active language inline at the
//     callsite, so DE + EN copy live next to each other and stay in sync
//     during edits/review.
// ----------------------------------------------------------------------------

import { useT } from "@/lib/i18n";

export type AdminCopy = { de: string; en: string };

export function useAdminT() {
  const { lang, setLang } = useT();
  function t(s: AdminCopy): string {
    return s[lang];
  }
  return { lang, setLang, t };
}
