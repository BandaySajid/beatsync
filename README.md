# Beatsync

Beatsync is a high-precision web audio player built for multi-device playback. The official app is [beatsync.gg](https://www.beatsync.gg/).

https://github.com/user-attachments/assets/2aa385a7-2a07-4ab5-80b1-fda553efc57b

## Features

- **Millisecond-accurate synchronization**: Abstracts [NTP-inspired](https://en.wikipedia.org/wiki/Network_Time_Protocol) time synchronization primitives to achieve a high degree of accuracy
- **Cross-platform**: Works on any device with a modern browser (Chrome recommended for best performance)
- **Spatial audio:** Allows controlling device volumes through a virtual listening source for interesting sonic effects
- **Polished interface**: Smooth loading states, status indicators, and all UI elements come built-in
- **Self-hostable**: Run your own instance with a few commands


> [!NOTE]
> Beatsync is in early development. Mobile support is working, but experimental. Please consider creating an issue or contributing with a PR if you run into problems!

## Quickstart

This project uses [Turborepo](https://turbo.build/repo).

Fill in the `.env` file in `apps/client` with the following:

```sh
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

Run the following commands to start the server and client:

```sh
bun install          # installs once for all workspaces
bun dev              # starts both client (:3000) and server (:8080)
```

| Directory         | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `apps/server`     | Bun HTTP + WebSocket server                                    |
| `apps/client`     | Next.js frontend with Tailwind & Shadcn/ui                     |
| `packages/shared` | Type-safe schemas and functions shared between client & server |

## YouTube Search & Streaming (Production)

Beatsync natively integrates YouTube search directly into the dashboard using `youtubei.js` for blazing-fast lookups, and falls back to `yt-dlp` for streaming audio flawlessly to R2.

If you are running the server in **production** (e.g. Ubuntu, Docker), YouTube's bot detection will block `yt-dlp` audio extraction. To bypass this, you must export your browser cookies:

1. Install the [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/ccpffkphkjlhlpebgcpmkoaignbobbdd) extension in your browser.
2. Visit YouTube and ensure you are logged in and no captchas are pending.
3. Export your cookies and save the file as `cookies.txt` in the root of your `apps/server` folder.

*(Note: During local development on a Mac, the server will automatically extract cookies from your local Chrome installation.)*
