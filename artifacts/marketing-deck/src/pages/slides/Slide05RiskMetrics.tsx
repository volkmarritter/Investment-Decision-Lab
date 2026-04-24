export default function Slide05RiskMetrics() {
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
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>What It Does</div>
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Quick Start</div>
        </div>

        <div style={{ fontSize: "0.9vw", fontWeight: 600, color: "#565F89", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "2vh" }}>
          Capabilities
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5vh" }}>
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Implementation</div>
          <div style={{ fontSize: "1vw", color: "#7AA2F7", fontWeight: 500, display: "flex", alignItems: "center", gap: "0.5vw" }}>
            <span style={{ width: "4px", height: "1.2vw", backgroundColor: "#7AA2F7", borderRadius: "2px", marginLeft: "-3vw" }} />
            Risk Metrics
          </div>
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
          Risk Metrics
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
          Correlation-aware risk.
        </h1>

        <p
          style={{
            fontSize: "1.3vw",
            color: "#9AA5CE",
            lineHeight: 1.6,
            maxWidth: "48vw",
            margin: "0 0 4vh 0",
            fontWeight: 400,
          }}
        >
          Volatility uses the full covariance matrix — diversification credit
          is computed, not assumed. The same matrix powers VaR, expected
          shortfall and the contribution-to-risk breakdown.
        </p>

        <div style={{ display: "flex", gap: "3vw", alignItems: "stretch" }}>
          <div style={{ flex: 1.1, display: "flex", flexDirection: "column", gap: "2vh" }}>
            <div style={{ fontSize: "1.1vw", fontWeight: 600, color: "#FFFFFF", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", paddingBottom: "1vh" }}>
              Portfolio volatility
            </div>
            <div
              style={{
                backgroundColor: "#16161E",
                borderRadius: "0.5vw",
                padding: "3vh 2vw",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                fontFamily: "'DM Mono', monospace",
                fontSize: "1.4vw",
                lineHeight: 1.6,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.5)",
                color: "#C0CAF5",
              }}
            >
              <div>
                <span style={{ color: "#7AA2F7" }}>σ</span>
                <span style={{ color: "#9AA5CE", fontSize: "0.95vw" }}>p</span>
                {" = √( "}
                <span style={{ color: "#E0AF68" }}>w</span>
                <span style={{ color: "#9AA5CE", fontSize: "0.95vw" }}>ᵀ</span>
                {" · "}
                <span style={{ color: "#9ECE6A" }}>Σ</span>
                {" · "}
                <span style={{ color: "#E0AF68" }}>w</span>
                {" )"}
              </div>
              <div style={{ marginTop: "2.5vh", fontSize: "0.95vw", color: "#565F89", lineHeight: 1.6 }}>
                <span style={{ color: "#E0AF68" }}>w</span> · weight vector
                <br />
                <span style={{ color: "#9ECE6A" }}>Σ</span> · 9×9 covariance matrix
                <br />
                <span style={{ color: "#7AA2F7" }}>σ</span>
                <span style={{ fontSize: "0.85vw" }}>p</span> · portfolio standard deviation
              </div>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2vh" }}>
            <div style={{ fontSize: "1.1vw", fontWeight: 600, color: "#FFFFFF", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", paddingBottom: "1vh" }}>
              What you see
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.6vh" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "1vw", padding: "1.6vh 1.4vw", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: "0.5vw", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ width: "0.6vw", height: "0.6vw", backgroundColor: "#7AA2F7", borderRadius: "50%", marginTop: "0.6vh", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: "1.05vw", color: "#FFFFFF", fontWeight: 600 }}>Annualised vol &amp; Sharpe</div>
                  <div style={{ fontSize: "0.95vw", color: "#9AA5CE" }}>Closed-form, recomputed on every weight change.</div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "flex-start", gap: "1vw", padding: "1.6vh 1.4vw", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: "0.5vw", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ width: "0.6vw", height: "0.6vw", backgroundColor: "#9ECE6A", borderRadius: "50%", marginTop: "0.6vh", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: "1.05vw", color: "#FFFFFF", fontWeight: 600 }}>VaR &amp; ES at 95% / 99%</div>
                  <div style={{ fontSize: "0.95vw", color: "#9AA5CE" }}>Parametric and historical, side by side.</div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "flex-start", gap: "1vw", padding: "1.6vh 1.4vw", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: "0.5vw", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ width: "0.6vw", height: "0.6vw", backgroundColor: "#E0AF68", borderRadius: "50%", marginTop: "0.6vh", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: "1.05vw", color: "#FFFFFF", fontWeight: 600 }}>Risk contribution per asset</div>
                  <div style={{ fontSize: "0.95vw", color: "#9AA5CE" }}>Marginal contribution to vol, summed to 100%.</div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "flex-start", gap: "1vw", padding: "1.6vh 1.4vw", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: "0.5vw", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ width: "0.6vw", height: "0.6vw", backgroundColor: "#FF9E64", borderRadius: "50%", marginTop: "0.6vh", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: "1.05vw", color: "#FFFFFF", fontWeight: 600 }}>9×9 correlation matrix</div>
                  <div style={{ fontSize: "0.95vw", color: "#9AA5CE" }}>Editable. Every override flows through every metric.</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ fontSize: "1vw", color: "#565F89", fontWeight: 500 }}>05</div>
          <div style={{ fontSize: "0.9vw", color: "#565F89" }}>Investment Decision Lab</div>
        </div>
      </div>
    </div>
  );
}
