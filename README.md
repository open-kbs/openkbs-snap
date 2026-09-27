# openkbs-snap

One move: snap a spot on any page, draw on it, say what you want. Then send it to
one of two places in your OpenKBS Studio project:

- **Board** – one card per group of snaps, screenshots attached, for later.
- **Chat** – a vibecoding chat starts right away (or is queued while another chat
  works; "Start anyway" runs it in parallel). Later snaps go into the same chat as
  follow-ups, or onto the same card.

The plugin only stages snaps until they are sent; the studio is the source of
truth. Sent groups stay in **Recent** with their live state (Queued / Working /
Needs your answer / Done / On board): answer the AI's questions, open the chat or
card, reload the captured tab. Export as a zip stays in the ⋯ menu as a rescue.

## Install (Chrome, unpacked)

1. Download the latest `openkbs-snap.zip` from [Releases](https://github.com/open-kbs/openkbs-snap/releases/latest) and unzip it (or clone this repo).
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked** → pick the unzipped folder.
4. Pin the "OpenKBS Snap" icon from the puzzle menu. Reload any tab that was open before installing.

## Connect to a project

Open your OpenKBS Studio project in a tab, click the Snap icon → **Connect to this project** (or paste the studio URL). The extension then talks to that studio with your existing studio login; no token to copy. Once connected:

- In the editor, **New chat** (default, ⌘/Ctrl+Enter) starts a chat from this snap; **To board** (⌘⇧Enter) makes a card; **Add to …** picks a pending group (local), a sent chat (follow-up) or a sent card (more screenshots). "New · keep pending" stages without sending; **Send pending to board** in the popup sends all staged groups as cards.
- **Dictate** in the screenshot editor: click the mic next to the note, talk, click Stop. The clip is transcribed by the connected project (model selectable in the popup: Gemini 3.5 Transcribe, GPT-4o Transcribe, Gemini Flash) and the text lands in the note. Chrome asks for the microphone once, on an extension page.

## Use

- **Alt+Shift+S** (Mac: ⌥⇧S), or click the icon → **Capture area**, then drag a rectangle over the page.
- Editor opens with the **Pen** selected; also Box / Arrow / Text tools, four colors, Undo, Clear.
  Right side: pick an existing issue or "+ New issue" (title, type, priority, expected), note for this screenshot. **Save** (or ⌘/Ctrl+Enter).
- Click the icon for the popup: **Capture area**, **Open report panel**, **Export report (zip)**, **New report**.
- **Alt+Shift+P** opens the report panel: edit issues, reorder, remove shots, name the report, export, start a new report.
- Badge on the icon = number of screenshots in the current session.

Shortcuts can be changed at `chrome://extensions/shortcuts`.

## Release

```
npm run check      # syntax + manifest
npm run package    # dist/openkbs-snap-<version>.zip + dist/openkbs-snap.zip
```
Bump `version` in both `manifest.json` and `package.json`, package, then attach both zips to a GitHub release tagged `v<version>`.

## Files

- `manifest.json` – MV3, `<all_urls>` host permission (needed for capture + console hook on any page).
- `bg.js` – service worker: hotkeys, captureVisibleTab, storage, badge, studio connection (`/api/snap/info`, `/api/snap/import`, `/api/transcribe`), mic relay.
- `console-hook.js` – MAIN-world hook buffering console errors/warnings for the last minute.
- `content.js` – selection overlay, crop, annotation editor (Shadow DOM), context collection.
- `popup.html/js` – toolbar popup: connect project, send to board, capture, panel, export, new report, dictation model.
- `offscreen.html/js` – offscreen recorder (MediaRecorder) for dictation; `mic-permission.html/js` – one-time mic grant page.
- `panel.html/js/css` – side panel: issue list, edit, export.
- `lib/export.js` – zip export shared by popup and panel.
- `lib/store.js` – chrome.storage.local schema (`session` + `img:<shotId>`).
- `lib/zip.js` – store-only zip writer (no deps). `lib/report.js` – REPORT.md + report.json.
