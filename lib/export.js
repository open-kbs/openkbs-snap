// Export the current report as a zip (used by panel.js and popup.js; needs store.js, zip.js, report.js).
async function snapExportZip() {
  const full = await snapGetSession();
  const session = { ...full, issues: snapPending(full) };
  if (!session.issues.length) return { error: 'Nothing pending to export' };
  const ids = session.issues.flatMap((i) => i.shots.map((s) => s.id));
  const imgs = await snapGetImages(ids);
  const files = snapBuildReport(session, imgs);
  const blob = snapMakeZip(files);
  const url = URL.createObjectURL(blob);
  const base = (session.name || 'report').replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report';
  const filename = `snap-${base}-${snapStamp()}.zip`;
  try {
    await chrome.downloads.download({ url, filename, saveAs: true });
  } catch (e) { return { error: e.message }; }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { files: files.length, filename };
}
