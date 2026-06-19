# Connect 4 Snapchat Lens

This project includes a Snapchat Lens-friendly Connect 4 screen at:

```text
/?lens=connect4
```

It is a local two-player pass-and-play game designed for a phone-shaped Lens WebView. It does not use accounts, AI, Firebase, or the full game library UI.

## Local Test

```text
npm run dev
```

Then open:

```text
http://localhost:5173/?lens=connect4
```

## Lens Studio Setup

1. Build and host this web app somewhere HTTPS-accessible.
2. Create a new Lens Studio project.
3. Add a WebView or web content component.
4. Set the WebView URL to your hosted app with `?lens=connect4`.
5. Size the WebView to fill the safe screen area.
6. Test on device through Lens Studio.

## Notes

- The game is intentionally same-device two-player because Snapchat Lenses do not provide a public chat-game publishing path.
- To make this networked, host the existing Firebase multiplayer version and adapt the Lens URL to create or join a room.
- The core rules live in `src/games.ts`; the Lens-specific interface lives in `src/SnapLensConnect4.tsx`.
