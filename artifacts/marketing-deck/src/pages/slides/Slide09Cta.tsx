export default function Slide09Cta() {
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
      <div
        style={{
          flex: 1,
          padding: "10vh 8vw",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: "radial-gradient(circle at center, rgba(122, 162, 247, 0.1) 0%, transparent 60%)",
        }}
      >
        <div
          style={{
            width: "4vw",
            height: "4vw",
            backgroundColor: "#7AA2F7",
            borderRadius: "1vw",
            marginBottom: "4vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: "2vw", height: "2vw", backgroundColor: "#1A1B26", borderRadius: "0.5vw" }} />
        </div>

        <h1
          style={{
            fontSize: "5vw",
            fontWeight: 700,
            color: "#FFFFFF",
            margin: "0 0 3vh 0",
            letterSpacing: "-0.02em",
            textAlign: "center",
            lineHeight: 1.05,
          }}
        >
          Open the Lab.
        </h1>

        <p
          style={{
            fontSize: "1.5vw",
            color: "#9AA5CE",
            lineHeight: 1.6,
            maxWidth: "45vw",
            margin: "0 0 6vh 0",
            fontWeight: 400,
            textAlign: "center",
          }}
        >
          A sample portfolio is loaded by default. No signup, no data
          collection, no install. Edit a weight and watch every metric move
          with you.
        </p>

        <div style={{ display: "flex", gap: "2vw" }}>
          <div
            style={{
              padding: "2vh 3vw",
              backgroundColor: "#7AA2F7",
              color: "#1A1B26",
              fontSize: "1.2vw",
              fontWeight: 600,
              borderRadius: "0.5vw",
            }}
          >
            Open the workspace
          </div>
          <div
            style={{
              padding: "2vh 3vw",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              color: "#FFFFFF",
              fontSize: "1.2vw",
              fontWeight: 600,
              borderRadius: "0.5vw",
            }}
          >
            Read the methodology
          </div>
        </div>

        <div style={{ marginTop: "10vh", display: "flex", gap: "4vw", borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "4vh" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1vw" }}>
            <div style={{ width: "1vw", height: "1vw", backgroundColor: "#9ECE6A", borderRadius: "50%" }} />
            <div style={{ fontSize: "1.1vw", color: "#C0CAF5" }}>16 real UCITS ETFs</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1vw" }}>
            <div style={{ width: "1vw", height: "1vw", backgroundColor: "#E0AF68", borderRadius: "50%" }} />
            <div style={{ fontSize: "1.1vw", color: "#C0CAF5" }}>6 historical stress windows</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1vw" }}>
            <div style={{ width: "1vw", height: "1vw", backgroundColor: "#7AA2F7", borderRadius: "50%" }} />
            <div style={{ fontSize: "1.1vw", color: "#C0CAF5" }}>~3,000 underlying holdings</div>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: "8vh",
            left: "8vw",
            right: "8vw",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "1vw", color: "#565F89", fontWeight: 500 }}>09</div>
          <div style={{ fontSize: "0.9vw", color: "#565F89" }}>Investment Decision Lab</div>
        </div>
      </div>
    </div>
  );
}
