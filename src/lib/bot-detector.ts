// ============================================================
// Bot / Crawler / Spam detector for tracking endpoints
// Checks User-Agent and behavioral patterns
// ============================================================

const BOT_UA_PATTERNS = [
  // Search engine crawlers
  /googlebot/i, /bingbot/i, /yandexbot/i, /baiduspider/i,
  /duckduckbot/i, /applebot/i, /slurp/i, /mediapartners/i,
  // SEO / marketing crawlers
  /semrushbot/i, /ahrefsbot/i, /mj12bot/i, /screaming.?frog/i,
  // Social media crawlers (link preview bots, NOT in-app browsers)
  /facebookexternalhit/i, /Facebot/i, /Twitterbot/i,
  /LinkedInBot/i, /Slackbot/i, /Discordbot/i, /TelegramBot/i,
  // Monitoring / uptime checkers
  /uptimerobot/i, /pingdom/i, /newrelic/i, /datadog/i,
  // Ad / analytics bots
  /adsbot/i, /google-ads/i, /google-inspectiontool/i,
  // Generic automation tools (exact tool names, not generic words)
  /python-requests/i, /python-urllib/i, /httpclient/i,
  /HeadlessChrome/i, /PhantomJS/i, /selenium/i,
  /puppeteer/i, /playwright/i,
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
