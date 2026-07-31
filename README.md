# GEMINIDS — TRANSMISSION LOG SYSTEM

Everything code-side is finished: message history, presence, moderator
tools, rate limiting, replies, pinning, coordinate tagging. What's left
is a short list of steps only you can do, since they need your own
logins and your domain's DNS panel — nothing here can be automated
from outside your accounts.

## What's in this bundle

- `geminids-chat.html` — the entire client. One file, no build step.
- `server.js` + `package.json` — the WebSocket server (Node + `ws` +
  `better-sqlite3` for message history).
- `01-design-system.md` / `geminids-tokens.css` — the design spec.

## Already done for you

Two of the steps below used to require editing code by hand — they're
done. `geminids-chat.html` is already pointed at `wss://ws.geminids.co`
and already uses real browser storage for callsigns, ready to deploy
as-is. You should not need to open or edit that file at all — just
upload it as-is.

A moderator key has also been generated for you:

```
MODERATOR_KEY = 6rf8o393FllW8ZZLUFtri6rXixciFNcE
```

Treat that like a password — anyone who has it can pin/delete
messages once the site is live. You'll paste it into Render in Step 1,
and you'll visit your own site once with it in the URL in Step 5 to
become a moderator yourself.

## Before you deploy

**Whether you want people using real names or handles.** The callsign
prompt on first visit accepts any letters/numbers/underscore string —
there's no verification. Fine for a community space; worth knowing if
you expect impersonation to matter.

## Step 1 — Deploy the backend (`server.js`)

Render's free tier works for this (no card, but the server sleeps
after 15 idle minutes and takes ~30-60s to wake — acceptable for a
community chat, not for something needing instant always-on response):

1. Push this whole folder to a GitHub repo.
2. In Render: **New → Web Service** → connect that repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Under **Environment**, add:
   - `MODERATOR_KEY` = `6rf8o393FllW8ZZLUFtri6rXixciFNcE` (the key generated above)
   - (optional) `DB_PATH` = `/data/geminids.db` if you attach a Render
     persistent disk — **without a persistent disk, the SQLite file
     resets on every redeploy**, since Render's default filesystem is
     ephemeral. A free-tier persistent disk is worth adding for this
     specifically, or the message history feature won't actually persist
     the way it's designed to.
5. Once deployed, Render gives you a URL like
   `geminids-transmission-server.onrender.com`. Under **Settings →
   Custom Domain**, add a subdomain — e.g. `ws.geminids.co`.
6. Render will show you a DNS record to add (usually a `CNAME`
   pointing `ws` at their provided target). Add that record in
   geminids.co's DNS panel (wherever you registered/manage the
   domain — Namecheap, Cloudflare, Google Domains, etc.).

## Step 2 — Deploy the frontend (`geminids-chat.html`)

Cheapest, simplest path: GitHub Pages. `geminids-chat.html` is already
configured to talk to `wss://ws.geminids.co`, so as long as you used
that exact subdomain in Step 1, no edits are needed here.

1. In the same repo, enable **Pages** (Settings → Pages → deploy from
   branch).
2. Under **Custom domain**, enter `geminids.co` (or a subdomain like
   `chat.geminids.co`).
3. GitHub shows you the DNS records to add (an `A` record set for the
   apex domain, or a `CNAME` for a subdomain). Add those in your DNS
   panel, same place as step 1.

## Step 3 — Become a moderator yourself

Visit your deployed site once with the moderator key appended to the
URL:

```
https://geminids.co/?mod=6rf8o393FllW8ZZLUFtri6rXixciFNcE
```

The page reads it, strips it from the visible URL immediately, and
stores it in your browser so you don't need to repeat this. Share
that link only with people you actually want moderating.

## After that

DNS propagation can take anywhere from a few minutes to a few hours
depending on your registrar. Once both `ws.geminids.co` (or whatever
you named it) and your frontend domain resolve, the whole thing is
live — anyone with the link can join, chat, and see history; only
people with the moderator key can pin or delete.

## Production checklist

- [x] `WS_URL` in `geminids-chat.html` already points at `wss://ws.geminids.co`
- [x] localStorage persistence already enabled for callsigns
- [ ] `MODERATOR_KEY` set on the server, and kept out of the git repo
      itself (set it as an environment variable in Render's dashboard,
      not hardcoded in `server.js`) — already generated above, just
      needs pasting into Render in Step 1
- [ ] Persistent disk attached so `geminids.db` survives redeploys
- [ ] Self-host `JetBrains Mono` / `Space Grotesk` instead of the
      Google Fonts CDN (see design system §6) once traffic matters
- [ ] Consider a stricter per-message rate limit if the community
      grows past casual use — current default is 5 messages per 10
      seconds per connection
