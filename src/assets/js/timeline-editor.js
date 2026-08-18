/* =============================================================================
   Timeline editor — author-only, loaded solely when ?edit is in the URL.

   The site is static: there is no server to save to. Edits live in this browser
   (and in localStorage so a refresh doesn't lose them) until you export a file
   and commit it to data/. Nothing a visitor does here can change what anyone
   else sees, which is exactly why no login is needed.

   Export writes CSV and XLSX with no dependencies — including a small ZIP
   writer, since an .xlsx is a zip of XML parts.
   ============================================================================= */

(function () {
  "use strict";

  var TL = window.__timeline;
  if (!TL) return;

  var DATA = TL.DATA;
  var SHAPES = TL.SHAPES;
  var MAX_SLOTS = TL.MAX_SLOTS;
  var slugify = TL.slugify;
  var STORE_KEY = "mnr-timeline-draft:" + (DATA.source || "timeline");

  var dirty = false;
  var lastEdited = null;   // what "Submit for publishing" sends

  /* --- dates -------------------------------------------------------------
     Mirrors parseWhen/formatWhen/fractionalYear in scripts/build-data.mjs. The
     two must agree, or an event would sit in one place in the editor and
     another after the next build.

     Years are ASTRONOMICAL: 0 is 1 BC, -1 is 2 BC. BC/AD is display only.
     ----------------------------------------------------------------------- */
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  var DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  // No Date: Date.UTC maps years 0-99 onto 1900-1999, which would silently
  // misplace any first-century event.
  function fractionalYear(y, m, d) {
    m = m || 0; d = d || 1;
    var dayOfYear = DAYS_BEFORE_MONTH[m] + (m > 1 && isLeap(y) ? 1 : 0) + d;
    return y + (dayOfYear - 1) / (isLeap(y) ? 366 : 365);
  }

  function parseWhen(text) {
    if (text == null) return null;
    text = String(text).trim();
    if (!text) return null;

    var circa = false;
    var c = text.match(/^(?:c\.?|ca\.?|circa|approx\.?|around)\s+(.*)$/i);
    if (c) { circa = true; text = c[1].trim(); }

    var m = text.match(/^(\d{1,6})\s*(?:BC|BCE|B\.C\.|B\.C\.E\.)$/i);
    if (m) return mk(1 - Number(m[1]), 0, 1, "year", circa);

    m = text.match(/^(?:AD|CE|A\.D\.|C\.E\.)\s*(\d{1,4})$/i) ||
        text.match(/^(\d{1,4})\s*(?:AD|CE|A\.D\.|C\.E\.)$/i);
    if (m) return mk(Number(m[1]), 0, 1, "year", circa);

    m = text.match(/^(-?\d{1,6})$/);
    if (m) return mk(Number(m[1]), 0, 1, "year", circa);

    m = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (m) return mk(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1, m[3] ? "day" : "month", circa);

    m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) return mk(Number(m[3]), Number(m[2]) - 1, Number(m[1]), "day", circa);

    m = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (m) {
      var mo = MONTHS.findIndex(function (name) {
        return name.toLowerCase().indexOf(m[1].toLowerCase().slice(0, 3)) === 0;
      });
      if (mo >= 0) return mk(Number(m[2]), mo, 1, "month", circa);
    }

    m = text.match(/\b(\d{4})\b/);
    if (m) return mk(Number(m[1]), 0, 1, "year", circa);

    return undefined; // distinct from null: present but unreadable
  }

  function mk(y, mo, d, precision, circa) {
    return {
      year: y, month: mo, day: d, precision: precision, circa: Boolean(circa),
      position: fractionalYear(y, mo, d),
    };
  }

  function formatYear(y) {
    if (y <= 0) return (1 - y) + " BC";
    if (y < 1000) return "AD " + y;
    return String(y);
  }

  function formatWhen(w) {
    if (!w) return "";
    var prefix = w.circa ? "c. " : "";
    var y = formatYear(w.year);
    if (w.precision === "year") return prefix + y;
    var mon = MONTHS[w.month].slice(0, 3);
    return w.precision === "month" ? prefix + mon + " " + y : prefix + w.day + " " + mon + " " + y;
  }

  /* --- model helpers ----------------------------------------------------- */

  // Colour belongs to the group, shape to the track's slot within it. Pick the
  // first shape not already used in that group so the pair stays unique — the
  // build fails outright on a duplicate.
  function nextShapeFor(groupSlug) {
    var used = DATA.categories
      .filter(function (c) { return c.groupSlug === groupSlug; })
      .map(function (c) { return c.shape; });
    for (var i = 0; i < SHAPES.length; i++) {
      if (used.indexOf(SHAPES[i]) === -1) return SHAPES[i];
    }
    return null;
  }

  function addGroup(name) {
    var slug = slugify(name);
    var existing = (DATA.groups || []).find(function (g) { return g.slug === slug; });
    if (existing) return existing;

    // First unused slot, not groups.length — the Categories sheet can pin
    // colours out of order (this data uses 1, 3, 4, 5), so counting groups
    // hands the new one a colour that is already in use.
    var taken = DATA.groups.map(function (g) { return g.colorIndex; });
    var colorIndex = 0;
    while (colorIndex < MAX_SLOTS && taken.indexOf(colorIndex) !== -1) colorIndex++;
    if (colorIndex >= MAX_SLOTS) {
      throw new Error("All " + MAX_SLOTS + " group colours are in use. Add the track to an existing group.");
    }

    var group = { name: name, slug: slug, colorIndex: colorIndex, tracks: [], count: 0 };
    DATA.groups.push(group);
    DATA.grouped = true;
    return group;
  }

  function addTrack(name, groupSlug, shape) {
    var slug = slugify(name);
    if (DATA.categories.some(function (c) { return c.slug === slug; })) {
      throw new Error('A track called "' + name + '" already exists.');
    }
    var group = DATA.groups.find(function (g) { return g.slug === groupSlug; });
    if (!group) throw new Error("Pick a group for the track.");

    var chosen = shape || nextShapeFor(group.slug);
    if (!chosen) {
      throw new Error('"' + group.name + '" already has ' + MAX_SLOTS +
        " tracks, which is every available shape. Add the track to a different group.");
    }
    if (DATA.categories.some(function (c) {
      return c.groupSlug === group.slug && c.shape === chosen;
    })) {
      throw new Error("Another track in this group already uses the " + chosen + " shape.");
    }

    var cat = {
      name: name, slug: slug,
      group: group.name, groupSlug: group.slug,
      colorIndex: group.colorIndex, shape: chosen, count: 0,
    };
    DATA.categories.push(cat);
    return cat;
  }

  function eventId(catName, title, year) {
    return slugify(catName) + "-" + slugify(title) + "-" + year;
  }

  /* --- persistence ------------------------------------------------------- */
  function save() {
    dirty = true;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        events: DATA.events, categories: DATA.categories,
        groups: DATA.groups, grouped: DATA.grouped,
      }));
    } catch (e) { /* private mode, or quota — the in-memory copy still works */ }
    TL.applyModelChange();
    updateBanner();
  }

  function restore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try {
      var draft = JSON.parse(raw);
      if (!draft || !Array.isArray(draft.events)) return false;
      DATA.events = draft.events;
      DATA.categories = draft.categories;
      DATA.groups = draft.groups;
      DATA.grouped = draft.grouped;
      dirty = true;
      TL.applyModelChange();
      return true;
    } catch (e) { return false; }
  }

  function discard() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    location.reload();
  }

  /* --- export ------------------------------------------------------------ */
  var COLUMNS = ["Category", "Group", "Event", "Start", "End", "Detail", "Location", "Link", "Highlight"];

  function rows() {
    return DATA.events.map(function (ev) {
      return [
        ev.category, ev.group || "", ev.title, ev.start, ev.end || "",
        ev.detail || "", ev.location || "", ev.link || "", ev.highlight ? "yes" : "",
      ];
    });
  }

  function toCsv() {
    var esc = function (v) {
      v = v == null ? "" : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    return [COLUMNS].concat(rows())
      .map(function (r) { return r.map(esc).join(","); }).join("\r\n") + "\r\n";
  }

  /* Minimal ZIP (stored, no compression) — an .xlsx is a zip of XML parts, and
     storing rather than deflating keeps this to a CRC and two headers. */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function makeZip(files) {
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;

    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var data = enc.encode(f.text);
      var crc = crc32(data);
      var here = offset;

      var local = new Uint8Array(30 + name.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);   // UTF-8 names
      dv.setUint16(8, 0, true);        // stored
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0x21, true);    // 1980-01-01
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      local.set(name, 30);
      parts.push(local, data);
      offset += local.length + data.length;

      var cd = new Uint8Array(46 + name.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, here, true);
      cd.set(name, 46);
      central.push(cd);
    });

    var cdSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(parts.concat(central, [end]), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  function xmlEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function colName(n) {
    var s = ""; n++;
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function toXlsx() {
    var strings = [], index = new Map();
    var sid = function (s) {
      if (!index.has(s)) { index.set(s, strings.length); strings.push(s); }
      return index.get(s);
    };

    var sheetXml = function (grid) {
      var body = grid.map(function (row, r) {
        var cells = row.map(function (v, c) {
          if (v === "" || v == null) return "";
          var ref = colName(c) + (r + 1);
          return typeof v === "number"
            ? '<c r="' + ref + '"><v>' + v + "</v></c>"
            : '<c r="' + ref + '" t="s"><v>' + sid(String(v)) + "</v></c>";
        }).join("");
        return '<row r="' + (r + 1) + '">' + cells + "</row>";
      }).join("");
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        "<sheetData>" + body + "</sheetData></worksheet>";
    };

    // Second sheet pins group, colour and shape so a round-trip through the
    // build keeps every track looking the way it does here.
    var catGrid = [["Category", "Group", "Color", "Shape"]].concat(
      DATA.categories.map(function (c) {
        return [c.name, c.group, c.colorIndex + 1, c.shape];
      })
    );

    var sheet1 = sheetXml([COLUMNS].concat(rows()));
    var sheet2 = sheetXml(catGrid);
    var sst = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' +
      strings.length + '" uniqueCount="' + strings.length + '">' +
      strings.map(function (s) { return '<si><t xml:space="preserve">' + xmlEsc(s) + "</t></si>"; }).join("") +
      "</sst>";

    return makeZip([
      { name: "[Content_Types].xml", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>' },
      { name: "_rels/.rels", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: "xl/workbook.xml", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Timeline" sheetId="1" r:id="rId1"/><sheet name="Categories" sheetId="2" r:id="rId2"/></sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>' },
      { name: "xl/worksheets/sheet1.xml", text: sheet1 },
      { name: "xl/worksheets/sheet2.xml", text: sheet2 },
      { name: "xl/sharedStrings.xml", text: sst },
    ]);
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* --- UI ---------------------------------------------------------------- */
  var el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  var banner, bannerCount;

  function updateBanner() {
    if (!bannerCount) return;
    bannerCount.textContent = dirty
      ? DATA.events.length + " events · unsaved local changes"
      : DATA.events.length + " events · no changes yet";
    banner.classList.toggle("is-dirty", dirty);
  }

  function buildBanner() {
    var card = document.querySelector(".timeline-card");
    if (!card) return;

    banner = el("div", "editor-bar");

    var left = el("div", "editor-bar-main");
    left.appendChild(el("strong", null, "Editor"));
    bannerCount = el("span", "editor-count");
    left.appendChild(bannerCount);
    banner.appendChild(left);

    var note = el("p", "editor-note",
      "Changes stay in this browser. Export a file and commit it to data/ to publish them.");
    banner.appendChild(note);

    var actions = el("div", "editor-actions");

    var addEvent = el("button", "btn", "Add event");
    addEvent.type = "button";
    addEvent.addEventListener("click", function () { openEventDialog(null); });
    actions.appendChild(addEvent);

    var addTrackBtn = el("button", "btn", "Add track");
    addTrackBtn.type = "button";
    addTrackBtn.addEventListener("click", openTrackDialog);
    actions.appendChild(addTrackBtn);

    var csv = el("button", "btn", "Export CSV");
    csv.type = "button";
    csv.addEventListener("click", function () {
      download(new Blob([toCsv()], { type: "text/csv;charset=utf-8" }), "timeline.csv");
    });
    actions.appendChild(csv);

    var xlsx = el("button", "btn", "Export XLSX");
    xlsx.type = "button";
    xlsx.addEventListener("click", function () { download(toXlsx(), "timeline.xlsx"); });
    actions.appendChild(xlsx);

    var submit = el("button", "btn", "Submit for publishing");
    submit.type = "button";
    submit.title = "Open a pre-filled GitHub issue for the most recent event";
    submit.addEventListener("click", openSubmitIssue);
    actions.appendChild(submit);

    var reset = el("button", "btn", "Discard changes");
    reset.type = "button";
    reset.addEventListener("click", function () {
      if (confirm("Discard all local changes and reload the published data?")) discard();
    });
    actions.appendChild(reset);

    banner.appendChild(actions);
    card.parentNode.insertBefore(banner, card);
    updateBanner();
  }

  /* --- event dialog ------------------------------------------------------ */
  var dialog, form, editing = null;

  function field(label, name, opts) {
    opts = opts || {};
    var wrap = el("label", "editor-field");
    wrap.appendChild(el("span", "editor-field-label", label));
    var input = opts.textarea ? el("textarea") : el("input");
    if (!opts.textarea) input.type = opts.type || "text";
    input.name = name;
    input.className = "field";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.textarea) input.rows = 2;
    wrap.appendChild(input);
    if (opts.hint) wrap.appendChild(el("span", "editor-hint", opts.hint));
    return wrap;
  }

  function buildDialog() {
    dialog = el("dialog", "editor-dialog");
    form = el("form", "editor-form");
    form.method = "dialog";

    form.appendChild(el("h2", "editor-dialog-title", "Event"));

    var trackWrap = el("label", "editor-field");
    trackWrap.appendChild(el("span", "editor-field-label", "Track"));
    var trackSel = el("select", "field");
    trackSel.name = "track";
    trackWrap.appendChild(trackSel);
    form.appendChild(trackWrap);

    form.appendChild(field("Event", "title", { placeholder: "What happened" }));
    form.appendChild(field("Start", "start", {
      placeholder: "1948 · 1948-07-29 · July 1948 · 776 BC · AD 79",
      hint: "Ancient dates: 776 BC, 776 BCE, AD 79, or c. 3000 BC for approximate.",
    }));
    form.appendChild(field("End (optional)", "end", { hint: "Set an end date to draw the event as a bar." }));
    form.appendChild(field("Detail", "detail", { textarea: true, placeholder: "Shown in the tooltip" }));
    form.appendChild(field("Location", "location"));
    form.appendChild(field("Link", "link", { type: "url", placeholder: "https://…", hint: "Shown as a clickable source in the tooltip." }));

    var hl = el("label", "editor-check");
    var hlBox = el("input");
    hlBox.type = "checkbox";
    hlBox.name = "highlight";
    hl.appendChild(hlBox);
    hl.appendChild(el("span", null, "Highlight — keep the label visible when the lane is crowded"));
    form.appendChild(hl);

    var err = el("p", "editor-error");
    err.hidden = true;
    form.appendChild(err);

    var row = el("div", "editor-dialog-actions");
    var del = el("button", "btn editor-delete", "Delete");
    del.type = "button";
    del.addEventListener("click", function () {
      if (!editing) return;
      if (!confirm('Delete "' + editing.title + '"?')) return;
      DATA.events = DATA.events.filter(function (e) { return e !== editing; });
      save();
      dialog.close();
    });
    row.appendChild(del);

    var spacer = el("span", "editor-spacer");
    row.appendChild(spacer);

    var cancel = el("button", "btn", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", function () { dialog.close(); });
    row.appendChild(cancel);

    var submit = el("button", "btn btn-primary", "Save");
    submit.type = "submit";
    row.appendChild(submit);

    form.appendChild(row);
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      err.hidden = true;
      try {
        commitEvent(new FormData(form));
        dialog.close();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  }

  function refreshTrackOptions(selected) {
    var sel = form.elements.track;
    sel.textContent = "";
    DATA.categories.forEach(function (c) {
      var o = el("option", null, (DATA.grouped ? c.group + " — " : "") + c.name);
      o.value = c.slug;
      sel.appendChild(o);
    });
    if (selected) sel.value = selected;
  }

  function openEventDialog(ev) {
    if (!dialog) buildDialog();
    editing = ev;

    if (!DATA.categories.length) {
      alert("Add a track first.");
      return;
    }

    refreshTrackOptions(ev ? ev.categorySlug : null);
    form.querySelector(".editor-dialog-title").textContent = ev ? "Edit event" : "Add event";
    form.elements.title.value = ev ? ev.title : "";
    form.elements.start.value = ev ? ev.start : "";
    form.elements.end.value = ev && ev.end ? ev.end : "";
    form.elements.detail.value = ev && ev.detail ? ev.detail : "";
    form.elements.location.value = ev && ev.location ? ev.location : "";
    form.elements.link.value = ev && ev.link ? ev.link : "";
    form.elements.highlight.checked = !!(ev && ev.highlight);
    form.querySelector(".editor-delete").hidden = !ev;
    form.querySelector(".editor-error").hidden = true;

    dialog.showModal();
    form.elements.title.focus();
  }

  function commitEvent(fd) {
    var title = String(fd.get("title") || "").trim();
    if (!title) throw new Error("Give the event a name.");

    var cat = DATA.categories.find(function (c) { return c.slug === fd.get("track"); });
    if (!cat) throw new Error("Pick a track.");

    var start = parseWhen(fd.get("start"));
    if (start === undefined) {
      throw new Error("Could not read that start date. Try 1948, 1948-07, 1948-07-29, " +
        "29/07/1948, July 1948, 776 BC, AD 79 or c. 3000 BC.");
    }
    if (!start) throw new Error("Give the event a start date.");

    var end = parseWhen(fd.get("end"));
    if (end === undefined) throw new Error("Could not read that end date.");
    if (end && end.position < start.position) {
      throw new Error("The end date is before the start date.");
    }

    var link = String(fd.get("link") || "").trim();
    if (link && !/^https?:\/\//i.test(link)) {
      throw new Error("Links must start with http:// or https://");
    }

    var next = {
      id: eventId(cat.name, title, start.year),
      category: cat.name,
      categorySlug: cat.slug,
      group: cat.group,
      groupSlug: cat.groupSlug,
      title: title,
      start: formatWhen(start),
      startPos: Number(start.position.toFixed(4)),
      startYear: start.year,
      end: end ? formatWhen(end) : null,
      endPos: end ? Number(end.position.toFixed(4)) : null,
      endYear: end ? end.year : null,
      span: Boolean(end),
      circa: Boolean(start.circa || (end && end.circa)),
      detail: String(fd.get("detail") || "").trim() || null,
      location: String(fd.get("location") || "").trim() || null,
      link: link || null,
      highlight: fd.get("highlight") === "on",
    };

    if (editing) {
      Object.keys(next).forEach(function (k) { editing[k] = next[k]; });
      lastEdited = editing;
    } else {
      DATA.events.push(next);
      lastEdited = next;
    }
    save();
  }

  /* --- track dialog ------------------------------------------------------ */
  var trackDialog, trackForm;

  function buildTrackDialog() {
    trackDialog = el("dialog", "editor-dialog");
    trackForm = el("form", "editor-form");
    trackForm.method = "dialog";
    trackForm.appendChild(el("h2", "editor-dialog-title", "Add track"));

    trackForm.appendChild(field("Track name", "name", { placeholder: "e.g. Asian Games" }));

    var groupWrap = el("label", "editor-field");
    groupWrap.appendChild(el("span", "editor-field-label", "Group"));
    var groupSel = el("select", "field");
    groupSel.name = "group";
    groupWrap.appendChild(groupSel);
    groupWrap.appendChild(el("span", "editor-hint",
      "Colour comes from the group; shape distinguishes tracks inside it."));
    trackForm.appendChild(groupWrap);

    var newGroup = field("New group name", "newGroup", { placeholder: "Only if you chose “New group…”" });
    newGroup.classList.add("editor-newgroup");
    trackForm.appendChild(newGroup);

    var err = el("p", "editor-error");
    err.hidden = true;
    trackForm.appendChild(err);

    var list = el("div", "editor-track-list");
    trackForm.appendChild(list);

    var row = el("div", "editor-dialog-actions");
    row.appendChild(el("span", "editor-spacer"));
    var cancel = el("button", "btn", "Close");
    cancel.type = "button";
    cancel.addEventListener("click", function () { trackDialog.close(); });
    row.appendChild(cancel);
    var submit = el("button", "btn btn-primary", "Add track");
    submit.type = "submit";
    row.appendChild(submit);
    trackForm.appendChild(row);

    trackDialog.appendChild(trackForm);
    document.body.appendChild(trackDialog);

    groupSel.addEventListener("change", function () {
      newGroup.hidden = groupSel.value !== "__new";
    });

    trackForm.addEventListener("submit", function (e) {
      e.preventDefault();
      err.hidden = true;
      try {
        var fd = new FormData(trackForm);
        var name = String(fd.get("name") || "").trim();
        if (!name) throw new Error("Give the track a name.");

        var groupSlug = fd.get("group");
        if (groupSlug === "__new") {
          var gName = String(fd.get("newGroup") || "").trim();
          if (!gName) throw new Error("Give the new group a name.");
          if (DATA.groups.length >= MAX_SLOTS) {
            throw new Error("There are already " + MAX_SLOTS + " groups, which is every available colour. Add the track to an existing group.");
          }
          groupSlug = addGroup(gName).slug;
        }

        addTrack(name, groupSlug);
        save();
        trackForm.elements.name.value = "";
        refreshTrackDialog();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  }

  function refreshTrackDialog() {
    var sel = trackForm.elements.group;
    var previous = sel.value;
    sel.textContent = "";
    DATA.groups.forEach(function (g) {
      var o = el("option", null, g.name + " (" + g.tracks.length + " tracks)");
      o.value = g.slug;
      sel.appendChild(o);
    });
    var newOpt = el("option", null, "New group…");
    newOpt.value = "__new";
    sel.appendChild(newOpt);
    if (previous) sel.value = previous;
    trackForm.querySelector(".editor-newgroup").hidden = sel.value !== "__new";

    var list = trackForm.querySelector(".editor-track-list");
    list.textContent = "";
    list.appendChild(el("h3", "editor-subhead", "Existing tracks"));
    DATA.categories.forEach(function (c) {
      var row = el("div", "editor-track-row");
      row.appendChild(TL.shapeKey(c.colorIndex, c.shape, "filter-key"));
      row.appendChild(el("span", "editor-track-name", c.name));
      row.appendChild(el("span", "chip-count", String(c.count)));
      var del = el("button", "btn btn-tiny", "Delete");
      del.type = "button";
      del.disabled = c.count > 0;
      del.title = c.count > 0
        ? "Delete this track's " + c.count + " events first"
        : "Delete this track";
      del.addEventListener("click", function () {
        DATA.categories = DATA.categories.filter(function (x) { return x !== c; });
        DATA.groups = DATA.groups.filter(function (g) {
          return DATA.categories.some(function (x) { return x.groupSlug === g.slug; });
        });
        save();
        refreshTrackDialog();
      });
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function openTrackDialog() {
    if (!trackDialog) buildTrackDialog();
    refreshTrackDialog();
    trackForm.querySelector(".editor-error").hidden = true;
    trackDialog.showModal();
    trackForm.elements.name.focus();
  }

  /* --- submit for publishing ---------------------------------------------
     Opens a pre-filled GitHub issue rather than posting anywhere. No token is
     involved: you are already signed in to GitHub, and the entry goes through
     exactly the same review-and-label path as a public submission.
     ----------------------------------------------------------------------- */
  function openSubmitIssue() {
    var repo = (document.body.dataset.repo || "").trim();
    if (!repo) {
      alert("Set \"repo\" in src/_data/site.json first.");
      return;
    }
    if (!lastEdited) {
      alert("Add or edit an event first — this submits that one entry for publishing.");
      return;
    }

    var ev = lastEdited;
    var field = function (label, value) {
      return "### " + label + "\n\n" + (value ? String(value) : "_No response_");
    };
    var body = [
      field("Track", ev.category),
      field("Group", ev.group),
      field("Event", ev.title),
      field("Start", ev.start),
      field("End", ev.end),
      field("Detail", ev.detail),
      field("Location", ev.location),
      field("Source link", ev.link),
    ].join("\n\n");

    var url = "https://github.com/" + repo + "/issues/new" +
      "?labels=submission,from-editor" +
      "&title=" + encodeURIComponent("[Entry] " + ev.title) +
      "&body=" + encodeURIComponent(body);

    // A very long detail can overflow what a URL will carry; fall back to the
    // clipboard rather than opening a silently truncated issue.
    if (url.length > 7000) {
      navigator.clipboard.writeText(body).then(function () {
        alert("That entry is too long for a pre-filled link. The issue body has been " +
              "copied to your clipboard — paste it into a new issue.");
      });
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  /* --- table actions ----------------------------------------------------- */
  function decorateTable(tbody) {
    var table = tbody.closest("table");
    var headRow = table.querySelector("thead tr");
    if (headRow && !headRow.querySelector(".editor-col")) {
      var th = el("th", "editor-col", "Edit");
      th.setAttribute("scope", "col");
      headRow.appendChild(th);
    }

    Array.prototype.slice.call(tbody.querySelectorAll("tr")).forEach(function (tr) {
      var ev = DATA.events.find(function (e) { return e.id === tr.dataset.eventId; });
      var td = el("td", "editor-col");
      if (ev) {
        var edit = el("button", "btn btn-tiny", "Edit");
        edit.type = "button";
        edit.addEventListener("click", function () { openEventDialog(ev); });
        td.appendChild(edit);
      }
      tr.appendChild(td);
    });
  }

  /* --- boot -------------------------------------------------------------- */
  document.body.classList.add("tl-editing");
  TL.setEditorHook({ decorateTable: decorateTable });
  buildBanner();

  // A draft in localStorage wins over the published data, so a refresh mid-edit
  // doesn't quietly lose work.
  if (!restore()) TL.applyModelChange();
  updateBanner();

  // The table is collapsed by default; the editor is about the table, so open it.
  var toggle = document.getElementById("tl-table-toggle");
  var wrap = document.getElementById("tl-table-wrap");
  if (toggle && wrap && wrap.hidden) toggle.click();

  window.addEventListener("beforeunload", function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
})();
