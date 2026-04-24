export default function Slide02Problem() {
  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{
        backgroundColor: "#1A1B26",
        fontFamily: "'Inter', sans-serif",
        display: "flex",
        color: "#C0CAF5",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: "22vw",
          height: "100vh",
          borderRight: "1px solid rgba(255, 255, 255, 0.05)",
          padding: "5vh 3vw",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1vw", marginBottom: "6vh" }}>
          <div style={{ width: "1.5vw", height: "1.5vw", backgroundColor: "#7AA2F7", borderRadius: "0.3vw" }} />
          <div style={{ fontSize: "1.2vw", fontWeight: 600, color: "#FFFFFF" }}>investment-lab</div>
        </div>

        <div style={{ fontSize: "0.9vw", fontWeight: 600, color: "#565F89", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "2vh" }}>
          Getting Started
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5vh", marginBottom: "4vh" }}>
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Overview</div>
          <div style={{ fontSize: "1vw", color: "#7AA2F7", fontWeight: 500, display: "flex", alignItems: "center", gap: "0.5vw" }}>
            <span style={{ width: "4px", height: "1.2vw", backgroundColor: "#7AA2F7", borderRadius: "2px", marginLeft: "-3vw" }} />
            What It Does
          </div>
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Quick Start</div>
        </div>

        <div style={{ fontSize: "0.9vw", fontWeight: 600, color: "#565F89", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "2vh" }}>
          Capabilities
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5vh" }}>
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Implementation</div>
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Risk Metrics</div>
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Stress Tests</div>
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Look-Through</div>
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Methodology</div>
        </div>

        <div style={{ marginTop: "auto", fontSize: "0.8vw", color: "#565F89" }}>
          v1.0 • 2026
        </div>
      </div>

      {/* Main */}
      <div
        style={{
          flex: 1,
          padding: "8vh 6vw",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        <div style={{ fontSize: "1vw", color: "#7AA2F7", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, marginBottom: "2vh" }}>
          What It Does
        </div>

        <h1
          style={{
            fontSize: "4.2vw",
            fontWeight: 700,
            color: "#FFFFFF",
            margin: "0 0 2vh 0",
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
          }}
        >
          Allocate. Implement. Defend.
        </h1>

        <p
          style={{
            fontSize: "1.3vw",
            color: "#9AA5CE",
            lineHeight: 1.6,
            maxWidth: "50vw",
            margin: "0 0 5vh 0",
            fontWeight: 400,
          }}
        >
          Three jobs that usually live in three different tools — the
          optimiser, the spreadsheet, the dashboard. The Investment Decision
          Lab does all three, in one browser tab, with output a trader and a
          compliance officer can both work from.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "3.2vh", width: "100%", maxWidth: "60vw" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "2vw" }}>
            <div style={{ width: "3vw", height: "3vw", borderRadius: "50%", backgroundColor: "rgba(122, 162, 247, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#7AA2F7", fontSize: "1.2vw", fontWeight: "bold", flexShrink: 0 }}>1</div>
            <div>
              <div style={{ fontSize: "1.4vw", color: "#FFFFFF", fontWeight: 600, marginBottom: "0.8vh" }}>Allocate</div>
              <div style={{ fontSize: "1.05vw", color: "#9AA5CE", lineHeight: 1.5 }}>
                A risk score (1–7), a time horizon and a base currency become weights across nine asset classes — DM &amp; EM equity, EUR govt / IG / HY, USD govt / IG, gold and crypto.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: "2vw" }}>
            <div style={{ width: "3vw", height: "3vw", borderRadius: "50%", backgroundColor: "rgba(158, 206, 106, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ECE6A", fontSize: "1.2vw", fontWeight: "bold", flexShrink: 0 }}>2</div>
            <div>
              <div style={{ fontSize: "1.4vw", color: "#FFFFFF", fontWeight: 600, marginBottom: "0.8vh" }}>Implement</div>
              <div style={{ fontSize: "1.05vw", color: "#9AA5CE", lineHeight: 1.5 }}>
                Each weight resolves to a real UCITS ETF — ISIN, ticker, TER, currency, replication method. 16 hand-curated funds from iShares, SPDR, Invesco, UBS and CoinShares. Copy-paste into any execution platform.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: "2vw" }}>
            <div style={{ width: "3vw", height: "3vw", borderRadius: "50%", backgroundColor: "rgba(224, 175, 104, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#E0AF68", fontSize: "1.2vw", fontWeight: "bold", flexShrink: 0 }}>3</div>
            <div>
              <div style={{ fontSize: "1.4vw", color: "#FFFFFF", fontWeight: 600, marginBottom: "0.8vh" }}>Defend</div>
              <div style={{ fontSize: "1.05vw", color: "#9AA5CE", lineHeight: 1.5 }}>
                Vol, Sharpe, VaR / ES, six historical crisis windows, 10,000-path Monte Carlo and look-through to ~3,000 underlyings — every number live, every formula on screen.
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ fontSize: "1vw", color: "#565F89", fontWeight: 500 }}>02</div>
          <div style={{ fontSize: "0.9vw", color: "#565F89" }}>Investment Decision Lab</div>
        </div>
      </div>
    </div>
  );
}
