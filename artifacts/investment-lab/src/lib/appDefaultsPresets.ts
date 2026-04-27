// ---------------------------------------------------------------------------
// Preset-Sets fuer den /admin → "Globale Defaults"-Editor.
// ---------------------------------------------------------------------------
// Vordefinierte Vorlagen, die der Operator per Dropdown in den Editor laden
// kann, statt jeden Wert einzeln zu tippen. Anwendung erfolgt rein client-
// seitig: ein Preset fuellt die Editor-Felder, der Operator kann sie noch
// anpassen, und der eigentliche PR durchlaeuft anschliessend dieselbe
// strenge Validierung im api-server (validateAppDefaults).
//
// Semantik der Anwendung (siehe Admin.tsx -> applyPreset):
//   Pro Sektion (riskFreeRates / homeBias / cma) gilt:
//     - Sektion FEHLT im Preset       -> Editor-Felder dieser Sektion bleiben
//                                        unveraendert (Operator kann presets
//                                        kombinieren, z. B. "RF Hochzins" +
//                                        manuelle HB-Anpassung).
//     - Sektion VORHANDEN, aber leer  -> alle Felder dieser Sektion werden
//                                        geleert ("Built-in zurueckruecksetzen").
//     - Sektion mit Werten            -> alle Felder dieser Sektion werden
//                                        gesetzt; Felder ohne Preset-Wert
//                                        werden geleert (vollstaendiger
//                                        Sektionsersatz, kein Mischvorgang
//                                        mit alten Eingaben).
//
// Saemtliche Werte hier MUESSEN innerhalb der Sanitiser-Schranken aus
// `appDefaults.ts` liegen (RF [0, 0.20], HB [0, 5], CMA mu [-0.5, 1],
// vol [0, 2]). Tests in `tests/app-defaults-presets.test.ts` erzwingen das.
// ---------------------------------------------------------------------------

import type {
  AppDefaultsAssetKey,
  AppDefaultsHbCurrency,
  AppDefaultsPayload,
  AppDefaultsRfCurrency,
} from "./admin-api";

export type AppDefaultsPreset = {
  id: string;
  label: string;
  description: string;
  payload: AppDefaultsPayload;
};

// Die "Beispiel"-Presets sind bewusst gerundete Archetypen, keine offiziellen
// Hausmeinungen — der "(Beispiel)"-Suffix im Label macht das fuer den
// Operator unmissverstaendlich. Sie eignen sich als Startpunkt fuer eine
// Stress-Test-Konfiguration; finale Werte sollte der Operator vor dem PR
// ueberpruefen.

const RF_LOW: Record<AppDefaultsRfCurrency, number> = {
  USD: 0.0100,
  EUR: 0.0050,
  GBP: 0.0100,
  CHF: 0.0000,
};

const RF_HIGH: Record<AppDefaultsRfCurrency, number> = {
  USD: 0.0550,
  EUR: 0.0400,
  GBP: 0.0525,
  CHF: 0.0175,
};

// Hoehere Multiplikatoren = staerkere Bevorzugung der Heimatregion.
// "Global" lockert die Heimatpraeferenz auf 1.0 ueber alle Currencies
// (kein Heimat-Tilt) — nuetzlich fuer Vergleiche / Reporting.
const HB_GLOBAL: Record<AppDefaultsHbCurrency, number> = {
  USD: 1.0,
  EUR: 1.0,
  GBP: 1.0,
  CHF: 1.0,
};

// Konservative CMA: Equity-Renditen rund 1.5 Prozentpunkte unter Built-in,
// Vol unveraendert. Erlaubt einen Bear-Market-Stresstest, ohne die
// Korrelationsmatrix anzufassen.
const CMA_CONSERVATIVE: Partial<Record<AppDefaultsAssetKey, { expReturn?: number; vol?: number }>> = {
  equity_us: { expReturn: 0.055 },
  equity_eu: { expReturn: 0.060 },
  equity_uk: { expReturn: 0.050 },
  equity_ch: { expReturn: 0.045 },
  equity_jp: { expReturn: 0.045 },
  equity_em: { expReturn: 0.070 },
  equity_thematic: { expReturn: 0.065 },
  reits: { expReturn: 0.050 },
};

export const APP_DEFAULTS_PRESETS: AppDefaultsPreset[] = [
  {
    id: "reset-builtin",
    label: "Built-in-Defaults wiederherstellen",
    description:
      "Setzt alle drei Sektionen zurueck (leer). Ein PR auf dieser Basis " +
      "loescht jeden globalen Override; danach gelten wieder die im Code " +
      "verdrahteten Built-ins.",
    payload: {
      riskFreeRates: {},
      homeBias: {},
      cma: {},
    },
  },
  {
    id: "rf-low-rate",
    label: "Niedrigzins-Umfeld (Beispiel)",
    description:
      "Risk-Free Rates auf Post-2020-Niveau (USD 1.0%, EUR 0.5%, GBP 1.0%, " +
      "CHF 0.0%). Home-Bias und CMA bleiben unangetastet.",
    payload: {
      riskFreeRates: { ...RF_LOW },
    },
  },
  {
    id: "rf-high-rate",
    label: "Hochzins-Umfeld (Beispiel)",
    description:
      "Risk-Free Rates auf 2023/24-Spitzenniveau (USD 5.5%, EUR 4.0%, " +
      "GBP 5.25%, CHF 1.75%). Home-Bias und CMA bleiben unangetastet.",
    payload: {
      riskFreeRates: { ...RF_HIGH },
    },
  },
  {
    id: "hb-global",
    label: "Home-Bias neutral / global (Beispiel)",
    description:
      "Setzt alle Home-Bias-Multiplikatoren auf 1.0 (kein Heimat-Tilt). " +
      "Risk-Free und CMA bleiben unangetastet. Nuetzlich fuer Vergleichs- " +
      "und Reporting-Setups, in denen die Modellportfolios MSCI-ACWI-nah " +
      "bleiben sollen.",
    payload: {
      homeBias: { ...HB_GLOBAL },
    },
  },
  {
    id: "cma-conservative-equity",
    label: "Konservative Equity-CMA (Beispiel)",
    description:
      "Senkt erwartete Equity-Renditen (US/EU/UK/CH/JP/EM/Thematic + REITs) " +
      "um etwa 1.5 Prozentpunkte gegenueber Built-in; Volatilitaeten und " +
      "Bonds/Cash/Gold/Crypto bleiben unangetastet. Eignet sich als Stress- " +
      "Szenario fuer Bear-Market-Annahmen.",
    payload: {
      cma: { ...CMA_CONSERVATIVE },
    },
  },
];

export function findPresetById(id: string): AppDefaultsPreset | undefined {
  return APP_DEFAULTS_PRESETS.find((p) => p.id === id);
}
