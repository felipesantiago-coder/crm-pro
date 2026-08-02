// ============================================================
// Bot / Crawler / Spam detector for tracking endpoints
// Checks User-Agent and behavioral patterns
// ============================================================

const BOT_UA_PATTERNS = [
  // Search engine crawlers
  /bot/i, /crawler/i, /spider/i, /slurp/i, /mediapartners/i,
  // Social media crawlers
  /facebookexternalhit/i, /Facebot/i, /Twitterbot/i, /t.co/i,
  /LinkedInBot/i, /Slackbot/i, /Discordbot/i, /TelegramBot/i,
  // Monitoring / uptime
  /uptimerobot/i, /pingdom/i, /newrelic/i, /datadog/i,
  /googlebot/i, /bingbot/i, /yandexbot/i, /baiduspider/i,
  /duckduckbot/i, /applebot/i, /semrushbot/i, /ahrefsbot/i,
  /mj12bot/i, /screaming frog/i, /seo/i,
  // Ad / analytics bots
  /adsbot/i, /google-ads/i, /google-inspectiontool/i,
  // Generic automation
  /curl/i, /wget/i, /python-requests/i, /python-urllib/i,
  /httpclient/i, /java\//i, /go-http/i, /node-fetch/i,
  /requests/i, /axios/i, /fetch/i,
  // Headless browsers (common patterns)
  /headlesschrome/i, /headless/i, /phantomjs/i, /selenium/i,
  /puppeteer/i, /playwright/i, /electron/i,
];

/**
 * Returns true if the User-Agent string looks like a bot/crawler.
 * Uses a curated allowlist approach — known real browsers pass through.
 */
export function isLikelyBot(userAgent: string | null): boolean {
  if (!userAgent) return true; // No UA = suspicious

  // Allowlist: if UA contains a real browser identifier, it's likely human
  const hasRealBrowser =
    /Mozilla\/5\.0/.test(userAgent) &&
    (/(?:Chrome|Safari|Firefox|Edg|Opera|SamsungBrowser|CriOS|FxiOS)/.test(userAgent));

  if (!hasRealBrowser) return true;

  // Check against bot patterns
  for (const pattern of BOT_UA_PATTERNS) {
    if (pattern.test(userAgent)) return true;
  }

  return false;
}
