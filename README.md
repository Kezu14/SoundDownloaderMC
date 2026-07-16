# Sound Downloader for Minecraft

Need the creeper hiss for a video, a note block sample for a track, or just curious what's buried in the game files? This site shows every sound from every version of Minecraft — releases, snapshots, even the old alpha builds. Listen right in the browser, grab a single file, or download the whole set as one ZIP.

There's no server and nothing to install: it's a static page that reads Mojang's public version API directly from your browser.

## What it can do

- Any version ever released: the latest release, yesterday's snapshot, or Beta 1.7.3
- Instant search and category filters (mob, music, ambient, records, …)
- Click ▶ to preview a sound without downloading anything
- Download one file — or everything the current filter shows — as a ZIP, with a progress bar and a cancel button
- A full modern version is ~4,900 files / ~360 MB; in Chromium browsers the ZIP streams straight to disk instead of piling up in memory

## How it works

Mojang publishes a manifest of every version of the game. Pick one, and the site reads its asset index — a list of every file with its SHA-1 hash and size — and keeps the `.ogg` entries.

Previews stream from Mojang's official asset servers. Downloads are trickier: browsers need CORS access to read raw bytes, and Mojang's file server doesn't offer it. So the bytes come from the community [minecraft-assets](https://github.com/InventivetalentDev/minecraft-assets) mirror instead, and every downloaded file is checked against the SHA-1 from Mojang's own index — you always get the genuine, untouched files.

## Running it locally

You'll need Node.js 22.12 or newer.

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build in dist/
```

## Good to know

- Safari can't play OGG, so previews are silent there — downloads still work
- Brand-new snapshots can take a little while to show up on the mirror; until then those files land in the failure report after a bulk download, while previews keep working

## Fine print

**Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.**

All sounds are © Mojang / Microsoft. This site hosts and redistributes no game files — your browser fetches them from Mojang's servers and a public community mirror, the same files the game launcher downloads. What you're allowed to do with them is up to [Mojang's usage guidelines](https://www.minecraft.net/en-us/usage-guidelines): fan content like videos, mods and maps is generally fine; reselling the assets or shipping them in unrelated commercial products is not.
