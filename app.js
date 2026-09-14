/* QR Converter — link <-> QR, entirely client-side. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ============================ shared ui ============================ */

  var toastEl = $('toast'), toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { /* private mode, blocked storage — not worth failing over */ }
    return null;
  }

  /* theme */
  var themeIcon = $('theme-icon');
  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-theme', mode);
      themeIcon.textContent = mode === 'dark' ? '☾' : '☀';
    } else {
      document.documentElement.removeAttribute('data-theme');
      themeIcon.textContent = '◐';
    }
  }
  applyTheme(store('qrc-theme'));
  $('theme-toggle').addEventListener('click', function () {
    var order = ['system', 'light', 'dark'];
    var current = document.documentElement.getAttribute('data-theme') || 'system';
    var next = order[(order.indexOf(current) + 1) % order.length];
    applyTheme(next);
    store('qrc-theme', next);
  });

  /* tabs */
  var tabs = [
    { tab: $('tab-encode'), panel: $('panel-encode') },
    { tab: $('tab-decode'), panel: $('panel-decode') }
  ];
  function selectTab(index) {
    tabs.forEach(function (t, i) {
      var on = i === index;
      t.tab.classList.toggle('is-active', on);
      t.tab.setAttribute('aria-selected', String(on));
      t.panel.classList.toggle('is-active', on);
    });
    if (index !== 1) stopCamera();
  }
  tabs.forEach(function (t, i) {
    t.tab.addEventListener('click', function () { selectTab(i); });
  });

  /* ============================ encode ============================ */

  var encInput = $('enc-input'),
      encEcc = $('enc-ecc'),
      encSize = $('enc-size'),
      encMargin = $('enc-margin'),
      encFg = $('enc-fg'),
      encBg = $('enc-bg'),
      encCanvas = $('enc-canvas'),
      encWrap = $('enc-preview-wrap'),
      encMeta = $('enc-meta'),
      encError = $('enc-error'),
      encSaveHint = $('enc-savehint'),
      btnPng = $('enc-png'),
      btnSvg = $('enc-svg'),
      btnCopy = $('enc-copy');

  var currentQR = null;           // qrcode-generator instance for the current text
  var DEFAULTS = { ecc: 'M', size: 512, margin: 4, fg: '#111318', bg: '#ffffff' };

  function encOptions() {
    return {
      ecc: encEcc.value,
      size: parseInt(encSize.value, 10),
      margin: parseInt(encMargin.value, 10),
      fg: encFg.value,
      bg: encBg.value
    };
  }

  function buildQR(text, ecc) {
    // Byte-mode payloads are encoded as UTF-8 so non-ASCII links survive the round trip.
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    var qr = qrcode(0, ecc);      // type 0 = pick the smallest version that fits
    qr.addData(text);
    qr.make();
    return qr;
  }

  function drawQR(qr, canvas, opts) {
    var count = qr.getModuleCount();
    var total = count + opts.margin * 2;
    // Integer module size keeps every module crisp; the canvas is then whatever
    // multiple of `total` lands closest to the requested pixel size.
    var cell = Math.max(1, Math.round(opts.size / total));
    var dim = cell * total;
    canvas.width = dim;
    canvas.height = dim;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = opts.fg;
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + opts.margin) * cell, (r + opts.margin) * cell, cell, cell);
        }
      }
    }
    return dim;
  }

  function qrToSvg(qr, opts) {
    var count = qr.getModuleCount();
    var total = count + opts.margin * 2;
    var path = [];
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          path.push('M' + (c + opts.margin) + ' ' + (r + opts.margin) + 'h1v1h-1z');
        }
      }
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + opts.size + '" height="' + opts.size +
      '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + opts.bg + '"/>' +
      '<path fill="' + opts.fg + '" d="' + path.join('') + '"/></svg>\n';
  }

  function contrastRatio(hexA, hexB) {
    function lum(hex) {
      var n = parseInt(hex.slice(1), 16);
      var ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }
    var a = lum(hexA), b = lum(hexB);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function renderEncode() {
    var text = encInput.value;
    var opts = encOptions();
    encError.hidden = true;

    if (!text) {
      currentQR = null;
      encWrap.classList.remove('has-content');
      encMeta.textContent = '';
      [btnPng, btnSvg, btnCopy].forEach(function (b) { b.disabled = true; });
      return;
    }

    try {
      currentQR = buildQR(text, opts.ecc);
    } catch (e) {
      currentQR = null;
      encWrap.classList.remove('has-content');
      encMeta.textContent = '';
      [btnPng, btnSvg, btnCopy].forEach(function (b) { b.disabled = true; });
      encError.textContent = 'Too much data for one QR code at error correction ' + opts.ecc +
        '. Shorten the text, or drop to a lower level.';
      encError.hidden = false;
      return;
    }

    var dim = drawQR(currentQR, encCanvas, opts);
    encWrap.classList.add('has-content');
    [btnPng, btnSvg, btnCopy].forEach(function (b) { b.disabled = false; });

    var count = currentQR.getModuleCount();
    var version = (count - 17) / 4;
    var bytes = new TextEncoder().encode(text).length;
    encMeta.textContent = 'Version ' + version + ' · ' + count + '×' + count + ' modules · ' +
      bytes + ' byte' + (bytes === 1 ? '' : 's') + ' · ' + dim + '×' + dim + ' px';

    // A scanner reads reflectance, so a weak dark/light contrast is the usual
    // reason a "pretty" QR code fails to scan.
    if (contrastRatio(opts.fg, opts.bg) < 4) {
      encError.textContent = 'Low contrast between the two colours — many scanners will fail to read this.';
      encError.hidden = false;
    } else if (opts.margin < 2) {
      encError.textContent = 'A quiet zone below 2 modules is outside the QR specification and often will not scan.';
      encError.hidden = false;
    }
  }

  var encTimer = null;
  function scheduleEncode() {
    clearTimeout(encTimer);
    encTimer = setTimeout(renderEncode, 90);
  }

  encInput.addEventListener('input', scheduleEncode);
  encEcc.addEventListener('change', renderEncode);
  [encFg, encBg].forEach(function (el) { el.addEventListener('input', scheduleEncode); });
  encSize.addEventListener('input', function () {
    $('enc-size-val').textContent = encSize.value + ' px';
    scheduleEncode();
  });
  encMargin.addEventListener('input', function () {
    $('enc-margin-val').textContent = encMargin.value + ' module' + (encMargin.value === '1' ? '' : 's');
    scheduleEncode();
  });
  $('enc-reset').addEventListener('click', function () {
    encEcc.value = DEFAULTS.ecc;
    encSize.value = DEFAULTS.size;
    encMargin.value = DEFAULTS.margin;
    encFg.value = DEFAULTS.fg;
    encBg.value = DEFAULTS.bg;
    $('enc-size-val').textContent = DEFAULTS.size + ' px';
    $('enc-margin-val').textContent = DEFAULTS.margin + ' modules';
    renderEncode();
  });

  function slugFor(text) {
    var name = text.trim();
    try {
      var u = new URL(name);
      name = u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '').replace(/\//g, '-');
    } catch (e) { /* not a URL — fall through to the raw text */ }
    name = name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    return 'qr-' + (name || 'code');
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    encSaveHint.hidden = false;
  }

  btnPng.addEventListener('click', function () {
    encCanvas.toBlob(function (blob) {
      if (blob) saveBlob(blob, slugFor(encInput.value) + '.png');
    }, 'image/png');
  });

  btnSvg.addEventListener('click', function () {
    if (!currentQR) return;
    var svg = qrToSvg(currentQR, encOptions());
    saveBlob(new Blob([svg], { type: 'image/svg+xml' }), slugFor(encInput.value) + '.svg');
  });

  btnCopy.addEventListener('click', function () {
    if (!navigator.clipboard || !window.ClipboardItem) {
      toast('This browser cannot copy images — use Download instead');
      return;
    }
    encCanvas.toBlob(function (blob) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(function () { toast('QR code copied'); })
        .catch(function () { toast('Copy was blocked — use Download instead'); });
    }, 'image/png');
  });

  /* ============================ decode ============================ */

  var dropzone = $('dropzone'),
      fileInput = $('file-input'),
      decCanvas = $('dec-canvas'),
      decWrap = $('dec-preview-wrap'),
      decResult = $('dec-result'),
      decText = $('dec-text'),
      decMeta = $('dec-meta'),
      decError = $('dec-error'),
      decBusy = $('dec-busy'),
      decWarn = $('dec-warn'),
      decOpen = $('dec-open');

  var MAX_WORK = 1400;   // longest edge fed to the detector, in pixels

  function imageDataAt(img, scale) {
    var base = Math.min(MAX_WORK, Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    var srcW = img.naturalWidth || img.width, srcH = img.naturalHeight || img.height;
    var k = (base / Math.max(srcW, srcH)) * scale;
    var w = Math.max(1, Math.round(srcW * k)), h = Math.max(1, Math.round(srcH * k));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);   // flatten transparency, which otherwise reads as black
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  /* A photograph of a printed code carries multiplicative illumination:
     observed = reflectance x illumination. Illumination varies slowly across
     the frame, so a heavy box blur estimates it; dividing it out leaves
     reflectance, which a single global (Otsu) threshold then separates.
     This recovers faded print and uneven lighting that jsQR's own binariser
     gives up on — measured to rescue faded codes under 4x and 8x light
     falloff, both of which fail without it. */
  function flatField(src) {
    var w = src.width, h = src.height, d = src.data, i;
    var gray = new Float32Array(w * h);
    for (i = 0; i < gray.length; i++) {
      gray[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
    }

    // Radius wide enough to blur past individual modules, narrow enough to
    // still track the lighting falloff.
    var illum = boxBlur(gray, w, h, Math.max(4, Math.round(Math.min(w, h) / 8)));

    var norm = new Float32Array(w * h), mn = Infinity, mx = -Infinity, v;
    for (i = 0; i < norm.length; i++) {
      v = gray[i] / Math.max(1, illum[i]);
      norm[i] = v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }

    var span = Math.max(1e-6, mx - mn);
    var hist = new Uint32Array(256), q = new Uint8Array(w * h);
    for (i = 0; i < q.length; i++) {
      q[i] = ((norm[i] - mn) / span * 255) | 0;
      hist[q[i]]++;
    }
    var t = otsuThreshold(hist, q.length);

    var out = new ImageData(w, h), o = out.data;
    for (i = 0; i < q.length; i++) {
      var val = q[i] > t ? 255 : 0;
      o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = val;
      o[i * 4 + 3] = 255;
    }
    return out;
  }

  /* Separable box blur via a sliding window — O(w*h) regardless of radius. */
  function boxBlur(g, w, h, r) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, sum, n, add, sub;
    for (y = 0; y < h; y++) {
      var row = y * w;
      sum = 0; n = 0;
      for (x = 0; x <= r && x < w; x++) { sum += g[row + x]; n++; }
      for (x = 0; x < w; x++) {
        tmp[row + x] = sum / n;
        add = x + r + 1; sub = x - r;
        if (add < w) { sum += g[row + add]; n++; }
        if (sub >= 0) { sum -= g[row + sub]; n--; }
      }
    }
    for (x = 0; x < w; x++) {
      sum = 0; n = 0;
      for (y = 0; y <= r && y < h; y++) { sum += tmp[y * w + x]; n++; }
      for (y = 0; y < h; y++) {
        out[y * w + x] = sum / n;
        add = y + r + 1; sub = y - r;
        if (add < h) { sum += tmp[add * w + x]; n++; }
        if (sub >= 0) { sum -= tmp[sub * w + x]; n--; }
      }
    }
    return out;
  }

  /* Otsu: the threshold maximising between-class variance. */
  function otsuThreshold(hist, total) {
    var sum = 0, i;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = 0, t = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; t = i; }
    }
    return t;
  }

  function idle() {
    return new Promise(function (r) { setTimeout(r, 0); });
  }

  /* Try progressively harder: native pass first (fast, handles most screenshots),
     then rescales, then an Otsu pass for the awkward photographs. */
  function decodeImage(img) {
    var scales = [1, 0.6, 1.5, 0.4];
    var chain = Promise.resolve(null);
    scales.forEach(function (s) {
      chain = chain.then(function (found) {
        if (found) return found;
        return idle().then(function () {
          var data;
          try { data = imageDataAt(img, s); } catch (e) { return null; }
          var hit = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
          if (hit) return { code: hit, data: data };
          if (s === 1 || s === 0.6) {
            var bin = flatField(data);
            var hit2 = jsQR(bin.data, bin.width, bin.height, { inversionAttempts: 'attemptBoth' });
            if (hit2) return { code: hit2, data: data };
          }
          return null;
        });
      });
    });
    return chain;
  }

  function drawDecodePreview(data, location) {
    decCanvas.width = data.width;
    decCanvas.height = data.height;
    var ctx = decCanvas.getContext('2d');
    ctx.putImageData(data, 0, 0);
    if (location) {
      var pts = [
        location.topLeftCorner, location.topRightCorner,
        location.bottomRightCorner, location.bottomLeftCorner
      ];
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = Math.max(2, data.width / 180);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.stroke();
    }
    decWrap.classList.add('has-content');
  }

  var OPENABLE = { 'http:': 1, 'https:': 1, 'mailto:': 1, 'tel:': 1 };

  function describe(text) {
    var url = null, note = '';
    try {
      url = new URL(text.trim());
    } catch (e) {
      if (/^www\.[^\s]+\.[a-z]{2,}/i.test(text.trim())) {
        try { url = new URL('https://' + text.trim()); note = 'no scheme in the code — assuming https'; } catch (e2) { url = null; }
      }
    }
    return { url: url, note: note };
  }

  function showResult(text, code) {
    decText.textContent = text;
    decResult.hidden = false;
    decError.hidden = true;
    decWarn.hidden = true;

    var parts = [];
    if (code && code.version) parts.push('QR version ' + code.version);
    parts.push(new TextEncoder().encode(text).length + ' bytes');

    var info = describe(text);
    if (info.url && OPENABLE[info.url.protocol]) {
      decOpen.href = info.url.href;
      decOpen.hidden = false;
      parts.push(info.url.protocol === 'http:' || info.url.protocol === 'https:'
        ? 'host ' + info.url.hostname
        : info.url.protocol.replace(':', '') + ' link');
      if (info.note) parts.push(info.note);

      var warnings = [];
      if (info.url.protocol === 'http:') warnings.push('This link is plain http, not https.');
      if (/(^|\.)xn--/i.test(info.url.hostname) || /[^\x00-\x7F]/.test(info.url.hostname)) {
        warnings.push('The host name uses non-ASCII characters, which can be used to imitate a familiar domain.');
      }
      if (info.url.href.length > 300) warnings.push('Unusually long link.');
      if (warnings.length) {
        decWarn.textContent = 'Check before opening: ' + warnings.join(' ');
        decWarn.hidden = false;
      }
    } else {
      decOpen.hidden = true;
      if (info.url) parts.push(info.url.protocol.replace(':', '') + ' payload');
      else parts.push('plain text');
    }
    decMeta.textContent = parts.join(' · ');
  }

  function failed(message) {
    decResult.hidden = true;
    decError.textContent = message;
    decError.hidden = false;
  }

  function handleImageSource(src) {
    decBusy.hidden = false;
    decError.hidden = true;
    decResult.hidden = true;

    var img = new Image();
    img.onload = function () {
      decodeImage(img).then(function (found) {
        decBusy.hidden = true;
        if (found) {
          drawDecodePreview(found.data, found.code.location);
          showResult(found.code.data, found.code);
        } else {
          try { drawDecodePreview(imageDataAt(img, 1), null); } catch (e) { /* tainted or oversized */ }
          failed('No QR code found in that image. Try a sharper or more tightly cropped shot — ' +
                 'the whole code plus a little white border should be visible.');
        }
        if (src.indexOf('blob:') === 0) URL.revokeObjectURL(src);
      });
    };
    img.onerror = function () {
      decBusy.hidden = true;
      failed('That file could not be opened as an image.');
      if (src.indexOf('blob:') === 0) URL.revokeObjectURL(src);
    };
    img.src = src;
  }

  function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      failed('That is not an image file.');
      return;
    }
    handleImageSource(URL.createObjectURL(file));
  }

  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () {
    handleFile(fileInput.files[0]);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.remove('is-over');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    var dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files.length) { handleFile(dt.files[0]); return; }
    var uri = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (uri) handleImageSource(uri);   // dragged straight from another browser tab
  });

  document.addEventListener('paste', function (e) {
    if (!e.clipboardData) return;
    var items = e.clipboardData.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        selectTab(1);
        handleFile(items[i].getAsFile());
        e.preventDefault();
        return;
      }
    }
  });

  $('dec-copy').addEventListener('click', function () {
    var text = decText.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { toast('Copied'); })
        .catch(function () { toast('Copy was blocked by the browser'); });
    } else {
      toast('Copy is unavailable in this browser');
    }
  });

  $('dec-toencode').addEventListener('click', function () {
    encInput.value = decText.textContent;
    renderEncode();
    selectTab(0);
    encInput.focus();
  });

  /* ---------- camera ---------- */

  var camWrap = $('cam-wrap'),
      camVideo = $('cam-video'),
      camStatus = $('cam-status'),
      camStream = null,
      camRaf = null,
      camCanvas = document.createElement('canvas');

  function stopCamera() {
    if (camRaf) { cancelAnimationFrame(camRaf); camRaf = null; }
    if (camStream) {
      camStream.getTracks().forEach(function (t) { t.stop(); });
      camStream = null;
    }
    camVideo.srcObject = null;
    camWrap.hidden = true;
    $('cam-start').hidden = false;
  }

  function scanFrame() {
    camRaf = requestAnimationFrame(scanFrame);
    if (camVideo.readyState !== camVideo.HAVE_ENOUGH_DATA) return;

    var vw = camVideo.videoWidth, vh = camVideo.videoHeight;
    if (!vw || !vh) return;
    var k = Math.min(1, 640 / Math.max(vw, vh));
    var w = Math.round(vw * k), h = Math.round(vh * k);
    camCanvas.width = w; camCanvas.height = h;
    var ctx = camCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(camVideo, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h);
    var hit = jsQR(data.data, w, h, { inversionAttempts: 'dontInvert' });
    if (hit) {
      drawDecodePreview(data, hit.location);
      showResult(hit.data, hit);
      stopCamera();
      toast('QR code found');
    }
  }

  $('cam-start').addEventListener('click', function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      failed('This browser will not give page access to a camera. ' +
             'Camera access needs https or localhost — opening the file directly often blocks it.');
      return;
    }
    $('cam-start').hidden = true;
    camWrap.hidden = false;
    camStatus.textContent = 'Starting the camera…';
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (stream) {
      camStream = stream;
      camVideo.srcObject = stream;
      return camVideo.play();
    }).then(function () {
      camStatus.textContent = 'Point the camera at a QR code…';
      camRaf = requestAnimationFrame(scanFrame);
    }).catch(function (err) {
      stopCamera();
      failed('The camera could not be started (' + (err && err.name ? err.name : 'unknown error') + '). ' +
             'Camera access needs https or localhost, plus your permission.');
    });
  });

  $('cam-stop').addEventListener('click', stopCamera);
  window.addEventListener('pagehide', stopCamera);

  /* ============================ start ============================ */

  var initial = new URLSearchParams(location.search).get('text');
  if (initial) encInput.value = initial;
  renderEncode();
  encInput.focus();
})();
