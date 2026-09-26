// Builds REPORT.md + report.json + image files for a session. Returns [{ name, data: Uint8Array }].
function snapPad(n) { return String(n).padStart(2, '0'); }
function snapStamp(d = new Date()) {
  return `${d.getFullYear()}-${snapPad(d.getMonth() + 1)}-${snapPad(d.getDate())}-${snapPad(d.getHours())}${snapPad(d.getMinutes())}`;
}
function snapShortUrl(u) { try { const x = new URL(u); return x.host + x.pathname + x.search; } catch { return u || ''; } }

// The report.json object (+ png paths) — used by the zip export and by the
// direct "Send to board" (which ships the same JSON plus the images inline).
function snapReportJson(session) {
  const name = session.name || `Review ${session.createdAt.slice(0, 10)}`;
  const json = { name, createdAt: session.createdAt, exportedAt: new Date().toISOString(), issues: [] };
  session.issues.forEach((issue, ii) => {
    const n = ii + 1, dir = `issues/${snapPad(n)}`;
    json.issues.push({
      n, title: issue.title, type: issue.type, priority: issue.priority, expected: issue.expected, notes: issue.notes, createdAt: issue.createdAt,
      shots: issue.shots.map((shot, si) => ({
        k: si + 1, id: shot.id, note: shot.note, createdAt: shot.createdAt,
        png: `${dir}/shot-${si + 1}.png`, details: `${dir}/shot-${si + 1}.json`, context: shot.context || {}, vectors: shot.vectors,
      })),
    });
  });
  return json;
}

function snapBuildReport(session, images) {
  const enc = new TextEncoder();
  const files = [];
  const md = [];
  const shots = snapShotCount(session);
  const name = session.name || `Review ${session.createdAt.slice(0, 10)}`;
  md.push(`# ${name}`, '');
  md.push(`Created: ${session.createdAt} · Issues: ${session.issues.length} · Screenshots: ${shots}`);
  md.push('', 'Collected with OpenKBS Snap. Each issue has one or more annotated screenshots; the context (page, viewport, DOM selector, console errors, annotation vectors) sits in the JSON next to each image.', '');
  const json = { name, createdAt: session.createdAt, exportedAt: new Date().toISOString(), issues: [] };

  session.issues.forEach((issue, ii) => {
    const n = ii + 1, dir = `issues/${snapPad(n)}`;
    const firstUrl = issue.shots[0] && issue.shots[0].context && issue.shots[0].context.url;
    md.push(`## ${n}. ${issue.title}`, '');
    md.push(`Type: ${issue.type} · Priority: ${issue.priority}` + (firstUrl ? ` · Page: ${firstUrl}` : ''));
    if (issue.expected) md.push('', `**Expected:** ${issue.expected}`);
    if (issue.notes) md.push('', issue.notes);
    md.push('');
    const jIssue = { n, title: issue.title, type: issue.type, priority: issue.priority, expected: issue.expected, notes: issue.notes, createdAt: issue.createdAt, shots: [] };

    issue.shots.forEach((shot, si) => {
      const k = si + 1, base = `${dir}/shot-${k}`;
      const img = images[shot.id] || {};
      if (img.png) files.push({ name: `${base}.png`, data: snapDataUrlToU8(img.png) });
      const c = shot.context || {};
      files.push({ name: `${base}.json`, data: enc.encode(JSON.stringify({ note: shot.note, createdAt: shot.createdAt, context: c, vectors: shot.vectors }, null, 2)) });
      md.push(`### Screenshot ${n}.${k}`, '', `![Screenshot ${n}.${k}](${base}.png)`, '');
      if (shot.note) md.push(`Note: ${shot.note}`, '');
      const ctxBits = [];
      if (c.url) ctxBits.push(`page ${snapShortUrl(c.url)}`);
      if (c.viewport) ctxBits.push(`viewport ${c.viewport.width}×${c.viewport.height} @${c.dpr}x`);
      if (c.selector) ctxBits.push(`element \`${c.selector}\``);
      ctxBits.push(`[details](${base}.json)`);
      md.push(`Context: ${ctxBits.join(' · ')}`, '');
      if (c.consoleErrors && c.consoleErrors.length) {
        md.push(`Console (last 60 s before capture):`, '', '```');
        for (const e of c.consoleErrors) md.push(`[${e.level} -${e.secondsAgo}s] ${e.msg}`);
        md.push('```', '');
      }
      jIssue.shots.push({ k, note: shot.note, createdAt: shot.createdAt, png: `${base}.png`, details: `${base}.json`, context: c, vectors: shot.vectors });
    });
    json.issues.push(jIssue);
  });

  files.unshift({ name: 'report.json', data: enc.encode(JSON.stringify(json, null, 2)) });
  files.unshift({ name: 'REPORT.md', data: enc.encode(md.join('\n') + '\n') });
  return files;
}
