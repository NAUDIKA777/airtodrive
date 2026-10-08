// Air to Drive — hub card (React / JSX, drop-in with inline styles).
// Works in any React (web) project regardless of your CSS setup.
// 1. Put air-to-drive-logo.jpg in your hub's public/ (or import it and pass via `image`).
// 2. Render <AirToDriveCard /> inside your existing cards grid.
//
// Note: inline styles can't do :hover. If you want the hover lift/glow, use the
// CSS version in air-to-drive-card.html (class .vc-card:hover).

export default function AirToDriveCard({
  href = "https://airtodrive.com",
  image = "/air-to-drive-mark.png",
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={styles.card}>
      <div style={styles.media}>
        <img src={image} alt="Air to Drive" style={styles.img} />
      </div>
      <div style={styles.body}>
        <span style={styles.badge}>ANDROID · PWA</span>
        <h3 style={styles.title}>Air to Drive</h3>
        <p style={styles.desc}>
          Download massive files straight to an external USB drive — zero phone storage required.
        </p>
        <span style={styles.cta}>Open App →</span>
      </div>
    </a>
  );
}

const styles = {
  card: {
    display: "flex",
    flexDirection: "column",
    background: "#15161a",
    border: "1px solid #2c2c2e",
    borderRadius: 20,
    overflow: "hidden",
    textDecoration: "none",
    color: "#ffffff",
  },
  media: {
    aspectRatio: "16 / 10",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "radial-gradient(120% 120% at 50% 0%, #0c1b20 0%, #08090c 70%)",
    borderBottom: "1px solid #2c2c2e",
  },
  img: { height: "72%", width: "auto", objectFit: "contain" },
  body: { padding: 20, display: "flex", flexDirection: "column", gap: 10 },
  badge: {
    alignSelf: "flex-start",
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: 700,
    color: "#00e5ff",
    background: "rgba(0,229,255,0.12)",
    border: "1px solid rgba(0,229,255,0.3)",
    borderRadius: 6,
    padding: "3px 8px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  title: { margin: "2px 0 0", fontSize: 20, fontWeight: 800, letterSpacing: -0.3 },
  desc: { margin: 0, fontSize: 14, lineHeight: 1.5, color: "#8e8e93" },
  cta: {
    marginTop: 8,
    alignSelf: "flex-start",
    fontSize: 14,
    fontWeight: 700,
    color: "#000",
    background: "#00e5ff",
    borderRadius: 10,
    padding: "10px 18px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
};
