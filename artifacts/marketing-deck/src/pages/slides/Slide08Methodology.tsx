export default function Slide08Methodology() {
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
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Look-Through</div>
          <div style={{ fontSize: "1vw", color: "#7AA2F7", fontWeight: 500, display: "flex", alignItems: "center", gap: "0.5vw" }}>
            <span style={{ width: "4px", height: "1.2vw", backgroundColor: "#7AA2F7", borderRadius: "2px", marginLeft: "-3vw" }} />
            Methodology
          </div>
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
          Methodology
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
          Built for the second look.
        </h1>

        <p
          style={{
            fontSize: "1.3vw",
            color: "#9AA5CE",
            lineHeight: 1.6,
            maxWidth: "48vw",
            margin: "0 0 4.5vh 0",
            fontWeight: 400,
          }}
        >
          A Methodology section ships with the tool — every formula, source
          and assumption on screen. The kind of documentation that lets
          compliance, an analyst, or a curious client pick it apart.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2vh 2vw", width: "100%", maxWidth: "62vw" }}>
          <div style={{ backgroundColor: "rgba(255, 255, 255, 0.02)", padding: "2.4vh 1.8vw", borderRadius: "0.5vw", border: "1px solid rgba(255, 255, 255, 0.05)", display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
            <div style={{ width: "2.2vw", height: "2.2vw", borderRadius: "50%", backgroundColor: "rgba(122, 162, 247, 0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#7AA2F7", fontFamily: "'DM Mono', monospace", fontSize: "1vw", fontWeight: 700, flexShrink: 0 }}>fx</div>
            <div>
              <div style={{ fontSize: "1.15vw", color: "#FFFFFF", fontWeight: 600, marginBottom: "0.6vh" }}>Every formula on screen</div>
              <div style={{ fontSize: "0.95vw", color: "#9AA5CE", lineHeight: 1.5 }}>VaR, ES, Sharpe, look-through aggregation — all written out beside their inputs.</div>
            </div>
          </div>

          <div style={{ backgroundColor: "rgba(255, 255, 255, 0.02)", padding: "2.4vh 1.8vw", borderRadius: "0.5vw", border: "1px solid rgba(255, 255, 255, 0.05)", display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
            <div style={{ width: "2.2vw", height: "2.2vw", borderRadius: "50%", backgroundColor: "rgba(158, 206, 106, 0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ECE6A", fontFamily: "'DM Mono', monospace", fontSize: "1vw", fontWeight: 700, flexShrink: 0 }}>{"{}"}</div>
            <div>
              <div style={{ fontSize: "1.15vw", color: "#FFFFFF", fontWeight: 600, marginBottom: "0.6vh" }}>Every input editable</div>
              <div style={{ fontSize: "0.95vw", color: "#9AA5CE", lineHeight: 1.5 }}>CMA, correlations, stress shocks. Override a number; every downstream metric updates.</div>
            </div>
          </div>

          <div style={{ backgroundColor: "rgba(255, 255, 255, 0.02)", padding: "2.4vh 1.8vw", borderRadius: "0.5vw", border: "1px solid rgba(255, 255, 255, 0.05)", display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
            <div style={{ width: "2.2vw", height: "2.2vw", borderRadius: "50%", backgroundColor: "rgba(224, 175, 104, 0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#E0AF68", fontFamily: "'DM Mono', monospace", fontSize: "0.95vw", fontWeight: 700, flexShrink: 0 }}>EN</div>
            <div>
              <div style={{ fontSize: "1.15vw", color: "#FFFFFF", fontWeight: 600, marginBottom: "0.6vh" }}>Bilingual EN / DE</div>
              <div style={{ fontSize: "0.95vw", color: "#9AA5CE", lineHeight: 1.5 }}>Same numbers, two languages — for the German-speaking client meeting and the English compliance file.</div>
            </div>
          </div>

          <div style={{ backgroundColor: "rgba(255, 255, 255, 0.02)", padding: "2.4vh 1.8vw", borderRadius: "0.5vw", border: "1px solid rgba(255, 255, 255, 0.05)", display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
            <div style={{ width: "2.2vw", height: "2.2vw", borderRadius: "50%", backgroundColor: "rgba(255, 158, 100, 0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FF9E64", fontFamily: "'DM Mono', monospace", fontSize: "1vw", fontWeight: 700, flexShrink: 0 }}>404</div>
            <div>
              <div style={{ fontSize: "1.15vw", color: "#FFFFFF", fontWeight: 600, marginBottom: "0.6vh" }}>No accounts. No tracking.</div>
              <div style={{ fontSize: "0.95vw", color: "#9AA5CE", lineHeight: 1.5 }}>Frontend only. Client portfolios never leave the browser. Nothing logged, nothing stored.</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ fontSize: "1vw", color: "#565F89", fontWeight: 500 }}>08</div>
          <div style={{ fontSize: "0.9vw", color: "#565F89" }}>Investment Decision Lab</div>
        </div>
      </div>
    </div>
  );
}
