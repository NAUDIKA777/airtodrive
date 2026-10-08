# Air to Drive — VectorCraft Digital hub card

The hub is a **separate Emergent project**, so these are copy-paste assets to add
the Air to Drive card there (I can't edit that project from inside this one).

## Files
- `air-to-drive-card.html` — standalone HTML + CSS card (previewable on its own; has
  hover lift/glow). Copy the block between the `COPY FROM / TO HERE` comments into your
  hub's cards grid.
- `AirToDriveCard.jsx` — React component with inline styles (drop into a React hub).
- `air-to-drive-logo.jpg` — the card thumbnail (square-ish badge).
- `air-to-drive-og.jpg` — 1200×630 alternative (use if your cards are wide/banner style).

## Card details
- Title: **Air to Drive**
- Description: "Download massive files straight to an external USB drive — zero phone storage required."
- Badge: `ANDROID · PWA`
- Link: `https://airtodrive.com`, opens in a new tab (`target="_blank" rel="noopener noreferrer"`)

## To match your existing cards exactly
If "Wisdom and Word" / "Print Fade Studio" use specific wrapper classes or a different
link structure, open that hub project and either:
1. Paste one existing card's markup here and I'll regenerate this to match 1:1, or
2. Swap this card's class names for yours and keep the `href` + `target="_blank"`.

## Add the image
Place `air-to-drive-logo.jpg` in the hub's assets/public folder and point the card's
`img src` (HTML) or `image` prop (JSX) at it.
