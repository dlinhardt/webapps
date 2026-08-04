const appIdPattern = /^[a-z][a-z0-9-]*$/;

function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function injectCompositeTheme(html, { appId, href = '../app-theme.css' }) {
  if (typeof html !== 'string') throw new TypeError('html must be a string');
  if (!appIdPattern.test(appId)) throw new Error(`Invalid app id: ${appId}`);
  if (typeof href !== 'string' || !href.trim()) throw new Error('Theme href must be a non-empty string');
  if (!/<html\b/i.test(html)) throw new Error(`Cannot theme ${appId}: missing <html> element`);
  if (!/<\/head>/i.test(html)) throw new Error(`Cannot theme ${appId}: missing </head> element`);

  let themed = html;
  if (!/<html\b[^>]*\bdata-neurodesk-app=/i.test(themed)) {
    themed = themed.replace(/<html\b/i, `<html data-neurodesk-app="${escapeAttribute(appId)}"`);
  }

  if (!/data-neurodesk-app-theme(?:\s|=|>)/i.test(themed)) {
    themed = themed.replace(
      /<\/head>/i,
      `  <link rel="stylesheet" href="${escapeAttribute(href)}" data-neurodesk-app-theme>\n</head>`,
    );
  }

  return themed;
}
