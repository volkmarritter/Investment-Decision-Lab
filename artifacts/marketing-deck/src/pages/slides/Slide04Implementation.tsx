export default function Slide04Implementation() {
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
          <div style={{ fontSize: "1vw", color: "#C0CAF5", opacity: 0.7 }}>Quick Start</div>
        </div>

        <div style={{ fontSize: "0.9vw", fontWeight: 600, color: "#565F89", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "2vh" }}>
          Capabilities
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5vh" }}>
          <div style={{ fontSize: "1vw", color: "#7AA2F7", fontWeight: 500, display: "flex", alignItems: "center", gap: "0.5vw" }}>
            <span style={{ width: "4px", height: "1.2vw", backgroundColor: "#7AA2F7", borderRadius: "2px", marginLeft: "-3vw" }} />
            Implementation
          </div>
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
          Implementation
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
          Not a model. An order ticket.
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
          16 hand-curated UCITS ETFs from iShares, SPDR, Invesco, UBS and
          CoinShares. Every position carries ISIN, ticker, TER, currency and
          replication method.
        </p>

        <div
          style={{
            backgroundColor: "#16161E",
            borderRadius: "0.5vw",
            padding: "2.5vh 2vw",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            fontFamily: "'DM Mono', monospace",
            fontSize: "0.95vw",
            lineHeight: 1.7,
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.5)",
            width: "100%",
            maxWidth: "62vw",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.7fr 0.7fr", color: "#565F89", fontSize: "0.85vw", textTransform: "uppercase", letterSpacing: "0.06em", paddingBottom: "1.2vh", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: "1vh" }}>
            <div>Asset Class</div>
            <div>ETF</div>
            <div style={{ textAlign: "right" }}>Weight</div>
            <div style={{ textAlign: "right" }}>TER</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.7fr 0.7fr", color: "#C0CAF5" }}>
            <div><span style={{ color: "#7AA2F7" }}>equity_dm</span></div>
            <div>iShares Core MSCI World <span style={{ color: "#565F89" }}>· IE00B4L5Y983</span></div>
            <div style={{ textAlign: "right", color: "#FF9E64" }}>42%</div>
            <div style={{ textAlign: "right", color: "#9ECE6A" }}>0.20%</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.7fr 0.7fr", color: "#C0CAF5" }}>
            <div><span style={{ color: "#7AA2F7" }}>equity_em</span></div>
            <div>iShares Core MSCI EM IMI <span style={{ color: "#565F89" }}>· IE00BKM4GZ66</span></div>
            <div style={{ textAlign: "right", color: "#FF9E64" }}>10%</div>
            <div style={{ textAlign: "right", color: "#9ECE6A" }}>0.18%</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.7fr 0.7fr", color: "#C0CAF5" }}>
            <div><span style={{ color: "#7AA2F7" }}>govt_eur</span></div>
            <div>iShares Core € Govt Bond <span style={{ color: "#565F89" }}>· IE00B4WXJJ64</span></div>
            <div style={{ textAlign: "right", color: "#FF9E64" }}>18%</div>
            <div style={{ textAlign: "right", color: "#9ECE6A" }}>0.07%</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.7fr 0.7fr", color: "#C0CAF5" }}>
            <div><span style={{ color: "#7AA2F7" }}>credit_eur_ig</span></div>
            <div>iShares Core € Corp Bond <span style={{ color: "#565F89" }}>· IE00B3F81R35</span></div>
            <div style={{ textAlign: "right", color: "#FF9E64" }}>10%</div>
            <div style={{ textAlign: "right", color: "#9ECE6A" }}>0.20%</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.7fr 0.7fr", color: "#C0CAF5" }}>
            <div><span style={{ color: "#7AA2F7" }}>govt_usd</span></div>
            <div>iShares $ Treasury 7–10y <span style={{ color: "#565F89" }}>· IE00B1FZS798</span></div>
            <div style={{ textAlign: "right", color: "#FF9E64" }}>10%</div>
            <div style={{ textAlign: "right", color: "#9ECE6A" }}>0.07%</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.7fr 0.7fr", color: "#C0CAF5" }}>
            <div><span style={{ color: "#7AA2F7" }}>gold</span></div>
            <div>Invesco Physical Gold ETC <span style={{ color: "#565F89" }}>· IE00B579F325</span></div>
            <div style={{ textAlign: "right", color: "#FF9E64" }}>5%</div>
            <div style={{ textAlign: "right", color: "#9ECE6A" }}>0.12%</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.7fr 0.7fr", color: "#C0CAF5" }}>
            <div><span style={{ color: "#7AA2F7" }}>crypto</span></div>
            <div>CoinShares Physical BTC <span style={{ color: "#565F89" }}>· GB00BLD4ZL17</span></div>
            <div style={{ textAlign: "right", color: "#FF9E64" }}>5%</div>
            <div style={{ textAlign: "right", color: "#9ECE6A" }}>0.35%</div>
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ fontSize: "1vw", color: "#565F89", fontWeight: 500 }}>04</div>
          <div style={{ fontSize: "0.9vw", color: "#565F89" }}>Investment Decision Lab</div>
        </div>
      </div>
    </div>
  );
}
