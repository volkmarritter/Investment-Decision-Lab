import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type Lang = "en" | "de";

export const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  en: {
    "header.title": "Investment Decision Lab",
    "header.tagline": "Professional portfolio construction & analysis",
    "tab.build": "Build Portfolio",
    "tab.compare": "Compare Portfolios",
    "tab.explain": "Explain My Portfolio",
    
    // BuildPortfolio
    "build.params.title": "Portfolio Parameters",
    "build.params.desc": "Define your constraints and preferences.",
    "build.baseCurrency.label": "Base Currency",
    "build.baseCurrency.tooltip": "Your primary currency for measuring returns.",
    "build.horizon.label": "Horizon (Years)",
    "build.horizon.tooltip": "How long before you need to withdraw funds.",
    "build.riskAppetite.label": "Risk Appetite",
    "build.riskAppetite.tooltip": "Your tolerance for portfolio drawdowns.",
    "build.targetEquity.label": "Target Equity Allocation",
    "build.targetEquity.tooltip": "Percentage of portfolio allocated to stocks.",
    "build.numEtfs.label": "Number of ETFs",
    "build.numEtfs.tooltip": "Target number of ETFs to use (3-15).",
    "build.preferredExchange.label": "Preferred Exchange",
    "build.preferredExchange.tooltip": "Filter ETFs by exchange listings where possible.",
    "build.thematicTilt.label": "Thematic Tilt (Optional)",
    "build.thematicTilt.tooltip": "Add a small satellite allocation to a specific theme.",
    "build.currencyHedging.label": "Currency Hedging",
    "build.currencyHedging.desc": "Hedge foreign exposure",
    "build.crypto.label": "Include Crypto",
    "build.crypto.desc": "Add a small digital asset allocation",
    "build.realEstate.label": "Listed Real Estate",
    "build.realEstate.desc": "Add a REIT allocation",
    "build.btn.generate": "Generate Portfolio",
    "build.results.title": "Portfolio Results",
    "build.btn.exportPdf": "Export PDF",
    "build.btn.exportingPdf": "Generating PDF...",
    "build.pdf.success": "PDF exported successfully",
    "build.pdf.error": "Failed to export PDF",
    "build.empty.title": "Ready to Build",
    "build.empty.desc": "Configure your preferences on the left and generate a portfolio to see the detailed breakdown, rationales, and ETF implementation.",
    "build.val.errors": "Validation Errors",
    "build.val.warnings": "Portfolio Warnings",
    "build.val.valid.title": "Inputs Validated",
    "build.val.valid.desc": "Your inputs pass all structural coherence checks.",
    "build.summary.title": "Investor Profile Summary",
    "build.summary.currency": "Currency:",
    "build.summary.risk": "Risk:",
    "build.summary.horizon": "Horizon:",
    "build.summary.targetEquity": "Target Equity:",
    "build.summary.etfs": "ETFs",
    "build.targetAllocation.title": "Target Asset Allocation",
    "build.targetAllocation.desc": "Optimized exposure mapping",
    "build.rationale.title": "Construction Rationale",
    "build.rationale.desc": "Why this portfolio is built this way",
    "build.risks.title": "Key Risks to Monitor",
    "build.risks.desc": "What could go wrong with this allocation",
    "build.learning.title": "Learning Insights",
    "build.learning.desc": "Educational notes on these constraints",
    "build.implementation.title": "ETF Implementation",
    "build.implementation.desc": "Example instruments to execute this allocation",

    // ExplainPortfolio
    "explain.current.title": "Current Portfolio",
    "explain.current.desc": "Input your existing holdings to test for coherence.",
    "explain.riskProfile.label": "Stated Risk Profile",
    "explain.positions.label": "Positions",
    "explain.btn.template": "Template",
    "explain.btn.importCsv": "Import CSV",
    "explain.btn.addRow": "Add Row",
    "explain.table.assetClass": "Asset Class",
    "explain.table.region": "Region/Detail",
    "explain.table.weight": "Weight %",
    "explain.btn.analyze": "Analyze Portfolio",
    "explain.diagnosis.title": "Diagnosis:",
    "explain.diagnosis.desc": "Portfolio structural check",
    "explain.totalAllocation": "Total Allocation",
    "explain.valid": "Valid",
    "explain.criticalIssues": "Critical Issues",
    "explain.findings": "Findings",
    "explain.coherent.msg": "This portfolio appears structurally sound. It adds up to 100%, avoids excessive single-region concentration, maintains defensive assets, and matches your stated risk profile.",
    "explain.empty.title": "Awaiting Input",
    "explain.empty.desc": "Enter your positions on the left to scan for concentration risks, missing diversifiers, and alignment with your risk profile.",
    "explain.toast.imported": "Imported {count} positions",

    // ComparePortfolios
    "compare.portA": "Portfolio A",
    "compare.portB": "Portfolio B",
    "compare.btn": "Compare Portfolios",
    "compare.empty.title": "Configure and Compare",
    "compare.empty.desc": "Setup both portfolios above and compare their structural allocation differences side by side.",
    "compare.val.errA": "Portfolio A Errors",
    "compare.val.warnA": "Portfolio A Warnings ({count})",
    "compare.val.validA": "Portfolio A Valid",
    "compare.val.errB": "Portfolio B Errors",
    "compare.val.warnB": "Portfolio B Warnings ({count})",
    "compare.val.validB": "Portfolio B Valid",
    "compare.diff.title": "Structural Differences",
    "compare.diff.desc": "Direct allocation delta between A and B",
    "compare.table.assetClass": "Asset Class / Region",
    "compare.table.portA": "Portfolio A %",
    "compare.table.portB": "Portfolio B %",
    "compare.table.delta": "Δ (B - A)",
    "compare.allocA.title": "Portfolio A Allocation",
    "compare.allocB.title": "Portfolio B Allocation",

    // StressTest
    "stress.title": "Scenario Stress Test",
    "stress.desc": "Deterministic historical-style shocks applied to the current allocation. Illustrative, not a forecast.",
    "stress.topDrivers": "Top Drivers",
    "stress.chart.tooltip": "Portfolio Return",

    // FeeEstimator
    "fee.title": "Fee Estimator",
    "fee.desc": "Blended ETF cost and projected drag over the investment horizon. Illustrative TERs.",
    "fee.investmentAmount": "Investment Amount",
    "fee.blendedTer": "Blended TER",
    "fee.annualFee": "Annual Fee",
    "fee.projectedDrag": "Projected Drag",
    "fee.perYr": "/ yr",
    "fee.ofFinalValue": "of final value",
    "fee.table.bucket": "Bucket",
    "fee.table.weight": "Weight",
    "fee.table.ter": "TER (bps)",
    "fee.table.contribution": "Contribution (bps)",
    "fee.disclaimer": "Illustrative only. Real ETF TERs vary; trading, FX, and platform costs are not included.",
    "fee.chart.afterFees": "After Fees",
    "fee.chart.zeroFee": "Zero Fee Baseline",

    // SavedScenariosUI
    "saved.btn.save": "Save Scenario",
    "saved.btn.saved": "Saved ({count})",
    "saved.save.title": "Save Scenario",
    "saved.save.desc": "Save your current portfolio configuration to revisit later.",
    "saved.save.placeholder": "Scenario Name",
    "saved.save.cancel": "Cancel",
    "saved.save.submit": "Save",
    "saved.list.title": "Saved Scenarios",
    "saved.list.desc": "Load or manage your saved portfolio configurations.",
    "saved.empty.title": "No saved scenarios yet.",
    "saved.empty.desc": "Generate a portfolio and click Save Scenario.",
    "saved.delete.title": "Delete Scenario?",
    "saved.delete.desc": "This will permanently delete the scenario \"{name}\".",
    "saved.delete.cancel": "Cancel",
    "saved.delete.submit": "Delete",
    "saved.toast.saved": "Scenario saved",
    "saved.toast.renamed": "Scenario renamed",
    "saved.toast.deleted": "Scenario deleted",

    // ImportCsvDialog
    "import.title": "Import positions from CSV",
    "import.desc": "Upload a CSV file or paste the text below. Requires \"Asset Class\", \"Region\", and \"Weight\" columns.",
    "import.tab.paste": "Paste CSV",
    "import.tab.upload": "Upload file",
    "import.upload.btn": "Select CSV File",
    "import.upload.desc": "Accepts .csv or .txt files",
    "import.status.success": "{count} row(s) parsed successfully",
    "import.errors": "Errors (Blocking)",
    "import.warnings": "Warnings (Non-blocking)",
    "import.btn.cancel": "Cancel",
    "import.btn.append": "Import (append)",
    "import.btn.replace": "Import (replace)",

    // ThemeToggle
    "theme.toggle": "Toggle theme",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "theme.system": "System",

    // Disclaimer
    "disclaimer.short.title": "Important notice.",
    "disclaimer.short.body": "This tool is provided for educational and illustrative purposes only and does not constitute investment, legal, or tax advice. All outputs are model results based on user inputs and simplified assumptions, not recommendations to buy, sell, or hold any security.",
    "disclaimer.readFull": "Read full disclaimer",
    "disclaimer.full.title": "Important Disclaimer & Risk Warning",
    "disclaimer.full.subtitle": "Please read this disclaimer carefully before relying on any output of the Investment Decision Lab.",
    "disclaimer.s1.title": "No Investment Advice",
    "disclaimer.s1.body": "The information, allocations, ETF examples, rationales, scenarios, and any other content generated by this tool are provided strictly for general informational and educational purposes. They do not constitute investment advice, a personal recommendation, an offer or solicitation to buy or sell any financial instrument, nor a suitability or appropriateness assessment within the meaning of MiFID II, FIDLEG/FinSA, or any other applicable regulation.",
    "disclaimer.s2.title": "Illustrative & Deterministic Outputs",
    "disclaimer.s2.body": "All allocations, fee estimates, stress-test impacts, and example ETFs are produced by a deterministic rule-based engine using simplified assumptions and illustrative parameters (e.g. assumed TERs, hypothetical historical-style shocks). They are not forecasts, not based on live market data, and should not be interpreted as projections of actual future performance.",
    "disclaimer.s3.title": "Risk of Loss & Past Performance",
    "disclaimer.s3.body": "All investments involve risk, including the possible loss of the entire principal. Past performance and historical scenarios are not reliable indicators of future results. Equity, bond, commodity, real-estate, and digital-asset markets can experience severe and prolonged drawdowns. Currency movements can materially affect returns for non-base-currency exposures.",
    "disclaimer.s4.title": "No Personalized Advice or Fiduciary Relationship",
    "disclaimer.s4.body": "This tool does not know your full financial situation, objectives, liquidity needs, tax position, regulatory status, or capacity for loss. No fiduciary, advisory, or client relationship is created by your use of this tool. You remain solely responsible for any investment decision you make.",
    "disclaimer.s5.title": "Tax & Legal Considerations",
    "disclaimer.s5.body": "Tax treatment depends on your individual circumstances and jurisdiction and may change. Certain instruments (including UCITS ETFs, US-domiciled ETFs, crypto assets, and derivatives) may not be available, suitable, or legally distributable to all investors. Always consult a qualified tax and legal adviser before acting.",
    "disclaimer.s6.title": "Third-Party Instruments",
    "disclaimer.s6.body": "Any ETF tickers, issuers, or product names shown are examples only and are not endorsements. We do not guarantee the accuracy, completeness, or current availability of any instrument. Always read the relevant Key Information Document (KID/KIID), prospectus, and factsheet before investing.",
    "disclaimer.s7.title": "Seek Professional Advice",
    "disclaimer.s7.body": "Before making any investment decision, you should obtain independent financial, tax, and legal advice from a duly licensed professional who can take your personal circumstances into account. By using this tool you acknowledge and accept the limitations described above and agree that the operators and authors disclaim, to the fullest extent permitted by law, any liability for losses arising from reliance on its output."
  },
  de: {
    "header.title": "Investment Decision Lab",
    "header.tagline": "Professionelle Portfoliokonstruktion & Analyse",
    "tab.build": "Portfolio Erstellen",
    "tab.compare": "Portfolios Vergleichen",
    "tab.explain": "Portfolio Erklären",
    
    // BuildPortfolio
    "build.params.title": "Portfolio-Parameter",
    "build.params.desc": "Definieren Sie Ihre Einschränkungen und Präferenzen.",
    "build.baseCurrency.label": "Basiswährung",
    "build.baseCurrency.tooltip": "Ihre Hauptwährung zur Messung der Rendite.",
    "build.horizon.label": "Anlagehorizont (Jahre)",
    "build.horizon.tooltip": "Wie lange, bevor Sie Mittel entnehmen müssen.",
    "build.riskAppetite.label": "Risikoneigung",
    "build.riskAppetite.tooltip": "Ihre Toleranz für Portfolio-Drawdowns.",
    "build.targetEquity.label": "Ziel-Aktienquote",
    "build.targetEquity.tooltip": "Prozentualer Anteil des Portfolios, der in Aktien investiert wird.",
    "build.numEtfs.label": "Anzahl der ETFs",
    "build.numEtfs.tooltip": "Zielanzahl der zu verwendenden ETFs (3-15).",
    "build.preferredExchange.label": "Bevorzugte Börse",
    "build.preferredExchange.tooltip": "ETFs nach Möglichkeit nach Börsenzulassungen filtern.",
    "build.thematicTilt.label": "Thematische Ausrichtung (Optional)",
    "build.thematicTilt.tooltip": "Fügen Sie eine kleine Satelliten-Allokation für ein bestimmtes Thema hinzu.",
    "build.currencyHedging.label": "Währungsabsicherung",
    "build.currencyHedging.desc": "Fremdwährungsrisiko absichern",
    "build.crypto.label": "Krypto Einschließen",
    "build.crypto.desc": "Fügen Sie eine kleine Allokation in digitale Vermögenswerte hinzu",
    "build.realEstate.label": "Börsennotierte Immobilien",
    "build.realEstate.desc": "Fügen Sie eine REIT-Allokation hinzu",
    "build.btn.generate": "Portfolio Generieren",
    "build.results.title": "Portfolio-Ergebnisse",
    "build.btn.exportPdf": "PDF Exportieren",
    "build.btn.exportingPdf": "PDF wird generiert...",
    "build.pdf.success": "PDF erfolgreich exportiert",
    "build.pdf.error": "Fehler beim Exportieren des PDFs",
    "build.empty.title": "Bereit zur Erstellung",
    "build.empty.desc": "Konfigurieren Sie Ihre Präferenzen auf der linken Seite und generieren Sie ein Portfolio, um die detaillierte Aufteilung, Begründungen und ETF-Umsetzung zu sehen.",
    "build.val.errors": "Validierungsfehler",
    "build.val.warnings": "Portfolio-Warnungen",
    "build.val.valid.title": "Eingaben Validiert",
    "build.val.valid.desc": "Ihre Eingaben bestehen alle strukturellen Kohärenzprüfungen.",
    "build.summary.title": "Zusammenfassung Anlegerprofil",
    "build.summary.currency": "Währung:",
    "build.summary.risk": "Risiko:",
    "build.summary.horizon": "Horizont:",
    "build.summary.targetEquity": "Ziel-Aktienquote:",
    "build.summary.etfs": "ETFs",
    "build.targetAllocation.title": "Ziel-Asset-Allokation",
    "build.targetAllocation.desc": "Optimierte Expositionszuordnung",
    "build.rationale.title": "Konstruktionsbegründung",
    "build.rationale.desc": "Warum dieses Portfolio so aufgebaut ist",
    "build.risks.title": "Wichtige Risiken",
    "build.risks.desc": "Was bei dieser Allokation schiefgehen könnte",
    "build.learning.title": "Lerneinsichten",
    "build.learning.desc": "Pädagogische Anmerkungen zu diesen Einschränkungen",
    "build.implementation.title": "ETF-Umsetzung",
    "build.implementation.desc": "Beispielinstrumente zur Umsetzung dieser Allokation",

    // ExplainPortfolio
    "explain.current.title": "Aktuelles Portfolio",
    "explain.current.desc": "Geben Sie Ihre bestehenden Bestände ein, um sie auf Kohärenz zu prüfen.",
    "explain.riskProfile.label": "Angegebenes Risikoprofil",
    "explain.positions.label": "Positionen",
    "explain.btn.template": "Vorlage",
    "explain.btn.importCsv": "CSV Importieren",
    "explain.btn.addRow": "Zeile Hinzufügen",
    "explain.table.assetClass": "Anlageklasse",
    "explain.table.region": "Region/Detail",
    "explain.table.weight": "Gewicht %",
    "explain.btn.analyze": "Portfolio Analysieren",
    "explain.diagnosis.title": "Diagnose:",
    "explain.diagnosis.desc": "Struktureller Portfolio-Check",
    "explain.totalAllocation": "Gesamtallokation",
    "explain.valid": "Gültig",
    "explain.criticalIssues": "Kritische Probleme",
    "explain.findings": "Erkenntnisse",
    "explain.coherent.msg": "Dieses Portfolio erscheint strukturell solide. Es summiert sich auf 100%, vermeidet übermäßige Konzentration auf eine Region, behält defensive Anlagen bei und entspricht Ihrem angegebenen Risikoprofil.",
    "explain.empty.title": "Warte auf Eingabe",
    "explain.empty.desc": "Geben Sie Ihre Positionen links ein, um auf Konzentrationsrisiken, fehlende Diversifikatoren und Übereinstimmung mit Ihrem Risikoprofil zu prüfen.",
    "explain.toast.imported": "{count} Positionen importiert",

    // ComparePortfolios
    "compare.portA": "Portfolio A",
    "compare.portB": "Portfolio B",
    "compare.btn": "Portfolios Vergleichen",
    "compare.empty.title": "Konfigurieren und Vergleichen",
    "compare.empty.desc": "Richten Sie beide Portfolios oben ein und vergleichen Sie ihre strukturellen Allokationsunterschiede Seite an Seite.",
    "compare.val.errA": "Portfolio A Fehler",
    "compare.val.warnA": "Portfolio A Warnungen ({count})",
    "compare.val.validA": "Portfolio A Gültig",
    "compare.val.errB": "Portfolio B Fehler",
    "compare.val.warnB": "Portfolio B Warnungen ({count})",
    "compare.val.validB": "Portfolio B Gültig",
    "compare.diff.title": "Strukturelle Unterschiede",
    "compare.diff.desc": "Direktes Allokationsdelta zwischen A und B",
    "compare.table.assetClass": "Anlageklasse / Region",
    "compare.table.portA": "Portfolio A %",
    "compare.table.portB": "Portfolio B %",
    "compare.table.delta": "Δ (B - A)",
    "compare.allocA.title": "Portfolio A Allokation",
    "compare.allocB.title": "Portfolio B Allokation",

    // StressTest
    "stress.title": "Szenario-Stresstest",
    "stress.desc": "Deterministische historische Schocks angewendet auf die aktuelle Allokation. Illustrativ, keine Prognose.",
    "stress.topDrivers": "Haupttreiber",
    "stress.chart.tooltip": "Portfolio-Rendite",

    // FeeEstimator
    "fee.title": "Gebührenschätzer",
    "fee.desc": "Gemischte ETF-Kosten und prognostizierte Belastung über den Anlagehorizont. Illustrative TERs.",
    "fee.investmentAmount": "Anlagebetrag",
    "fee.blendedTer": "Gemischte TER",
    "fee.annualFee": "Jährliche Gebühr",
    "fee.projectedDrag": "Prognostizierte Belastung",
    "fee.perYr": "/ Jahr",
    "fee.ofFinalValue": "des Endwerts",
    "fee.table.bucket": "Bereich",
    "fee.table.weight": "Gewicht",
    "fee.table.ter": "TER (bps)",
    "fee.table.contribution": "Beitrag (bps)",
    "fee.disclaimer": "Nur illustrativ. Tatsächliche ETF-TERs variieren; Handels-, FX- und Plattformkosten sind nicht enthalten.",
    "fee.chart.afterFees": "Nach Gebühren",
    "fee.chart.zeroFee": "Null-Gebühren-Baseline",

    // SavedScenariosUI
    "saved.btn.save": "Szenario Speichern",
    "saved.btn.saved": "Gespeichert ({count})",
    "saved.save.title": "Szenario Speichern",
    "saved.save.desc": "Speichern Sie Ihre aktuelle Portfolio-Konfiguration, um sie später wieder aufzurufen.",
    "saved.save.placeholder": "Szenarioname",
    "saved.save.cancel": "Abbrechen",
    "saved.save.submit": "Speichern",
    "saved.list.title": "Gespeicherte Szenarien",
    "saved.list.desc": "Laden oder verwalten Sie Ihre gespeicherten Portfolio-Konfigurationen.",
    "saved.empty.title": "Noch keine gespeicherten Szenarien.",
    "saved.empty.desc": "Generieren Sie ein Portfolio und klicken Sie auf Szenario Speichern.",
    "saved.delete.title": "Szenario löschen?",
    "saved.delete.desc": "Dies wird das Szenario \"{name}\" dauerhaft löschen.",
    "saved.delete.cancel": "Abbrechen",
    "saved.delete.submit": "Löschen",
    "saved.toast.saved": "Szenario gespeichert",
    "saved.toast.renamed": "Szenario umbenannt",
    "saved.toast.deleted": "Szenario gelöscht",

    // ImportCsvDialog
    "import.title": "Positionen aus CSV importieren",
    "import.desc": "Laden Sie eine CSV-Datei hoch oder fügen Sie den Text unten ein. Erfordert die Spalten \"Asset Class\", \"Region\" und \"Weight\".",
    "import.tab.paste": "CSV Einfügen",
    "import.tab.upload": "Datei Hochladen",
    "import.upload.btn": "CSV-Datei Auswählen",
    "import.upload.desc": "Akzeptiert .csv oder .txt Dateien",
    "import.status.success": "{count} Zeile(n) erfolgreich analysiert",
    "import.errors": "Fehler (Blockierend)",
    "import.warnings": "Warnungen (Nicht blockierend)",
    "import.btn.cancel": "Abbrechen",
    "import.btn.append": "Importieren (anhängen)",
    "import.btn.replace": "Importieren (ersetzen)",

    // ThemeToggle
    "theme.toggle": "Design umschalten",
    "theme.light": "Hell",
    "theme.dark": "Dunkel",
    "theme.system": "System",

    // Disclaimer
    "disclaimer.short.title": "Wichtiger Hinweis.",
    "disclaimer.short.body": "Dieses Tool dient ausschließlich zu Bildungs- und Illustrationszwecken und stellt keine Anlage-, Rechts- oder Steuerberatung dar. Alle Ergebnisse sind Modellresultate auf Basis von Nutzereingaben und vereinfachten Annahmen und stellen keine Empfehlung zum Kauf, Verkauf oder Halten eines Finanzinstruments dar.",
    "disclaimer.readFull": "Vollständigen Hinweis lesen",
    "disclaimer.full.title": "Wichtiger Haftungs- und Risikohinweis",
    "disclaimer.full.subtitle": "Bitte lesen Sie diesen Hinweis sorgfältig, bevor Sie sich auf Ergebnisse des Investment Decision Lab verlassen.",
    "disclaimer.s1.title": "Keine Anlageberatung",
    "disclaimer.s1.body": "Die durch dieses Tool erzeugten Informationen, Allokationen, ETF-Beispiele, Begründungen, Szenarien und sonstigen Inhalte dienen ausschließlich allgemeinen Informations- und Bildungszwecken. Sie stellen weder eine Anlageberatung, eine persönliche Empfehlung, ein Angebot oder eine Aufforderung zum Kauf oder Verkauf eines Finanzinstruments noch eine Eignungs- oder Angemessenheitsprüfung im Sinne von MiFID II, FIDLEG/FinSA oder anderer geltender Vorschriften dar.",
    "disclaimer.s2.title": "Illustrative und deterministische Ergebnisse",
    "disclaimer.s2.body": "Sämtliche Allokationen, Gebührenschätzungen, Stresstest-Effekte und ETF-Beispiele werden durch eine deterministische, regelbasierte Logik mit vereinfachten Annahmen und illustrativen Parametern (z.B. angenommene TERs, hypothetische historisch-ähnliche Schocks) erzeugt. Es handelt sich weder um Prognosen noch um Echtzeit-Marktdaten und sie dürfen nicht als Vorhersage tatsächlicher zukünftiger Wertentwicklungen interpretiert werden.",
    "disclaimer.s3.title": "Verlustrisiko und frühere Wertentwicklung",
    "disclaimer.s3.body": "Alle Anlagen sind mit Risiken verbunden, einschließlich des möglichen vollständigen Kapitalverlusts. Frühere Wertentwicklungen und historische Szenarien sind kein verlässlicher Indikator für künftige Ergebnisse. Aktien-, Anleihen-, Rohstoff-, Immobilien- und Krypto-Märkte können erhebliche und länger anhaltende Verluste erleiden. Wechselkursbewegungen können die Rendite bei Fremdwährungs-Exposure wesentlich beeinflussen.",
    "disclaimer.s4.title": "Keine individuelle Beratung, kein Treuhandverhältnis",
    "disclaimer.s4.body": "Dieses Tool kennt weder Ihre vollständige finanzielle Situation noch Ihre Anlageziele, Liquiditätsbedürfnisse, steuerliche Lage, regulatorische Stellung oder Verlusttragfähigkeit. Durch die Nutzung entsteht kein Treuhand-, Beratungs- oder Mandatsverhältnis. Die Verantwortung für jede Anlageentscheidung liegt allein bei Ihnen.",
    "disclaimer.s5.title": "Steuerliche und rechtliche Aspekte",
    "disclaimer.s5.body": "Die steuerliche Behandlung hängt von Ihren persönlichen Umständen und Ihrer Jurisdiktion ab und kann sich ändern. Bestimmte Instrumente (einschließlich UCITS-ETFs, in den USA aufgelegten ETFs, Krypto-Assets und Derivaten) sind möglicherweise nicht für alle Anleger verfügbar, geeignet oder rechtlich vertreibbar. Konsultieren Sie vor jedem Handeln einen qualifizierten Steuer- und Rechtsberater.",
    "disclaimer.s6.title": "Drittanbieter-Instrumente",
    "disclaimer.s6.body": "Genannte ETF-Ticker, Emittenten oder Produktnamen sind reine Beispiele und keine Empfehlungen. Wir übernehmen keine Gewähr für die Richtigkeit, Vollständigkeit oder aktuelle Verfügbarkeit eines Instruments. Lesen Sie vor einer Anlage stets das jeweilige Basisinformationsblatt (KID/KIID), den Prospekt und das Factsheet.",
    "disclaimer.s7.title": "Holen Sie professionellen Rat ein",
    "disclaimer.s7.body": "Vor jeder Anlageentscheidung sollten Sie unabhängige Finanz-, Steuer- und Rechtsberatung von einer ordnungsgemäß zugelassenen Fachperson einholen, die Ihre persönlichen Umstände berücksichtigt. Durch die Nutzung dieses Tools erkennen Sie die oben genannten Einschränkungen an und akzeptieren, dass die Betreiber und Autoren – soweit gesetzlich zulässig – jegliche Haftung für Verluste aus der Verwendung der Ergebnisse ausschließen."
  }
};

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let str = TRANSLATIONS[lang]?.[key] || TRANSLATIONS["en"][key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

type LanguageContextType = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = "investment-lab.lang.v1";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Lang;
      if (stored === "en" || stored === "de") return stored;
    } catch {}
    
    if (typeof navigator !== "undefined" && navigator.language.startsWith("de")) {
      return "de";
    }
    return "en";
  });

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch {}
  };

  const translate = (key: string, vars?: Record<string, string | number>) => {
    return t(lang, key, vars);
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: translate }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useT() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useT must be used within a LanguageProvider");
  }
  return context;
}
