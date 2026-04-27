// ---------------------------------------------------------------------------
// Preset-Sets fuer den /admin → "Globale Defaults"-Editor.
// ---------------------------------------------------------------------------
// Vordefinierte Vorlagen, die der Operator per Dropdown in den Editor laden
// kann, statt jeden Wert einzeln zu tippen. Anwendung erfolgt rein client-
// seitig: ein Preset fuellt die Editor-Felder, der Operator kann sie noch
// anpassen, und der eigentliche PR durchlaeuft anschliessend dieselbe
// strenge Validierung im api-server (validateAppDefaults).
//
// Anwendungs-Semantik (siehe applyPresetToFields):
//   1. Erst werden alle Sektionen in `preset.clear` vollstaendig geleert.
//      Beispiel: `clear: ['rf','hb','cma']` -> alle drei Editor-Tabellen leer.
//   2. Danach werden Werte aus `preset.payload` per-key gemerget:
//        - Felder, die im Preset einen Wert haben -> ueberschrieben.
//        - Felder, die das Preset NICHT erwaehnt -> bleiben wie sie sind
//          (also: vorher gesetzter Wert bleibt erhalten).
//      Damit kann ein Preset gezielt einzelne Knoepfe drehen
//      (z. B. "Equity-mu konservativer", ohne Vol oder Bonds anzufassen)
//      und vorhandene manuelle Eingaben des Operators bleiben erhalten,
//      solange die Vorlage sie nicht explizit ueberschreibt.
//
// Diese zwei-Phasen-Semantik (clear, dann merge) deckt beide Faelle sauber:
// "alles wegwischen" (Reset) und "ein paar Werte ergaenzen / korrigieren".
//
// Saemtliche Werte hier MUESSEN innerhalb der Sanitiser-Schranken aus
// `appDefaults.ts` liegen (RF [0, 0.20], HB [0, 5], CMA mu [-0.5, 1],
// vol [0, 2]). Tests in `tests/app-defaults-presets.test.ts` erzwingen das
// und decken auch die clear/merge-Semantik ab.
// ---------------------------------------------------------------------------

import type {
  AppDefaultsAssetKey,
  AppDefaultsHbCurrency,
  AppDefaultsPayload,
  AppDefaultsRfCurrency,
} from "./admin-api";

export type AppDefaultsPresetSection = "rf" | "hb" | "cma";

export type AppDefaultsPreset = {
  id: string;
  label: string;
  description: string;
  /** Sektionen, die vor dem Merge vollstaendig geleert werden sollen. */
  clear?: AppDefaultsPresetSection[];
  /** Per-key-Merge nach dem clear-Schritt. */
  payload?: AppDefaultsPayload;
};

const RF_KEYS_ORDER: AppDefaultsRfCurrency[] = ["USD", "EUR", "GBP", "CHF"];
const HB_KEYS_ORDER: AppDefaultsHbCurrency[] = ["USD", "EUR", "GBP", "CHF"];
const ASSET_KEYS_ORDER: AppDefaultsAssetKey[] = [
  "equity_us",
  "equity_eu",
  "equity_uk",
  "equity_ch",
  "equity_jp",
  "equity_em",
  "equity_thematic",
  "bonds",
  "cash",
  "gold",
  "reits",
  "crypto",
];

// Editor field state types — strings, weil "leer" = "nicht gesetzt"
// und Zwischenzustaende beim Tippen (z. B. "1.") gueltig sein muessen.
export type RfFields = Record<AppDefaultsRfCurrency, string>;
export type HbFields = Record<AppDefaultsHbCurrency, string>;
export type CmaFields = Record<AppDefaultsAssetKey, { expReturn: string; vol: string }>;

// ---------------------------------------------------------------------------
// Preset-Definitionen
// ---------------------------------------------------------------------------

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

const HB_GLOBAL: Record<AppDefaultsHbCurrency, number> = {
  USD: 1.0,
  EUR: 1.0,
  GBP: 1.0,
  CHF: 1.0,
};

