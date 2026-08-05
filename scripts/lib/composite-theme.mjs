const appIdPattern = /^[a-z][a-z0-9-]*$/;

function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function injectCompositeTheme(html, {
  appId,
  title,
  description,
  version,
  measurementId,
  href = '../app-theme.css',
  shellHref = '../app-shell.js',
  analyticsHref = '../analytics.js',
  moreAppsHref = '../',
}) {
  if (typeof html !== 'string') throw new TypeError('html must be a string');
  if (!appIdPattern.test(appId)) throw new Error(`Invalid app id: ${appId}`);
  if (typeof href !== 'string' || !href.trim()) throw new Error('Theme href must be a non-empty string');
  for (const [label, value] of Object.entries({
    title, description, version, measurementId, shellHref, analyticsHref, moreAppsHref,
  })) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${label} must be a non-empty string`);
    }
  }
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

  if (!/data-neurodesk-app-shell(?:\s|=|>)/i.test(themed)) {
    const sourceHref = `https://github.com/neurodesk/webapps/tree/main/apps/${appId}`;
    themed = themed.replace(
      /<\/head>/i,
      `  <script defer src="${escapeAttribute(shellHref)}" data-neurodesk-app-shell data-app-id="${escapeAttribute(appId)}" data-app-title="${escapeAttribute(title)}" data-app-description="${escapeAttribute(description)}" data-app-version="${escapeAttribute(version)}" data-ga4-measurement-id="${escapeAttribute(measurementId)}" data-analytics-href="${escapeAttribute(analyticsHref)}" data-more-apps-href="${escapeAttribute(moreAppsHref)}" data-source-href="${escapeAttribute(sourceHref)}"></script>\n</head>`,
    );
  }

  return themed;
}
