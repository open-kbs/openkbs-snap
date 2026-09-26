# openkbs-snap

Browser extension for collecting visual context during screen-share reviews:
select an area of the page, draw on the screenshot, add a note, save into an
issue. A session of issues exports as a zip with a Markdown report that the
studio agent can read directly.

## Vocabulary

- **Session** – one review meeting. Ordered list of issues.
- **Issue** – title, type (bug / ux / idea), priority, expected behavior, free text, one or more shots.
- **Shot** – annotated screenshot + optional note + auto-captured page context.

## Export format

```
review-<date>-<time>.zip
  REPORT.md          # whole session, issues in order, images inline
  report.json        # same data, machine-readable
  issues/
    01/
      shot-1.png     # annotations burned in (what a model sees)
      shot-1.json    # annotation vectors + page context
```

Page context captured per shot, no typing needed: URL, viewport, device pixel
ratio, user agent, DOM selector under the selection, console errors from the
last 30 s, timestamp.

## Delivery targets

1. Zip download.
2. Send to studio – post the bundle into a project chat.
3. Board import – needs card attachments (not available yet).

## Browsers

Chrome MV3 first. Same WebExtension code for Edge / Firefox; Safari via Xcode converter.

## Install (Chrome, unpacked)

1. Download the latest `openkbs-snap.zip` from [Releases](https://github.com/open-kbs/openkbs-snap/releases/latest) and unzip it (or clone this repo).
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked** → pick the unzipped folder.
4. Pin the "OpenKBS Snap" icon from the puzzle menu. Reload any tab that was open before installing.

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
- `bg.js` – service worker: hotkeys, captureVisibleTab, storage, badge.
- `console-hook.js` – MAIN-world hook buffering console errors/warnings for the last minute.
- `content.js` – selection overlay, crop, annotation editor (Shadow DOM), context collection.
- `popup.html/js` – toolbar popup: capture, open panel, export, new report.
- `panel.html/js/css` – side panel: issue list, edit, export.
- `lib/export.js` – zip export shared by popup and panel.
- `lib/store.js` – chrome.storage.local schema (`session` + `img:<shotId>`).
- `lib/zip.js` – store-only zip writer (no deps). `lib/report.js` – REPORT.md + report.json.
