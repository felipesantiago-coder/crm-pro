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
    // Fallback: find pixel.js by src attribute
    var s = document.getElementsByTagName("script");
    for (var i = s.length - 1; i >= 0; i--) {
      if ((s[i].src || "").indexOf("pixel.js") !== -1) return s[i];
    }
    return s[s.length - 1];
  })();
  var siteId = (me && me.getAttribute("data-site-id")) || "default";

  /* ── UTM parser ─────────────────────────────────────── */
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
      } catch (e) {
        /* Malformed URI component — skip this parameter */
      }
    }
    return utm;
  }

  var utmParams = parseUTM();

  /* ── UTM first-touch persistence ───────────────────── */
  (function persistUTM() {
    var hasUTM = utmParams.utm_source || utmParams.utm_campaign;
    if (!hasUTM) {
      // No UTM in current URL — restore from localStorage
      try {
        var saved = lsGet('_crmpx_utm_first');
        if (saved) {
          var parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') utmParams = parsed;
        }
      } catch (e) { /* noop */ }
    } else {
      // Save first-touch UTM (don't overwrite)
      try {
        if (!lsGet('_crmpx_utm_first')) {
          lsSet('_crmpx_utm_first', JSON.stringify(utmParams));
        }
      } catch (e) { /* noop */ }
    }
  })();

  /* ── Sanitize URL: strip fbclid/gclid click IDs to prevent truncation ── */
  (function sanitizeURL() {
    try {
      if (location.search.indexOf('fbclid=') !== -1 || location.search.indexOf('gclid=') !== -1 || location.search.indexOf('igshid=') !== -1) {
        var clean = location.pathname + location.search.replace(/[?&](fbclid|gclid|igshid)=[^&]*/gi, '').replace(/^&/, '?').replace(/[?&]$/, '');
        history.replaceState(null, '', clean + location.hash);
      }
    } catch (e) { /* noop */ }
  })();

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
  var _formFieldValues = {}; // track all form field values for accurate abandonment count

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
      // Include timezone-based geo hint for when IP geo fails (e.g. IG IAB)
      geo_hint: _visitorCtx.timezone || undefined,
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
    // Known third-party error patterns to suppress (reduce noise from Meta Pixel, IG IAB, etc.)
    var _thirdPartyPatterns = [
      /^Script error\.?$/i,
      /fbevents/i,
      /fbq/i,
      /facebook/i,
      /Meta Pixel/i,
      /net\.facebook/i,
      /connect\.facebook/i,
      // Instagram In-App Browser specific
      /atndmt\.com/i,
    ];
    function isThirdParty(msg, filename) {
      for (var i = 0; i < _thirdPartyPatterns.length; i++) {
        if (_thirdPartyPatterns[i].test(msg) || (filename && _thirdPartyPatterns[i].test(filename))) return true;
      }
      return false;
    }

    window.addEventListener("error", function (event) {
      // Suppress known third-party script errors (Meta Pixel, etc.)
      if (isThirdParty(event.message || "", event.filename || "")) return;
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
      var reason = event.reason;
      var msg = (reason && reason.message) ? reason.message : String(reason);
      // Suppress known third-party promise errors
      if (isThirdParty(msg, "")) return;
      _errorCount++;
      if (_errorCount > 5) return;
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

  /* ── Performance Diagnostic (runs once after page load) ── */
  function runPerformanceDiagnostic() {
    setTimeout(function () {
      try {
      var issues = [];

      // Check for missing jQuery (common issue on external LPs)
      if (typeof window.jQuery === "undefined" && typeof window.$ === "undefined") {
        // Check if any script references $ or jQuery
        var scripts = document.getElementsByTagName("script");
        var needsJQuery = false;
        for (var i = 0; i < scripts.length; i++) {
          var src = scripts[i].src || "";
          var inline = scripts[i].textContent || "";
          if (src.indexOf("main.js") !== -1 || src.indexOf("gallery") !== -1) {
            if (inline.indexOf("$") !== -1 || inline.indexOf("jQuery") !== -1) {
              needsJQuery = true;
              break;
            }
          }
        }
        // Also check by looking for script srcs that might need jQuery
        if (!needsJQuery) {
          for (var j = 0; j < scripts.length; j++) {
            var s = scripts[j];
            if ((s.textContent || "").indexOf("$(") !== -1 && (s.textContent || "").indexOf("ready") !== -1) {
              needsJQuery = true;
              break;
            }
          }
        }
        if (needsJQuery) {
          issues.push({
            severity: "high",
            code: "missing_jquery",
            message: "jQuery ($) nao carregado, mas scripts da pagina tentam usa-lo. Mova o jQuery para o <head> ou antes dos scripts que dependem dele."
          });
        }
      }

      // Check for images without dimensions (causes CLS)
      var imgs = document.getElementsByTagName("img");
      var imgsWithoutDimensions = 0;
      var slowImages = 0;
      for (var k = 0; k < imgs.length; k++) {
        var img = imgs[k];
        if (!img.width && !img.height && !img.getAttribute("width") && !img.getAttribute("height")) {
          imgsWithoutDimensions++;
        }
        // Check natural dimensions vs display dimensions for slow-loading images
        if (img.naturalWidth > 0 && img.naturalWidth > 1200 && !img.hasAttribute("loading")) {
          slowImages++;
        }
      }
      if (imgsWithoutDimensions > 3) {
        issues.push({
          severity: "medium",
          code: "images_no_dimensions",
          message: imgsWithoutDimensions + " imagens sem dimensoes definidas (width/height). Isso causa CLS. Adicione atributos width e height em todas as imagens."
        });
      }
      if (slowImages > 2) {
        issues.push({
          severity: "medium",
          code: "images_no_lazy",
          message: slowImages + " imagens grandes sem lazy loading. Adicione loading=\"lazy\" nas imagens abaixo do fold."
        });
      }

      // Check for render-blocking scripts in body (scripts without async/defer before main content)
      var headScripts = document.head ? document.head.getElementsByTagName("script") : [];
      var bodyScripts = document.body ? document.body.getElementsByTagName("script") : [];
      var syncBodyScripts = 0;
      for (var m = 0; m < Math.min(bodyScripts.length, 20); m++) {
        var bs = bodyScripts[m];
        if (!bs.async && !bs.defer && bs.src && bs.src.indexOf("pixel.js") === -1) {
          syncBodyScripts++;
        }
      }
      if (syncBodyScripts > 2) {
        issues.push({
          severity: "low",
          code: "sync_body_scripts",
          message: syncBodyScripts + " scripts sincronos no body. Considere adicionar async/defer para nao bloquear a renderizacao."
        });
      }

      // Check for large DOM size
      var domSize = document.querySelectorAll("*").length;
      if (domSize > 3000) {
        issues.push({
          severity: "low",
          code: "large_dom",
          message: "DOM com " + domSize + " elementos. Considere simplificar para melhorar a performance de renderizacao."
        });
      }

      // Report diagnostic results
      if (issues.length > 0) {
        send(basePayload("performance_diagnostic", {
          issues_count: issues.length,
          issues: issues,
          dom_size: domSize,
          image_count: imgs.length
        }));
      }
      } catch(e) { /* diagnostic errors are non-critical */ }
    }, 5000); // Run 5s after page load to catch deferred errors
  }

  /* ──   /* ── Public API ─────────────────────────────────────── */
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
     * Update internal form field values (for abandonment tracking).
     * Call this whenever a form field value changes.
     * @param {number} count — number of non-empty fields (legacy signature)
     *     OR
     * @param {object} fieldValues — { fieldName: value, ... } map of all form fields
     *
     * Supports two calling conventions:
     *   Legacy:  _setFormFieldsFilled(3)
     *   Modern:  _setFormFieldsFilled({ name: 'Joao', phone: '11999...', email: '', customField: 'value' })
     */
    _setFormFieldsFilled: function (countOrMap) {
      if (typeof countOrMap === 'number') {
        // Legacy: just store the count
        _formFieldValues = { _legacyCount: countOrMap };
      } else if (countOrMap && typeof countOrMap === 'object') {
        // Modern: store field values, count non-empty
        _formFieldValues = countOrMap;
      }
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
    runPerformanceDiagnostic();
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      trackPageview();
      runPerformanceDiagnostic();
    });
  }
})();