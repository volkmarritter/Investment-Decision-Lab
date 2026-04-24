export default function Slide07LookThrough() {
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
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Stress Tests</div>
          <div style={{ fontSize: "1vw", color: "#7AA2F7", fontWeight: 500, display: "flex", alignItems: "center", gap: "0.5vw" }}>
            <span style={{ width: "4px", height: "1.2vw", backgroundColor: "#7AA2F7", borderRadius: "2px", marginLeft: "-3vw" }} />
            Look-Through
          </div>
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
          Look-Through
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
          See through every fund.
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
          The portfolio is decomposed into roughly 3,000 underlying holdings.
          Every single-name exposure, country and sector aggregated to one
          view — with the duplicates that ETF stacking quietly creates.
        </p>

        <div style={{ display: "flex", gap: "3vw", alignItems: "stretch" }}>
          <div style={{ flex: 1.1, display: "flex", flexDirection: "column", gap: "2vh" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", paddingBottom: "1vh" }}>
              <div style={{ fontSize: "1.1vw", fontWeight: 600, color: "#FFFFFF" }}>Top single-name exposures</div>
              <div style={{ fontSize: "0.85vw", fontFamily: "'DM Mono', monospace", color: "#9ECE6A" }}>look_through.json</div>
            </div>
            <div
              style={{
                backgroundColor: "#16161E",
                borderRadius: "0.5vw",
                padding: "2vh 1.6vw",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                fontFamily: "'DM Mono', monospace",
                fontSize: "0.95vw",
                lineHeight: 1.85,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>NVDA <span style={{ color: "#565F89" }}>· nvidia corp</span></span>
                <span style={{ color: "#FF9E64" }}>2.81%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>AAPL <span style={{ color: "#565F89" }}>· apple inc</span></span>
                <span style={{ color: "#FF9E64" }}>2.34%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>MSFT <span style={{ color: "#565F89" }}>· microsoft</span></span>
                <span style={{ color: "#FF9E64" }}>2.18%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>AMZN <span style={{ color: "#565F89" }}>· amazon</span></span>
                <span style={{ color: "#FF9E64" }}>1.41%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>GOOGL <span style={{ color: "#565F89" }}>· alphabet a</span></span>
                <span style={{ color: "#FF9E64" }}>1.12%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#C0CAF5" }}>META <span style={{ color: "#565F89" }}>· meta platforms</span></span>
                <span style={{ color: "#FF9E64" }}>0.94%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#565F89" }}>
                <span>... 2,994 more</span>
                <span>89.20%</span>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2vh" }}>
            <div style={{ fontSize: "1.1vw", fontWeight: 600, color: "#FFFFFF", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", paddingBottom: "1vh" }}>
              Sector aggregation
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.4vh" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5vh" }}>
                  <span style={{ fontSize: "0.95vw", color: "#C0CAF5" }}>Technology</span>
                  <span style={{ fontSize: "0.95vw", fontFamily: "'DM Mono', monospace", color: "#FF9E64" }}>21.4%</span>
                </div>
                <div style={{ height: "0.5vh", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: "0.25vh", overflow: "hidden" }}>
                  <div style={{ width: "21.4%", height: "100%", backgroundColor: "#7AA2F7" }} />
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5vh" }}>
                  <span style={{ fontSize: "0.95vw", color: "#C0CAF5" }}>Financials</span>
                  <span style={{ fontSize: "0.95vw", fontFamily: "'DM Mono', monospace", color: "#FF9E64" }}>14.7%</span>
                </div>
                <div style={{ height: "0.5vh", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: "0.25vh", overflow: "hidden" }}>
                  <div style={{ width: "14.7%", height: "100%", backgroundColor: "#9ECE6A" }} />
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5vh" }}>
                  <span style={{ fontSize: "0.95vw", color: "#C0CAF5" }}>Healthcare</span>
                  <span style={{ fontSize: "0.95vw", fontFamily: "'DM Mono', monospace", color: "#FF9E64" }}>11.3%</span>
                </div>
                <div style={{ height: "0.5vh", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: "0.25vh", overflow: "hidden" }}>
                  <div style={{ width: "11.3%", height: "100%", backgroundColor: "#E0AF68" }} />
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5vh" }}>
                  <span style={{ fontSize: "0.95vw", color: "#C0CAF5" }}>Industrials</span>
                  <span style={{ fontSize: "0.95vw", fontFamily: "'DM Mono', monospace", color: "#FF9E64" }}>10.1%</span>
                </div>
                <div style={{ height: "0.5vh", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: "0.25vh", overflow: "hidden" }}>
                  <div style={{ width: "10.1%", height: "100%", backgroundColor: "#FF9E64" }} />
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5vh" }}>
                  <span style={{ fontSize: "0.95vw", color: "#C0CAF5" }}>Consumer disc.</span>
                  <span style={{ fontSize: "0.95vw", fontFamily: "'DM Mono', monospace", color: "#FF9E64" }}>9.4%</span>
                </div>
                <div style={{ height: "0.5vh", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: "0.25vh", overflow: "hidden" }}>
                  <div style={{ width: "9.4%", height: "100%", backgroundColor: "#7AA2F7" }} />
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5vh" }}>
                  <span style={{ fontSize: "0.95vw", color: "#565F89" }}>Other (6 sectors)</span>
                  <span style={{ fontSize: "0.95vw", fontFamily: "'DM Mono', monospace", color: "#565F89" }}>33.1%</span>
                </div>
                <div style={{ height: "0.5vh", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: "0.25vh", overflow: "hidden" }}>
                  <div style={{ width: "33.1%", height: "100%", backgroundColor: "#565F89" }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ fontSize: "1vw", color: "#565F89", fontWeight: 500 }}>07</div>
          <div style={{ fontSize: "0.9vw", color: "#565F89" }}>Investment Decision Lab</div>
        </div>
      </div>
    </div>
  );
}
