/*!
 * CRM Pixel v2 — Complete tracking for landing pages
 * Embed: <script src="pixel.js" data-site-id="SITE_ID"></script>
 *
 * Auto-tracks: pageview, scroll depth, heartbeat, pageview_duration,
 *              web vitals (LCP/FID/CLS/FCP/TTFB), JS errors, print,
 *              timezone, language, connection type.
 *
 * Public API (window.CRMPIXEL):
 *   .track(name, data)           — fire custom event
 *   .identify(id)                — link visitor to CRM lead
 *   .trackSectionView(name)      — fire section_view event
 *   .trackFormFocus(field)       — fire form_focus event
 *   .trackFormBlur(field, ms)    — fire form_blur event
 *   .trackFormAbandon(filled)    — fire form_abandon event
 *   .trackGalleryClick(idx, tot) — fire gallery_click event
 *   .trackFAQOpen(idx, text)     — fire faq_open event
 *   .trackExitIntent()           — fire exit_intent event
 *   .pixelURL(evt, data)         — build <img> tracking URL
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

  /* ── Visitor context (detected once) ────────────────── */
  var _visitorCtx = {};
  try {
    _visitorCtx.timezone = (Intl && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || null;
  } catch (e) { /* noop */ }
  _visitorCtx.language = navigator.language || null;
  try {
    _visitorCtx.connection = (navigator.connection && navigator.connection.effectiveType) || null;
  } catch (e) { /* noop */ }
  _visitorCtx.dnt = (typeof navigator.doNotTrack !== "undefined") ? navigator.doNotTrack : null;

  /* ── Common payload builder ─────────────────────────── */
  var leadId = "";
  var _formTouched = false; // track if any form field was interacted with
  var _formFieldsFilled = 0; // count of non-empty fields at last check

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
      timezone: _visitorCtx.timezone || undefined,
      language: _visitorCtx.language || undefined,
      connection: _visitorCtx.connection || undefined,
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
    var json = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      try {
        // Use URLSearchParams so sendBeacon sets Content-Type: application/x-www-form-urlencoded
        var params = new URLSearchParams();
        params.append("data", json);
        var sent = navigator.sendBeacon(TRACK_ENDPOINT, params);
        if (sent) return;
      } catch (e) { /* fallback */ }
    }
    try {
      var data = "data=" + encodeURIComponent(json);
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
  function debounce(key, ms) {
    ms = ms || DEBOUNCE_MS;
    var now = Date.now();
    if (_lastEvent[key] && now - _lastEvent[key] < ms) return false;
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

  /* ── Web Vitals tracking ────────────────────────────── */
  function trackWebVitals() {
    if (typeof PerformanceObserver === "undefined") return;

    // LCP (Largest Contentful Paint)
    try {
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        if (entries.length > 0) {
          var last = entries[entries.length - 1];
          send(basePayload("web_vital", { metric: "LCP", value: Math.round(last.startTime) }));
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch (e) { /* unsupported */ }

    // FID (First Input Delay)
    try {
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          send(basePayload("web_vital", { metric: "FID", value: Math.round(entry.processingStart - entry.startTime) }));
        }
      }).observe({ type: "first-input", buffered: true });
    } catch (e) { /* unsupported */ }

    // CLS (Cumulative Layout Shift)
    try {
      var clsValue = 0;
      var clsEntries = [];
      new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var entry = list.getEntries()[i];
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
            clsEntries.push(entry);
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
      // Report CLS on page hide
      window.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") {
          send(basePayload("web_vital", { metric: "CLS", value: Math.round(clsValue * 1000) / 1000 }));
        }
      });
    } catch (e) { /* unsupported */ }

    // FCP (First Contentful Paint) — use "paint" type, filter by name
    try {
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].name === "first-contentful-paint") {
            send(basePayload("web_vital", { metric: "FCP", value: Math.round(entries[i].startTime) }));
            break;
          }
        }
      }).observe({ type: "paint", buffered: true });
    } catch (e) { /* unsupported */ }

    // TTFB (Time to First Byte)
    try {
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        if (entries.length > 0) {
          var nav = entries[0];
          send(basePayload("web_vital", {
            metric: "TTFB",
            value: Math.round(nav.responseStart - nav.requestStart)
          }));
        }
      }).observe({ type: "navigation", buffered: true });
    } catch (e) { /* unsupported */ }

    // INP (Interaction to Next Paint)
    try {
      var inpValue = 0;
      new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var entry = list.getEntries()[i];
          var duration = entry.duration;
          if (duration > inpValue) inpValue = duration;
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
      window.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") {
          send(basePayload("web_vital", { metric: "INP", value: Math.round(inpValue) }));
        }
      });
    } catch (e) { /* unsupported */ }
  }

  /* ── JS Error tracking ──────────────────────────────── */
  function trackErrors() {
    var _errorCount = 0;
    window.addEventListener("error", function (event) {
      _errorCount++;
      // Cap at 5 errors per session to avoid spam
      if (_errorCount > 5) return;
      send(basePayload("js_error", {
        message: (event.message || "Unknown error").substring(0, 200),
        filename: (event.filename || "").split("/").pop() || null,
        lineno: event.lineno || null,
        colno: event.colno || null
      }));
    });
    // Unhandled promise rejections
    window.addEventListener("unhandledrejection", function (event) {
      _errorCount++;
      if (_errorCount > 5) return;
      var reason = event.reason;
      var msg = (reason && reason.message) ? reason.message : String(reason);
      send(basePayload("js_error", {
        message: ("Promise: " + msg).substring(0, 200),
        filename: null,
        lineno: null,
        colno: null
      }));
    });
  }

  /* ── Print tracking ─────────────────────────────────── */
  function trackPrint() {
    window.addEventListener("beforeprint", function () {
      send(basePayload("print", {}));
    });
  }

  /* ── Form abandonment on page unload ────────────────── */
  function trackFormAbandonOnUnload() {
    window.addEventListener("beforeunload", function () {
      if (_formTouched) {
        // Count non-empty form fields as a rough measure
        var filled = _formFieldsFilled;
        if (filled > 0) {
          var payload = basePayload("form_abandon", { fields_filled: filled });
          var params = new URLSearchParams();
          params.append("data", JSON.stringify(payload));
          if (navigator.sendBeacon) {
            try { navigator.sendBeacon(TRACK_ENDPOINT, params); } catch (e) { /* noop */ }
          }
        }
      }
    });
  }

  /* ── Page-view (called once per session load) ───────── */
  function trackPageview() {
    if (!debounce("pageview")) return;
    send(basePayload("pageview"));
    ensureScrollListener();
    startHeartbeat();
    trackWebVitals();
    trackErrors();
    trackPrint();
    trackFormAbandonOnUnload();
  }

  /* ── Unload: final heartbeat + beacon ───────────────── */
  window.addEventListener("beforeunload", function () {
    stopHeartbeat();
    var payload = basePayload("pageview_duration", { time_on_page: Math.round((Date.now() - _started) / 1000) });
    var params = new URLSearchParams();
    params.append("data", JSON.stringify(payload));
    if (navigator.sendBeacon) {
      try { navigator.sendBeacon(TRACK_ENDPOINT, params); } catch (e) { /* noop */ }
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
     * Track section visibility (call when a section enters viewport).
     * @param {string} sectionName — e.g. "galeria", "ficha-tecnica", "faq"
     */
    trackSectionView: function (sectionName) {
      if (!sectionName || !debounce("section_view:" + sectionName, 5000)) return;
      send(basePayload("section_view", { section: sectionName }));
    },

    /**
     * Track form field focus.
     * @param {string} fieldName — e.g. "name", "phone", "email"
     */
    trackFormFocus: function (fieldName) {
      _formTouched = true;
      send(basePayload("form_focus", { field: fieldName }));
    },

    /**
     * Track form field blur with time spent.
     * @param {string} fieldName
     * @param {number} timeSpentMs — time in milliseconds the field was focused
     */
    trackFormBlur: function (fieldName, timeSpentMs) {
      send(basePayload("form_blur", { field: fieldName, time_spent_ms: Math.round(timeSpentMs) }));
    },

    /**
     * Manually track form abandonment (e.g. exit intent while form is open).
     * @param {number} fieldsFilled — count of non-empty fields
     */
    trackFormAbandon: function (fieldsFilled) {
      send(basePayload("form_abandon", { fields_filled: fieldsFilled }));
    },

    /**
     * Track gallery image interaction.
     * @param {number} imageIndex — zero-based index of the image
     * @param {number} totalImages — total number of images
     */
    trackGalleryClick: function (imageIndex, totalImages) {
      send(basePayload("gallery_click", { image_index: imageIndex, total_images: totalImages }));
    },

    /**
     * Track FAQ accordion open.
     * @param {number} questionIndex — zero-based index of the FAQ item
     * @param {string} questionText — the question text (truncated to 100 chars internally)
     */
    trackFAQOpen: function (questionIndex, questionText) {
      send(basePayload("faq_open", {
        question_index: questionIndex,
        question: (questionText || "").substring(0, 100)
      }));
    },

    /**
     * Track exit intent (call when user's mouse leaves viewport on desktop).
     */
    trackExitIntent: function () {
      if (!debounce("exit_intent", 10000)) return; // max once per 10s
      send(basePayload("exit_intent", { time_on_page: Math.round((Date.now() - _started) / 1000) }));
    },

    /**
     * Track custom field interaction (for dynamic form fields).
     * @param {string} fieldName — custom field name
     * @param {string} action — "focus" or "blur"
     * @param {number} [timeSpentMs]
     */
    trackCustomField: function (fieldName, action, timeSpentMs) {
      if (action === "focus") {
        _formTouched = true;
        send(basePayload("form_focus", { field: fieldName }));
      } else if (action === "blur") {
        send(basePayload("form_blur", { field: fieldName, time_spent_ms: Math.round(timeSpentMs || 0) }));
      }
    },

    /**
     * Update internal form field count (for abandonment tracking).
     * Call this whenever a form field value changes.
     * @param {number} count — number of non-empty fields
     */
    _setFormFieldsFilled: function (count) {
      _formFieldsFilled = count;
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