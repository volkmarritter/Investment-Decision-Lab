export default function Slide03QuickStart() {
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
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>The Problem</div>
          <div style={{ fontSize: "1vw", color: "#7AA2F7", fontWeight: 500, display: "flex", alignItems: "center", gap: "0.5vw" }}>
            <span style={{ width: "4px", height: "1.2vw", backgroundColor: "#7AA2F7", borderRadius: "2px", marginLeft: "-3vw" }} />
            Quick Start
          </div>
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
          Quick Start
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
          From risk score to ISIN.
        </h1>

        <p
          style={{
            fontSize: "1.35vw",
            color: "#9AA5CE",
            lineHeight: 1.6,
            maxWidth: "48vw",
            margin: "0 0 4.5vh 0",
            fontWeight: 400,
          }}
        >
          Three steps. Strategic allocation across nine asset classes, each
          mapped to a real UCITS ETF you can place a ticket against today.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "3.2vh", width: "100%", maxWidth: "55vw" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "2vw" }}>
            <div style={{ width: "3vw", height: "3vw", borderRadius: "50%", backgroundColor: "rgba(122, 162, 247, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#7AA2F7", fontSize: "1.2vw", fontWeight: "bold", flexShrink: 0 }}>1</div>
            <div>
              <div style={{ fontSize: "1.35vw", color: "#FFFFFF", fontWeight: 600, marginBottom: "0.8vh" }}>Set the profile</div>
              <div style={{ fontSize: "1.05vw", color: "#9AA5CE", lineHeight: 1.5 }}>
                Risk score 1–7, horizon, base currency, optional constraints (ESG, EM cap, alternatives).
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: "2vw" }}>
            <div style={{ width: "3vw", height: "3vw", borderRadius: "50%", backgroundColor: "rgba(158, 206, 106, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ECE6A", fontSize: "1.2vw", fontWeight: "bold", flexShrink: 0 }}>2</div>
            <div style={{ width: "100%" }}>
              <div style={{ fontSize: "1.35vw", color: "#FFFFFF", fontWeight: 600, marginBottom: "0.8vh" }}>Receive the allocation</div>
              <div style={{ fontSize: "1.05vw", color: "#9AA5CE", lineHeight: 1.5, marginBottom: "1.6vh" }}>
                Strategic weights across DM equity, EM equity, EUR govt &amp; IG, EUR HY, USD govt, gold and crypto.
              </div>
              <div
                style={{
                  backgroundColor: "#16161E",
                  borderRadius: "0.5vw",
                  padding: "1.6vh 1.6vw",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  fontFamily: "'DM Mono', monospace",
                  fontSize: "0.95vw",
                  lineHeight: 1.6,
                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.5)",
                }}
              >
                <div style={{ color: "#C0CAF5" }}>
                  equity_dm=<span style={{ color: "#FF9E64" }}>0.42</span> · equity_em=<span style={{ color: "#FF9E64" }}>0.10</span> · govt_eur=<span style={{ color: "#FF9E64" }}>0.18</span> · gold=<span style={{ color: "#FF9E64" }}>0.05</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: "2vw" }}>
            <div style={{ width: "3vw", height: "3vw", borderRadius: "50%", backgroundColor: "rgba(224, 175, 104, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#E0AF68", fontSize: "1.2vw", fontWeight: "bold", flexShrink: 0 }}>3</div>
            <div>
              <div style={{ fontSize: "1.35vw", color: "#FFFFFF", fontWeight: 600, marginBottom: "0.8vh" }}>Get the ticket</div>
              <div style={{ fontSize: "1.05vw", color: "#9AA5CE", lineHeight: 1.5 }}>
                Each weight resolves to a named ETF — <span style={{ fontFamily: "'DM Mono', monospace", color: "#FF9E64", backgroundColor: "rgba(255, 158, 100, 0.1)", padding: "0.2vh 0.5vw", borderRadius: "0.2vw" }}>IE00B4L5Y983</span>, ticker, TER, replication method, currency.
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ fontSize: "1vw", color: "#565F89", fontWeight: 500 }}>03</div>
          <div style={{ fontSize: "0.9vw", color: "#565F89" }}>Investment Decision Lab</div>
        </div>
      </div>
    </div>
  );
}
