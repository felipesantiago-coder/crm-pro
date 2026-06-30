/*!
 * CRM Pixel — Lightweight tracking for landing pages
 * Embed: <script src="pixel.js" data-site-id="SITE_ID"></script>
 */
(function () {
  "use strict";

  /* ── Config ─────────────────────────────────────────── */
  var TRACK_ENDPOINT = "/api/track";
  var PIXEL_ENDPOINT = "/api/track/pixel.gif";
  var LS_VID = "_crmpx_vid";
  var SS_SID = "_crmpx_sid";
  var DEBOUNCE_MS = 2000;
  var HEARTBEAT_INTERVAL = 30000; // 30 s

  /* ── UUID v4 ────────────────────────────────────────── */
  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /* ── Storage helpers ────────────────────────────────── */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* noop */ } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* noop */ } }

  /* ── Visitor / Session IDs ──────────────────────────── */
  var vid = lsGet(LS_VID);
  if (!vid) { vid = uuid(); lsSet(LS_VID, vid); }

  var sid = ssGet(SS_SID);
  var isNewSession = !sid;
  if (isNewSession) { sid = uuid(); ssSet(SS_SID, sid); }

  /* ── Script tag / site-id ───────────────────────────── */
  var me = document.currentScript || (function () {
    var s = document.getElementsByTagName("script");
    return s[s.length - 1];
  })();
  var siteId = (me && me.getAttribute("data-site-id")) || "";

  /* ── UTM parser ─────────────────────────────────────── */
  function parseUTM() {
    var q = location.search.substring(1).split("&");
    var utm = {};
    for (var i = 0; i < q.length; i++) {
      var p = q[i].split("=");
      var k = decodeURIComponent(p[0]);
      if (k.indexOf("utm_") === 0 && p[1]) utm[k] = decodeURIComponent(p[1].replace(/\+/g, " "));
    }
    return utm;
  }

  var utmParams = parseUTM();

  /* ── Common payload builder ─────────────────────────── */
  var leadId = "";

  function basePayload(evt, extra) {
    var d = {
      site_id: siteId,
      vid: vid,
      sid: sid,
      lead_id: leadId || undefined,
      event: evt,
      url: location.href,
      referrer: document.referrer || undefined,
      ua: navigator.userAgent,
      screen: screen.width + "x" + screen.height,
      utm_source: utmParams.utm_source || undefined,
      utm_medium: utmParams.utm_medium || undefined,
      utm_campaign: utmParams.utm_campaign || undefined,
      utm_content: utmParams.utm_content || undefined,
      utm_term: utmParams.utm_term || undefined,
      ts: Date.now()
    };
    // Merge cookie consent flag if Cookiebot / OneTrust / custom global exists
    if (typeof Cookiebot !== "undefined") d.cookie_consent = Cookiebot.consented ? 1 : 0;
    else if (typeof OnetrustActiveGroups !== "undefined") d.cookie_consent = OnetrustActiveGroups.indexOf("C0002") !== -1 ? 1 : 0;
    else if (navigator.cookieEnabled) d.cookie_consent = 1;
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) d[k] = extra[k];
    // Strip undefined keys to keep payload small
    var out = {};
    for (var j in d) if (d[j] !== undefined) out[j] = d[j];
    return out;
  }

  /* ── Transport: sendBeacon → fetch ──────────────────── */
  function send(payload) {
    var data = "data=" + encodeURIComponent(JSON.stringify(payload));
    if (navigator.sendBeacon) {
      try {
        var sent = navigator.sendBeacon(TRACK_ENDPOINT, data);
        if (sent) return;
      } catch (e) { /* fallback */ }
    }
    try {
      fetch(TRACK_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: data,
        keepalive: true,
        credentials: "omit"
      });
    } catch (e) { /* silent */ }
  }

  /* ── Pixel URL builder (for <img> / email opens) ────── */
  function pixelURL(evt, extra) {
    var p = basePayload(evt, extra);
    var qs = [];
    for (var k in p) if (p.hasOwnProperty(k)) qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(p[k]));
    return PIXEL_ENDPOINT + "?" + qs.join("&");
  }

  /* ── Debounce guard ─────────────────────────────────── */
  var _lastEvent = {};
  function debounce(key) {
    var now = Date.now();
    if (_lastEvent[key] && now - _lastEvent[key] < DEBOUNCE_MS) return false;
    _lastEvent[key] = now;
    return true;
  }

  /* ── Time-on-page heartbeat ─────────────────────────── */
  var _started = Date.now();
  var _heartbeatTimer;

  function startHeartbeat() {
    _heartbeatTimer = setInterval(function () {
      send(basePayload("heartbeat", { time_on_page: Math.round((Date.now() - _started) / 1000) }));
    }, HEARTBEAT_INTERVAL);
  }

  function stopHeartbeat() {
    clearInterval(_heartbeatTimer);
  }

  /* ── Scroll-depth tracking ──────────────────────────── */
  var _scrollThresholds = [25, 50, 75, 90];
  var _scrollFired = {};

  function onScroll() {
    var docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight;
    if (docH <= 0) return;
    var pct = Math.round((window.pageYOffset / docH) * 100);
    for (var i = 0; i < _scrollThresholds.length; i++) {
      var t = _scrollThresholds[i];
      if (pct >= t && !_scrollFired[t]) {
        _scrollFired[t] = true;
        send(basePayload("scroll_depth", { depth: t }));
      }
    }
  }

  var scrollActive = false;
  function ensureScrollListener() {
    if (scrollActive) return;
    scrollActive = true;
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(function () { onScroll(); ticking = false; });
      }
    }, { passive: true });
  }

  /* ── Page-view (called once per session load) ───────── */
  function trackPageview() {
    if (!debounce("pageview")) return;
    send(basePayload("pageview"));
    ensureScrollListener();
    startHeartbeat();
  }

  /* ── Unload: final heartbeat + beacon ───────────────── */
  window.addEventListener("beforeunload", function () {
    stopHeartbeat();
    var payload = basePayload("pageview_duration", { time_on_page: Math.round((Date.now() - _started) / 1000) });
    var data = "data=" + encodeURIComponent(JSON.stringify(payload));
    if (navigator.sendBeacon) {
      try { navigator.sendBeacon(TRACK_ENDPOINT, data); } catch (e) { /* noop */ }
    }
  });

  /* ── Public API ─────────────────────────────────────── */
  var CRMPIXEL = {
    /**
     * Fire a custom event.
     * @param {string} name  — e.g. "lead", "whatsapp_click", "form_submit"
     * @param {object} [data] — optional extra key-values
     */
    track: function (name, data) {
      send(basePayload(name, data));
    },

    /**
     * Associate this visitor/session with a CRM lead ID.
     * @param {string} id
     */
    identify: function (id) {
      if (!id) return;
      leadId = id;
      send(basePayload("identify", { lead_id: id }));
    },

    /**
     * Return the pixel URL for email-open / image-based tracking.
     * @param {string} [event="pixel"]
     * @param {object} [data]
     * @returns {string}
     */
    pixelURL: pixelURL,

    /** Internal IDs (useful for debugging) */
    vid: vid,
    sid: sid
  };

  window.CRMPIXEL = CRMPIXEL;

  /* ── Boot ───────────────────────────────────────────── */
  if (document.readyState === "complete" || document.readyState === "interactive") {
    trackPageview();
  } else {
    document.addEventListener("DOMContentLoaded", trackPageview);
  }
})();