// Konservative CMA: nur die expReturn-Werte fuer Equity-Buckets + REITs
// werden auf etwa 1.5 Prozentpunkte unter Built-in gesetzt. Vol und alle
// uebrigen Asset-Klassen werden vom Preset NICHT erwaehnt -> sie bleiben
// dank der Per-Key-Merge-Semantik genau so, wie sie im Editor stehen
// (Built-in oder vorherige operator edits).
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
    clear: ["rf", "hb", "cma"],
  },
  {
    id: "rf-low-rate",
    label: "Niedrigzins-Umfeld (Beispiel)",
    description:
      "Setzt alle Risk-Free Rates auf Post-2020-Niveau (USD 1.0%, EUR 0.5%, " +
      "GBP 1.0%, CHF 0.0%). Home-Bias und CMA bleiben unveraendert.",
    clear: ["rf"],
    payload: { riskFreeRates: { ...RF_LOW } },
  },
  {
    id: "rf-high-rate",
    label: "Hochzins-Umfeld (Beispiel)",
    description:
      "Setzt alle Risk-Free Rates auf 2023/24-Spitzenniveau (USD 5.5%, " +
      "EUR 4.0%, GBP 5.25%, CHF 1.75%). Home-Bias und CMA bleiben unveraendert.",
    clear: ["rf"],
    payload: { riskFreeRates: { ...RF_HIGH } },
  },
  {
    id: "hb-global",
    label: "Home-Bias neutral / global (Beispiel)",
    description:
      "Setzt alle Home-Bias-Multiplikatoren auf 1.0 (kein Heimat-Tilt). " +
      "Risk-Free und CMA bleiben unveraendert. Nuetzlich fuer Vergleichs- " +
      "und Reporting-Setups, in denen die Modellportfolios MSCI-ACWI-nah " +
      "bleiben sollen.",
    clear: ["hb"],
    payload: { homeBias: { ...HB_GLOBAL } },
  },
  {
    id: "cma-conservative-equity",
    label: "Konservative Equity-CMA (Beispiel)",
    description:
      "Senkt erwartete Equity-Renditen (US/EU/UK/CH/JP/EM/Thematic + REITs) " +
      "um etwa 1.5 Prozentpunkte gegenueber Built-in. Volatilitaeten und " +
      "Bonds/Cash/Gold/Crypto bleiben unveraendert. Eignet sich als Stress- " +
      "Szenario fuer Bear-Market-Annahmen.",
    payload: { cma: { ...CMA_CONSERVATIVE } },
  },
];

export function findPresetById(id: string): AppDefaultsPreset | undefined {
  return APP_DEFAULTS_PRESETS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Pure Anwendungslogik (in eigener Funktion, damit getestet werden kann
// ohne React zu mounten).
// ---------------------------------------------------------------------------

function emptyRf(): RfFields {
  return Object.fromEntries(RF_KEYS_ORDER.map((k) => [k, ""])) as RfFields;
}
function emptyHb(): HbFields {
  return Object.fromEntries(HB_KEYS_ORDER.map((k) => [k, ""])) as HbFields;
}
function emptyCma(): CmaFields {
  return Object.fromEntries(
    ASSET_KEYS_ORDER.map((k) => [k, { expReturn: "", vol: "" }]),
  ) as CmaFields;
}

// Hilfsfunktion: Number -> %-String mit drei Nachkommastellen, falls gesetzt.
function pctStr(n: number | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return (n * 100).toFixed(3);
}
function numStr(n: number | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return String(n);
}

export type ApplyPresetResult = { rf: RfFields; hb: HbFields; cma: CmaFields };

/**
 * Wendet ein Preset auf die aktuelle Editor-Field-State an.
 * Reine Funktion: nimmt Eingang, gibt Ausgang zurueck. Keine Side-Effects.
 *
 * Semantik:
 *   1. Sektionen in `preset.clear` werden auf die jeweils leeren Field-States
 *      gesetzt (alle Felder = "").
 *   2. Werte aus `preset.payload` werden per-key gemerget (nur Felder, die
 *      das Preset erwaehnt, werden ueberschrieben; alle anderen bleiben
 *      so, wie sie nach Schritt 1 / im Eingang stehen).
 */
export function applyPresetToFields(
  preset: AppDefaultsPreset,
  current: { rf: RfFields; hb: HbFields; cma: CmaFields },
): ApplyPresetResult {
  const clear = new Set<AppDefaultsPresetSection>(preset.clear ?? []);

  // Phase 1: Clear
  const rf: RfFields = clear.has("rf") ? emptyRf() : { ...current.rf };
  const hb: HbFields = clear.has("hb") ? emptyHb() : { ...current.hb };
  const cma: CmaFields = clear.has("cma")
    ? emptyCma()
    : Object.fromEntries(
        ASSET_KEYS_ORDER.map((k) => [k, { ...current.cma[k] }]),
      ) as CmaFields;

  // Phase 2: Per-key merge
  const p = preset.payload;
  if (p?.riskFreeRates) {
    for (const k of RF_KEYS_ORDER) {
      const s = pctStr(p.riskFreeRates[k]);
      if (s !== null) rf[k] = s;
    }
  }
  if (p?.homeBias) {
    for (const k of HB_KEYS_ORDER) {
      const s = numStr(p.homeBias[k]);
      if (s !== null) hb[k] = s;
    }
  }
  if (p?.cma) {
    for (const k of ASSET_KEYS_ORDER) {
      const entry = p.cma[k];
      if (!entry) continue;
      const muS = pctStr(entry.expReturn);
      const sgS = pctStr(entry.vol);
      // Per-key-merge auch fuer expReturn / vol einzeln: ein Preset-Eintrag
      // mit nur expReturn laesst vol unangetastet (oder leer, falls die
      // Sektion in clear war und der Operator vol noch nicht gefuellt hat).
      if (muS !== null) cma[k] = { ...cma[k], expReturn: muS };
      if (sgS !== null) cma[k] = { ...cma[k], vol: sgS };
    }
  }

  return { rf, hb, cma };
}
