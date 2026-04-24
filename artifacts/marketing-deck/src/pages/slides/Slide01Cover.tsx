export default function Slide01Cover() {
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
          <div style={{ fontSize: "1vw", color: "#7AA2F7", fontWeight: 500, display: "flex", alignItems: "center", gap: "0.5vw" }}>
            <span style={{ width: "4px", height: "1.2vw", backgroundColor: "#7AA2F7", borderRadius: "2px", marginLeft: "-3vw" }} />
            Overview
          </div>
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>What It Does</div>
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
          Investment Workspace · 2026
        </div>

        <h1
          style={{
            fontSize: "4.5vw",
            fontWeight: 700,
            color: "#FFFFFF",
            margin: "0 0 2vh 0",
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
          }}
        >
          Investment Decision Lab
        </h1>

        <p
          style={{
            fontSize: "1.4vw",
            color: "#9AA5CE",
            lineHeight: 1.6,
            maxWidth: "44vw",
            margin: "0 0 5vh 0",
            fontWeight: 400,
          }}
        >
          A workspace for building, stress-testing and documenting an
          investable portfolio — from risk profile to real ISIN.
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "2vh 2vw",
            backgroundColor: "rgba(158, 206, 106, 0.1)",
            border: "1px solid rgba(158, 206, 106, 0.2)",
            borderRadius: "0.5vw",
            marginBottom: "4vh",
            width: "fit-content",
          }}
        >
          <div style={{ fontSize: "1.1vw", fontWeight: 700, color: "#9ECE6A", marginRight: "1.5vw", fontFamily: "'DM Mono', monospace" }}>
            BUILD
          </div>
          <div style={{ fontSize: "1.2vw", color: "#FFFFFF", fontFamily: "'DM Mono', monospace" }}>
            /portfolio/from-risk-profile?risk=4
          </div>
        </div>

        <div style={{ display: "flex", gap: "3vw" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2vh" }}>
            <div style={{ fontSize: "1.1vw", fontWeight: 600, color: "#FFFFFF", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", paddingBottom: "1vh" }}>
              Client Profile
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
                <span style={{ color: "#7AA2F7" }}>"risk_score"</span>: <span style={{ color: "#FF9E64" }}>4</span>,
              </div>
              <div style={{ paddingLeft: "1.5vw" }}>
                <span style={{ color: "#7AA2F7" }}>"horizon_yrs"</span>: <span style={{ color: "#FF9E64" }}>10</span>,
              </div>
              <div style={{ paddingLeft: "1.5vw" }}>
                <span style={{ color: "#7AA2F7" }}>"base_ccy"</span>: <span style={{ color: "#E0AF68" }}>"EUR"</span>
              </div>
              <div style={{ color: "#C0CAF5" }}>{"}"}</div>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2vh" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", paddingBottom: "1vh" }}>
              <div style={{ fontSize: "1.1vw", fontWeight: 600, color: "#FFFFFF" }}>Allocation</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5vw" }}>
                <div style={{ width: "0.6vw", height: "0.6vw", backgroundColor: "#9ECE6A", borderRadius: "50%" }} />
                <div style={{ fontSize: "0.85vw", fontFamily: "'DM Mono', monospace", color: "#9ECE6A" }}>READY</div>
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
                <span style={{ color: "#7AA2F7" }}>"equity_dm"</span>: <span style={{ color: "#FF9E64" }}>0.42</span>,
              </div>
              <div style={{ paddingLeft: "1.5vw" }}>
                <span style={{ color: "#7AA2F7" }}>"equity_em"</span>: <span style={{ color: "#FF9E64" }}>0.10</span>,
              </div>
              <div style={{ paddingLeft: "1.5vw" }}>
                <span style={{ color: "#7AA2F7" }}>"govt_eur"</span>: <span style={{ color: "#FF9E64" }}>0.18</span>,
              </div>
              <div style={{ paddingLeft: "1.5vw" }}>
                <span style={{ color: "#7AA2F7" }}>"gold"</span>: <span style={{ color: "#FF9E64" }}>0.05</span>,
              </div>
              <div style={{ paddingLeft: "1.5vw", color: "#565F89" }}>
                ...
              </div>
              <div style={{ color: "#C0CAF5" }}>{"}"}</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end", width: "100%" }}>
          <div style={{ fontSize: "0.9vw", color: "#565F89" }}>
            Investment Decision Lab
          </div>
        </div>
      </div>
    </div>
  );
}
