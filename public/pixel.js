/*!
 * CRM Pixel v3 — Complete tracking for landing pages
 * Embed: <script src="pixel.js" data-site-id="SITE_ID"></script>
 *
 * Auto-tracks: pageview, scroll depth, heartbeat, pageview_duration,
 *              web vitals (LCP/FID/CLS/FCP/TTFB/INP), JS errors, print,
 *              timezone, language, connection type, engaged_time.
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
 *   .trackCTA(id, text, sec, pos)— fire cta_click event
 *   .trackFormView(id)           — fire form_view event
 *   .trackFormSubmitAttempt(id)  — fire form_submit_attempt event
 *   .trackFormSubmitError(id, e) — fire form_submit_error event
 *   .diagnose()                  — tracking diagnostic mode
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
  var HEARTBEAT_INTERVAL = 30000;
  var VERSION = "3.0.0";

  /* ── Engaged time thresholds (seconds) ─────────────── */
  var ENGAGED_THRESHOLDS = [30, 60, 120, 180];
  var _engagedFired = {};

  /* ── Event queue for offline/retry ──────────────────── */
  var _eventQueue = [];
  var _queueProcessing = false;
  var MAX_QUEUE_SIZE = 50;

  /* ── Diagnostics ────────────────────────────────────── */
  var _diag = {
    events_sent: 0,
    events_confirmed: 0,
    events_failed: 0,
    events_pending: 0,
    events_queued: 0,
    http_errors: [],
    js_errors: [],
    start_time: Date.now()
  };

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
  var vidIsNew = !vid;
  if (vidIsNew) { vid = uuid(); lsSet(LS_VID, vid); }

  var sid = ssGet(SS_SID);
  var isNewSession = !sid;
  if (isNewSession) { sid = uuid(); ssSet(SS_SID, sid); }

  /* ── Script tag / site-id ───────────────────────────── */
  var me = document.currentScript || (function () {
    var s = document.getElementsByTagName("script");
    for (var i = s.length - 1; i >= 0; i--) {
      if ((s[i].src || "").indexOf("pixel.js") !== -1) return s[i];
    }
    return s[s.length - 1];
  })();
  var siteId = (me && me.getAttribute("data-site-id")) || "default";

  /* ── UTM parser (includes utm_id) ───────────────────── */
  function parseUTM() {
    var q = location.search.substring(1).split("&");
    var utm = {};
    for (var i = 0; i < q.length; i++) {
      var p = q[i].split("=");
      try {
        var k = decodeURIComponent(p[0]);
        if (k.indexOf("utm_") === 0 && p[1]) {
          utm[k] = decodeURIComponent(p[1].replace(/\+/g, " "));
        }
      } catch (e) { /* Malformed URI component — skip */ }
    }
    return utm;
  }

  var utmParams = parseUTM();

  /* ── UTM first-touch persistence ───────────────────── */
  (function persistUTM() {
    var hasUTM = utmParams.utm_source || utmParams.utm_campaign;
    if (!hasUTM) {
      try {
        var saved = lsGet('_crmpx_utm_first');
        if (saved) {
          var parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') utmParams = parsed;
        }
      } catch (e) { /* noop */ }
    } else {
      try {
        if (!lsGet('_crmpx_utm_first')) {
          lsSet('_crmpx_utm_first', JSON.stringify(utmParams));
        }
      } catch (e) { /* noop */ }
    }
  })();

  /* ── Sanitize URL: strip click IDs ──────────────────── */
  (function sanitizeURL() {
    try {
      if (location.search.indexOf('fbclid=') !== -1 || location.search.indexOf('gclid=') !== -1 || location.search.indexOf('igshid=') !== -1) {
        var clean = location.pathname + location.search.replace(/[?&](fbclid|gclid|igshid)=[^&]*/gi, '').replace(/^&/, '?').replace(/[?&]$/, '');
        history.replaceState(null, '', clean + location.hash);
      }
    } catch (e) { /* noop */ }
  })();

  /* ── Visitor context ────────────────────────────────── */
  var _visitorCtx = {};
  try { _visitorCtx.timezone = (Intl && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || null; } catch (e) {}
  _visitorCtx.language = navigator.language || null;
  try { _visitorCtx.connection = (navigator.connection && navigator.connection.effectiveType) || null; } catch (e) {}
  _visitorCtx.dnt = (typeof navigator.doNotTrack !== "undefined") ? navigator.doNotTrack : null;

  /* ── Common payload builder ─────────────────────────── */
  var leadId = "";
  var _formTouched = false;
  var _formFieldValues = {};

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
      utm_id: utmParams.utm_id || undefined,
      timezone: _visitorCtx.timezone || undefined,
      language: _visitorCtx.language || undefined,
      connection: _visitorCtx.connection || undefined,
      geo_hint: _visitorCtx.timezone || undefined,
      ts: Date.now()
    };
    if (typeof Cookiebot !== "undefined") d.cookie_consent = Cookiebot.consented ? 1 : 0;
    else if (typeof OnetrustActiveGroups !== "undefined") d.cookie_consent = OnetrustActiveGroups.indexOf("C0002") !== -1 ? 1 : 0;
    else if (navigator.cookieEnabled) d.cookie_consent = 1;
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) d[k] = extra[k];
    var out = {};
    for (var j in d) if (d[j] !== undefined) out[j] = d[j];
    return out;
  }

  /* ── Transport: sendBeacon → fetch, with queue ──────── */
  function send(payload) {
    var json = JSON.stringify(payload);
    _diag.events_pending++;

    if (navigator.sendBeacon) {
      try {
        var params = new URLSearchParams();
        params.append("data", json);
        var sent = navigator.sendBeacon(TRACK_ENDPOINT, params);
        if (sent) {
          _diag.events_sent++;
          _diag.events_pending--;
          return;
        }
      } catch (e) { /* fallback */ }
    }

    // Queue for retry via fetch
    if (_eventQueue.length < MAX_QUEUE_SIZE) {
      _eventQueue.push(json);
      _diag.events_queued++;
    }
    processQueue();
  }

  function processQueue() {
    if (_queueProcessing || _eventQueue.length === 0) return;
    _queueProcessing = true;
    var json = _eventQueue.shift();
    try {
      var data = "data=" + encodeURIComponent(json);
      fetch(TRACK_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: data,
        keepalive: true,
        credentials: "omit"
      }).then(function() {
        _diag.events_sent++;
        _diag.events_confirmed++;
        _diag.events_pending--;
        _queueProcessing = false;
        processQueue();
      }).catch(function() {
        _diag.events_failed++;
        _diag.events_pending--;
        _queueProcessing = false;
        // Retry once after 3s
        setTimeout(function() {
          _eventQueue.unshift(json);
          processQueue();
        }, 3000);
      });
    } catch (e) {
      _diag.events_failed++;
      _diag.events_pending--;
      _queueProcessing = false;
    }
  }

  /* ── Pixel URL builder ──────────────────────────────── */
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

  /* ── Engaged time thresholds ────────────────────────── */
  function startEngagedTimeTracking() {
    for (var i = 0; i < ENGAGED_THRESHOLDS.length; i++) {
      (function(threshold) {
        setTimeout(function() {
          if (!_engagedFired[threshold]) {
            _engagedFired[threshold] = true;
            send(basePayload("engaged_time", { seconds: threshold }));
          }
        }, threshold * 1000);
      })(ENGAGED_THRESHOLDS[i]);
    }
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

    try {
      new PerformanceObserver(function (list) {
        try {
          var entries = list.getEntries();
          if (entries.length > 0) {
            var last = entries[entries.length - 1];
            send(basePayload("web_vital", { metric: "LCP", value: Math.round(last.startTime) }));
          }
        } catch (e) {}
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch (e) {}

    try {
      new PerformanceObserver(function (list) {
        try {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            send(basePayload("web_vital", { metric: "FID", value: Math.round(entry.processingStart - entry.startTime) }));
          }
        } catch (e) {}
      }).observe({ type: "first-input", buffered: true });
    } catch (e) {}

    try {
      var clsValue = 0;
      new PerformanceObserver(function (list) {
        try {
          for (var i = 0; i < list.getEntries().length; i++) {
            var entry = list.getEntries()[i];
            if (!entry.hadRecentInput) clsValue += entry.value;
          }
        } catch (e) {}
      }).observe({ type: "layout-shift", buffered: true });
      window.addEventListener("visibilitychange", function () {
        try {
          if (document.visibilityState === "hidden") {
            send(basePayload("web_vital", { metric: "CLS", value: Math.round(clsValue * 1000) / 1000 }));
          }
        } catch (e) {}
      });
    } catch (e) {}

    try {
      new PerformanceObserver(function (list) {
        try {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].name === "first-contentful-paint") {
              send(basePayload("web_vital", { metric: "FCP", value: Math.round(entries[i].startTime) }));
              break;
            }
          }
        } catch (e) {}
      }).observe({ type: "paint", buffered: true });
    } catch (e) {}

    try {
      new PerformanceObserver(function (list) {
        try {
          var entries = list.getEntries();
          if (entries.length > 0) {
            var nav = entries[0];
            send(basePayload("web_vital", { metric: "TTFB", value: Math.round(nav.responseStart - nav.requestStart) }));
          }
        } catch (e) {}
      }).observe({ type: "navigation", buffered: true });
    } catch (e) {}

    try {
      var inpValue = 0;
      new PerformanceObserver(function (list) {
        try {
          for (var i = 0; i < list.getEntries().length; i++) {
            var duration = list.getEntries()[i].duration;
            if (duration > inpValue) inpValue = duration;
          }
        } catch (e) {}
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
      window.addEventListener("visibilitychange", function () {
        try {
          if (document.visibilityState === "hidden") {
            send(basePayload("web_vital", { metric: "INP", value: Math.round(inpValue) }));
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  /* ── JS Error tracking ──────────────────────────────── */
  function trackErrors() {
    var _errorCount = 0;
    var _thirdPartyPatterns = [
      /^Script error\.?$/i, /^Uncaught Script error\.?$/i, /^Uncaught Error: Script error/i,
      /fbevents/i, /fbq/i, /facebook/i, /Meta Pixel/i,
      /net\.facebook/i, /connect\.facebook/i, /staticxx\.facebook/i, /static\.facebook/i,
      /atndmt\.com/i, /browsi\.com/i, /cdninstagram\.com/i, /fbcdn\.net/i, /ig\.com/i, /instagram\.com/i,
      /cross-origin/i, /CORS/i,
    ];
    function isThirdParty(msg, filename) {
      for (var i = 0; i < _thirdPartyPatterns.length; i++) {
        if (_thirdPartyPatterns[i].test(msg) || (filename && _thirdPartyPatterns[i].test(filename))) return true;
      }
      return false;
    }
    window.addEventListener("error", function (event) {
      if (isThirdParty(event.message || "", event.filename || "")) return;
      _errorCount++;
      if (_errorCount > 5) return;
      _diag.js_errors.push({ message: (event.message || "Unknown").substring(0, 200), line: event.lineno, ts: Date.now() });
      send(basePayload("js_error", {
        message: (event.message || "Unknown error").substring(0, 200),
        filename: (event.filename || "").split("/").pop() || null,
        lineno: event.lineno || null,
        colno: event.colno || null
      }));
    });
    window.addEventListener("unhandledrejection", function (event) {
      var reason = event.reason;
      var msg = (reason && reason.message) ? reason.message : String(reason);
      if (isThirdParty(msg, "")) return;
      _errorCount++;
      if (_errorCount > 5) return;
      _diag.js_errors.push({ message: ("Promise: " + msg).substring(0, 200), ts: Date.now() });
      send(basePayload("js_error", { message: ("Promise: " + msg).substring(0, 200), filename: null, lineno: null, colno: null }));
    });
  }

  /* ── Print tracking ─────────────────────────────────── */
  function trackPrint() {
    window.addEventListener("beforeprint", function () { send(basePayload("print", {})); });
  }

  /* ── Form abandonment on page unload ────────────────── */
  function countFilledFields() {
    if (_formFieldValues._legacyCount !== undefined) return _formFieldValues._legacyCount;
    var count = 0;
    for (var k in _formFieldValues) {
      if (k === '_legacyCount') continue;
      var v = _formFieldValues[k];
      if (v && typeof v === 'string' ? v.trim().length > 0 : true) count++;
    }
    return count;
  }
  function getFilledFieldNames() {
    if (_formFieldValues._legacyCount !== undefined) return [];
    var names = [];
    for (var k in _formFieldValues) {
      if (k === '_legacyCount') continue;
      var v = _formFieldValues[k];
      if (v && typeof v === 'string' ? v.trim().length > 0 : true) names.push(k);
    }
    return names;
  }
  function trackFormAbandonOnUnload() {
    window.addEventListener("beforeunload", function () {
      if (_formTouched) {
        var filled = countFilledFields();
        var filledNames = getFilledFieldNames();
        if (filled > 0) {
          var meta = { fields_filled: filled };
          if (filledNames.length > 0) meta.filled_fields = filledNames;
          var payload = basePayload("form_abandon", meta);
          var params = new URLSearchParams();
          params.append("data", JSON.stringify(payload));
          if (navigator.sendBeacon) { try { navigator.sendBeacon(TRACK_ENDPOINT, params); } catch (e) {} }
        }
      }
    });
  }

  /* ── Page-view (called once per session load) ───────── */
  function trackPageview() {
    if (!debounce("pageview")) return;
    send(basePayload("pageview"));
    if (isNewSession) {
      send(basePayload("session_start", { is_new_visitor: vidIsNew ? 1 : 0 }));
    }
    ensureScrollListener();
    startHeartbeat();
    startEngagedTimeTracking();
    trackWebVitals();
    trackErrors();
    trackPrint();
    trackFormAbandonOnUnload();
  }

  /* ── Unload: final heartbeat + duration + session_end ── */
  window.addEventListener("beforeunload", function () {
    stopHeartbeat();
    var elapsed = Math.round((Date.now() - _started) / 1000);
    var payload = basePayload("pageview_duration", { time_on_page: elapsed });
    var params = new URLSearchParams();
    params.append("data", JSON.stringify(payload));
    if (navigator.sendBeacon) { try { navigator.sendBeacon(TRACK_ENDPOINT, params); } catch (e) {} }
    // session_end
    var endPayload = basePayload("session_end", { time_on_page: elapsed });
    var endParams = new URLSearchParams();
    endParams.append("data", JSON.stringify(endPayload));
    if (navigator.sendBeacon) { try { navigator.sendBeacon(TRACK_ENDPOINT, endParams); } catch (e) {} }
  });

  /* ── Performance Diagnostic ──────────────────────────── */
  function runPerformanceDiagnostic() {
    setTimeout(function () {
      try {
        var issues = [];
        var imgs = document.getElementsByTagName("img");
        var imgsWithoutDimensions = 0;
        var slowImages = 0;
        for (var k = 0; k < imgs.length; k++) {
          var img = imgs[k];
          if (!img.width && !img.height && !img.getAttribute("width") && !img.getAttribute("height")) imgsWithoutDimensions++;
          if (img.naturalWidth > 0 && img.naturalWidth > 1200 && !img.hasAttribute("loading")) slowImages++;
        }
        if (imgsWithoutDimensions > 3) issues.push({ severity: "medium", code: "images_no_dimensions", message: imgsWithoutDimensions + " imagens sem dimensoes (CLS risk)" });
        if (slowImages > 2) issues.push({ severity: "medium", code: "images_no_lazy", message: slowImages + " imagens grandes sem lazy loading" });

        var bodyScripts = document.body ? document.body.getElementsByTagName("script") : [];
        var syncBodyScripts = 0;
        for (var m = 0; m < Math.min(bodyScripts.length, 20); m++) {
          var bs = bodyScripts[m];
          if (!bs.async && !bs.defer && bs.src && bs.src.indexOf("pixel.js") === -1) syncBodyScripts++;
        }
        if (syncBodyScripts > 2) issues.push({ severity: "low", code: "sync_body_scripts", message: syncBodyScripts + " scripts sincronos no body" });

        var domSize = document.querySelectorAll("*").length;
        if (domSize > 3000) issues.push({ severity: "low", code: "large_dom", message: "DOM com " + domSize + " elementos" });

        if (issues.length > 0) {
          send(basePayload("performance_diagnostic", { issues_count: issues.length, issues: issues, dom_size: domSize, image_count: imgs.length }));
        }
      } catch(e) {}
    }, 5000);
  }

  /* ── Diagnostic Mode ────────────────────────────────── */
  function diagnose() {
    var elapsed = Math.round((Date.now() - _started) / 1000);
    var report = {
 tracking_version: VERSION,
      visitor_id: vid,
      session_id: sid,
      is_new_visitor: vidIsNew,
      is_new_session: isNewSession,
      site_id: siteId,
      url: location.href,
      referrer: document.referrer || null,
      timestamp: new Date().toISOString(),
      uptime_seconds: elapsed,
      utm: utmParams,
      events: {
        sent: _diag.events_sent,
        confirmed: _diag.events_confirmed,
        failed: _diag.events_failed,
        pending: _diag.events_pending,
        queued: _diag.events_queued
      },
      js_errors_count: _diag.js_errors.length,
      js_errors: _diag.js_errors.slice(-5),
      scroll_fired: _scrollFired,
      engaged_fired: _engagedFired,
      form_touched: _formTouched,
      lead_id: leadId || null,
      queue_size: _eventQueue.length,
      heartbeat_active: !!_heartbeatTimer,
      scroll_listener_active: scrollActive,
      sendBeacon_available: !!navigator.sendBeacon
    };
    console.log("%c[CRM PIXEL DIAGNOSTIC]", "color: #33492F; font-weight: bold; font-size: 14px;");
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  /* ── Public API ─────────────────────────────────────── */
  var CRMPIXEL = {
    track: function (name, data) {
      send(basePayload(name, data));
    },
    identify: function (id) {
      if (!id) return;
      leadId = id;
      send(basePayload("identify", { lead_id: id }));
    },
    trackSectionView: function (sectionName) {
      if (!sectionName || !debounce("section_view:" + sectionName, 5000)) return;
      send(basePayload("section_view", { section: sectionName }));
    },
    trackFormFocus: function (fieldName) {
      _formTouched = true;
      send(basePayload("form_focus", { field: fieldName }));
    },
    trackFormBlur: function (fieldName, timeSpentMs) {
      send(basePayload("form_blur", { field: fieldName, time_spent_ms: Math.round(timeSpentMs) }));
    },
    trackFormAbandon: function (fieldsFilled) {
      send(basePayload("form_abandon", { fields_filled: fieldsFilled }));
    },
    trackGalleryClick: function (imageIndex, totalImages) {
      send(basePayload("gallery_click", { image_index: imageIndex, total_images: totalImages }));
    },
    trackFAQOpen: function (questionIndex, questionText) {
      send(basePayload("faq_open", { question_index: questionIndex, question: (questionText || "").substring(0, 100) }));
    },
    trackExitIntent: function () {
      if (!debounce("exit_intent", 10000)) return;
      send(basePayload("exit_intent", { time_on_page: Math.round((Date.now() - _started) / 1000) }));
    },
    /** Structured CTA click tracking */
    trackCTA: function (ctaId, ctaText, section, position) {
      send(basePayload("cta_click", {
        cta_id: ctaId || null,
        cta_text: (ctaText || "").substring(0, 100),
        section: section || null,
        position: position || null
      }));
    },
    /** Form view event */
    trackFormView: function (formId) {
      if (!debounce("form_view:" + (formId || "default"), 5000)) return;
      send(basePayload("form_view", { form_id: formId || null }));
    },
    /** Form submit attempt */
    trackFormSubmitAttempt: function (formId) {
      send(basePayload("form_submit_attempt", { form_id: formId || null }));
    },
    /** Form submit error */
    trackFormSubmitError: function (formId, errorMessage) {
      send(basePayload("form_submit_error", {
        form_id: formId || null,
        error: (errorMessage || "").substring(0, 200)
      }));
    },
    trackCustomField: function (fieldName, action, timeSpentMs) {
      if (action === "focus") {
        _formTouched = true;
        send(basePayload("form_focus", { field: fieldName }));
      } else if (action === "blur") {
        send(basePayload("form_blur", { field: fieldName, time_spent_ms: Math.round(timeSpentMs || 0) }));
      }
    },
    _setFormFieldsFilled: function (countOrMap) {
      if (typeof countOrMap === 'number') {
        _formFieldValues = { _legacyCount: countOrMap };
      } else if (countOrMap && typeof countOrMap === 'object') {
        _formFieldValues = countOrMap;
      }
    },
    pixelURL: pixelURL,
    /** Diagnostic mode — returns + logs full tracking state */
    diagnose: diagnose,
    vid: vid,
    sid: sid
  };

  window.CRMPIXEL = CRMPIXEL;

  /* ── Boot ───────────────────────────────────────────── */
  if (document.readyState === "complete" || document.readyState === "interactive") {
    trackPageview();
    runPerformanceDiagnostic();
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      trackPageview();
      runPerformanceDiagnostic();
    });
  }
})();
