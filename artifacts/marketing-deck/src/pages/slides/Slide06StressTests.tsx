export default function Slide06StressTests() {
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
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Risk Metrics</div>
          <div style={{ fontSize: "1vw", color: "#7AA2F7", fontWeight: 500, display: "flex", alignItems: "center", gap: "0.5vw" }}>
            <span style={{ width: "4px", height: "1.2vw", backgroundColor: "#7AA2F7", borderRadius: "2px", marginLeft: "-3vw" }} />
            Stress Tests
          </div>
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
          Stress Tests
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
          Six crises and a Monte Carlo, one click.
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
          Six historical crisis windows applied to the live portfolio, plus a
          10,000-path Monte Carlo simulation across configurable horizons.
          Both update as you edit the weights.
        </p>

        <div style={{ display: "flex", gap: "3vw", alignItems: "stretch" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2vh" }}>
            <div style={{ fontSize: "1.1vw", fontWeight: 600, color: "#FFFFFF", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", paddingBottom: "1vh" }}>
              Historical scenarios
            </div>
            <div
              style={{
                backgroundColor: "#16161E",
                borderRadius: "0.5vw",
                padding: "2vh 1.6vw",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                fontFamily: "'DM Mono', monospace",
                fontSize: "0.95vw",
                lineHeight: 1.9,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>GFC <span style={{ color: "#565F89" }}>2008–09</span></span>
                <span style={{ color: "#FF9E64" }}>−28.4%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>EU debt crisis <span style={{ color: "#565F89" }}>2011</span></span>
                <span style={{ color: "#FF9E64" }}>−12.1%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>China devaluation <span style={{ color: "#565F89" }}>2015</span></span>
                <span style={{ color: "#FF9E64" }}>−7.8%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>Q4 selloff <span style={{ color: "#565F89" }}>2018</span></span>
                <span style={{ color: "#FF9E64" }}>−9.2%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>COVID crash <span style={{ color: "#565F89" }}>Feb–Mar 2020</span></span>
                <span style={{ color: "#FF9E64" }}>−18.6%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>Rates shock <span style={{ color: "#565F89" }}>2022</span></span>
                <span style={{ color: "#FF9E64" }}>−14.3%</span>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2vh" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", paddingBottom: "1vh" }}>
              <div style={{ fontSize: "1.1vw", fontWeight: 600, color: "#FFFFFF" }}>Monte Carlo · 10y</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5vw" }}>
                <div style={{ width: "0.6vw", height: "0.6vw", backgroundColor: "#9ECE6A", borderRadius: "50%" }} />
                <div style={{ fontSize: "0.85vw", fontFamily: "'DM Mono', monospace", color: "#9ECE6A" }}>10,000 paths</div>
              </div>
            </div>
            <div
              style={{
                backgroundColor: "#16161E",
                borderRadius: "0.5vw",
                padding: "2vh 1.6vw",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                fontFamily: "'DM Mono', monospace",
                fontSize: "0.95vw",
                lineHeight: 1.6,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{ color: "#C0CAF5" }}>{"{"}</div>
              <div style={{ paddingLeft: "1.5vw" }}>
                <span style={{ color: "#7AA2F7" }}>"p05"</span>: <span style={{ color: "#FF9E64" }}>−14.2%</span>,
              </div>
              <div style={{ paddingLeft: "1.5vw" }}>
                <span style={{ color: "#7AA2F7" }}>"p25"</span>: <span style={{ color: "#FF9E64" }}>+18.4%</span>,
              </div>
              <div style={{ paddingLeft: "1.5vw" }}>
                <span style={{ color: "#7AA2F7" }}>"p50"</span>: <span style={{ color: "#FF9E64" }}>+62.1%</span>,
              </div>
              <div style={{ paddingLeft: "1.5vw" }}>
                <span style={{ color: "#7AA2F7" }}>"p75"</span>: <span style={{ color: "#FF9E64" }}>+118.7%</span>,
              </div>
              <div style={{ paddingLeft: "1.5vw" }}>
                <span style={{ color: "#7AA2F7" }}>"p95"</span>: <span style={{ color: "#FF9E64" }}>+214.0%</span>,
              </div>
              <div style={{ paddingLeft: "1.5vw" }}>
                <span style={{ color: "#7AA2F7" }}>"p_loss"</span>: <span style={{ color: "#9ECE6A" }}>0.16</span>
              </div>
              <div style={{ color: "#C0CAF5" }}>{"}"}</div>
            </div>
            <div style={{ fontSize: "0.85vw", color: "#565F89", lineHeight: 1.5 }}>
              Block bootstrap on weekly returns since 2007. Distribution
              percentiles, not point forecasts.
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ fontSize: "1vw", color: "#565F89", fontWeight: 500 }}>06</div>
          <div style={{ fontSize: "0.9vw", color: "#565F89" }}>Investment Decision Lab</div>
        </div>
      </div>
    </div>
  );
}
