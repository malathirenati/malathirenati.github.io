/* =============================================================================
   Horizontal timeline.

   No dependencies. Reads JSON baked into the page by Eleventy, draws SVG with
   DOM calls, and re-renders on filter, zoom, resize or theme change.

   IDENTITY IS COMPOSITE — colour is the GROUP, shape is the TRACK within it.
   There are only eight validated hues, and in any view where two marks can sit
   side by side colour alone separates at most four series. Both channels are
   therefore load-bearing: never reduce the shapes to plain dots. The build
   refuses to emit two tracks sharing a (colour, shape) pair. See docs/DESIGN.md.

   All spreadsheet-derived strings go into the DOM via textContent. Never build
   markup from them by string concatenation.
   ============================================================================= */

(function () {
  "use strict";

  var dataEl = document.getElementById("tl-data");
  var viewport = document.getElementById("tl-viewport");
  if (!dataEl || !viewport) return;

  var DATA;
  try {
    DATA = JSON.parse(dataEl.textContent);
  } catch (err) {
    viewport.textContent = "The timeline data could not be read.";
    return;
  }
  if (!DATA || !DATA.events || !DATA.events.length) return;

  var SVG_NS = "http://www.w3.org/2000/svg";

  /* --- geometry ---------------------------------------------------------- */
  var PAD_X = 30;          // room for the first and last tick labels
  var AXIS_H = 26;
  var LANE_LABEL_H = 20;
  var LANE_PAD_B = 8;
  var LANE_GAP = 12;
  var MARK_R = 7;          // markers are 14px; shapes must stay readable here
  var LABEL_GAP = 7;
  var MIN_MARK_GAP = 10;
  var HIT_MIN = 24;        // minimum pointer/focus target
  var MIN_SPAN_YEARS = 2;

  /* The axis is not bounded by the data. Panning left has to keep working as
     prehistory is added, so the only limits are a sane outer envelope and a
     maximum zoom-out. Panning into empty space is allowed — the minimap shows
     where the events actually are, and "Back to data" brings you home. */
  var WORLD = { min: -50000, max: new Date().getFullYear() + 200 };
  var MAX_SPAN_YEARS = 60000;

  function clampView(lo, hi) {
    var span = Math.min(Math.max(hi - lo, MIN_SPAN_YEARS), MAX_SPAN_YEARS);
    if (lo < WORLD.min) lo = WORLD.min;
    if (lo + span > WORLD.max) lo = WORLD.max - span;
    return { from: lo, to: lo + span };
  }

  var LABEL_FONT = '11.5px system-ui, -apple-system, "Segoe UI", sans-serif';

  /* --- view modes --------------------------------------------------------
     Every mode runs the same packer. They differ only in how events are
     bucketed into lanes and how much room a lane is allowed.
     ----------------------------------------------------------------------- */
  var MODES = {
    lanes:   { lane: "track", laneLabel: "above",  eventLabels: true,  maxRows: 6,  rowH: 23, gutter: 0 },
    rollup:  { lane: "group", laneLabel: "above",  eventLabels: true,  maxRows: 8,  rowH: 23, gutter: 0 },
    compact: { lane: "track", laneLabel: "gutter", eventLabels: false, maxRows: 1,  rowH: 26, gutter: 156 },
    compare: { lane: "track", laneLabel: "above",  eventLabels: true,  maxRows: 10, rowH: 23, gutter: 0 },
    merged:  { lane: "all",   laneLabel: "none",   eventLabels: true,  maxRows: 16, rowH: 23, gutter: 0 },
  };

  // Must match the ordering in scripts/build-data.mjs — colour comes from the
  // group's slot, shape from the track's position within that group.
  var SHAPES = ["circle", "diamond", "square", "triangle", "hexagon", "chevron", "cross", "star"];
  var MAX_SLOTS = 8;

  var catBySlug = {};
  var groupBySlug = {};

  function reindex() {
    catBySlug = {};
    DATA.categories.forEach(function (c) { catBySlug[c.slug] = c; });
    groupBySlug = {};
    (DATA.groups || []).forEach(function (g) { groupBySlug[g.slug] = g; });
  }
  reindex();

  var editorHook = null;

  /* Recompute everything derived from the events list. The editor mutates
     DATA.events / DATA.categories / DATA.groups and then calls this, so counts,
     ordering and the year range can never drift from the data. */
  function rebuildModel() {
    // Captured before reindex: anything not in here is newly added, and a track
    // you just created should appear straight away rather than arrive switched off.
    var knownTracks = new Set(Object.keys(catBySlug));

    DATA.events.forEach(function (ev) {
      var cat = catBySlug[ev.categorySlug];
      if (!cat) return;
      ev.category = cat.name;
      ev.group = cat.group;
      ev.groupSlug = cat.groupSlug;
    });

    DATA.events.sort(function (a, b) {
      return a.startPos - b.startPos || a.title.localeCompare(b.title);
    });

    DATA.categories.forEach(function (c) {
      c.count = DATA.events.filter(function (ev) { return ev.categorySlug === c.slug; }).length;
    });
    (DATA.groups || []).forEach(function (g) {
      g.tracks = DATA.categories.filter(function (c) { return c.groupSlug === g.slug; })
        .map(function (c) { return c.slug; });
      g.count = DATA.categories.filter(function (c) { return c.groupSlug === g.slug; })
        .reduce(function (sum, c) { return sum + c.count; }, 0);
    });

    if (DATA.events.length) {
      var positions = DATA.events.reduce(function (acc, ev) {
        acc.push(ev.startPos);
        if (ev.endPos != null) acc.push(ev.endPos);
        return acc;
      }, []);
      DATA.minYear = Math.floor(Math.min.apply(null, positions));
      DATA.maxYear = Math.ceil(Math.max.apply(null, positions));
    }

    reindex();

    var nextActive = new Set();
    DATA.categories.forEach(function (c) {
      if (!knownTracks.has(c.slug) || state.active.has(c.slug)) nextActive.add(c.slug);
    });
    state.active = nextActive;
    if (!state.active.size) {
      state.active = new Set(DATA.categories.map(function (c) { return c.slug; }));
    }

    state.pinned = new Set(Array.from(state.pinned).filter(function (s) { return catBySlug[s]; }));
  }

  /* --- state ------------------------------------------------------------- */
  var state = {
    active: new Set(DATA.categories.map(function (c) { return c.slug; })),
    pinned: new Set(),
    mode: "lanes",
    from: DATA.minYear,
    to: DATA.maxYear,
    query: "",
    minDuration: 0,     // years; 0 = no duration filter
    focusId: null,
  };

  /* --- text measurement -------------------------------------------------- */
  // Two contexts: event labels render at normal weight, lane labels at 600.
  // Measuring bold text with a normal-weight font under-reports and lets a
  // "fitted" label overflow its box anyway.
  var measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = LABEL_FONT;
  var measureBoldCtx = document.createElement("canvas").getContext("2d");
  measureBoldCtx.font = "600 " + LABEL_FONT;
  var measureCache = new Map();

  function textWidth(str, bold) {
    var key = bold ? "b " + str : str;
    if (measureCache.has(key)) return measureCache.get(key);
    var w = (bold ? measureBoldCtx : measureCtx).measureText(str).width;
    measureCache.set(key, w);
    return w;
  }

  // Trim to fit a fixed box. Used for the compact-mode name gutter, where a long
  // track name would otherwise run under the plot. The full name stays on the
  // row's aria-label and title, so nothing is lost.
  function fitText(str, maxPx, bold) {
    if (maxPx <= 0) return "";
    if (textWidth(str, bold) <= maxPx) return str;
    var lo = 0, hi = str.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (textWidth(str.slice(0, mid) + "…", bold) <= maxPx) lo = mid; else hi = mid - 1;
    }
    return lo ? str.slice(0, lo).replace(/\s+$/, "") + "…" : "";
  }

  // The gutter is a third of the width, capped — a fixed 156px leaves barely
  // 100px of plot on a phone.
  function gutterFor(width, cfg) {
    if (!cfg.gutter) return 0;
    return Math.round(Math.min(cfg.gutter, Math.max(88, width * 0.33)));
  }

  /* --- helpers ----------------------------------------------------------- */
  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function seriesVar(colorIndex) { return "var(--s" + (colorIndex + 1) + ")"; }

  function shapeKey(colorIndex, shape, cls) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    if (cls) svg.setAttribute("class", cls);
    svg.style.fill = seriesVar(colorIndex);
    var use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#shape-" + shape);
    svg.appendChild(use);
    return svg;
  }

  function niceStep(span, targetTicks) {
    var raw = span / Math.max(1, targetTicks);
    // Extends into millennia: a view spanning 3000 BC to now needs 500- or
    // 1000-year gridlines, not 1000 ticks.
    var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000,
                 2000, 2500, 5000, 10000, 25000];
    for (var i = 0; i < steps.length; i++) if (steps[i] >= raw) return steps[i];
    return steps[steps.length - 1];
  }

  /**
   * Astronomical year -> reader-facing label. Must match formatYear() in
   * scripts/build-data.mjs. Without this the axis reads "-500".
   */
  function formatYear(y) {
    y = Math.round(y);
    if (y <= 0) return (1 - y) + " BC";
    if (y < 1000) return "AD " + y;
    return String(y);
  }

  /**
   * Tick positions for a view, as astronomical years.
   *
   * BC labels count *down* as the axis runs right (500 BC, 400 BC, ...), so a
   * round display year sits one off the round astronomical one: 500 BC is
   * astronomical -499. Without the shift a millennium axis reads "2501 BC,
   * 2001 BC, 1501 BC" — correct, but obviously not what anyone wants to see.
   */
  function axisTicks(lo, hi, step) {
    var out = [];
    for (var t = Math.ceil(lo / step) * step; t <= hi; t += step) {
      out.push(t <= 0 ? t + 1 : t);
    }
    return out;
  }

  function matchesQuery(ev, q) {
    if (!q) return true;
    return (
      ev.title.toLowerCase().indexOf(q) !== -1 ||
      ev.category.toLowerCase().indexOf(q) !== -1 ||
      (ev.group || "").toLowerCase().indexOf(q) !== -1 ||
      (ev.detail || "").toLowerCase().indexOf(q) !== -1 ||
      (ev.location || "").toLowerCase().indexOf(q) !== -1
    );
  }

  function eventDateText(ev) { return ev.end ? ev.start + " – " + ev.end : ev.start; }

  // A point event has zero duration; a span is its length in years.
  function eventDuration(ev) {
    return ev.endPos != null ? Math.max(0, ev.endPos - ev.startPos) : 0;
  }

  // Which tracks the chart should draw, given mode and filters.
  function visibleTracks() {
    if (state.mode === "compare" && state.pinned.size) {
      return DATA.categories.filter(function (c) { return state.pinned.has(c.slug); });
    }
    return DATA.categories.filter(function (c) { return state.active.has(c.slug); });
  }

  /* --- packing -----------------------------------------------------------
     Greedy first-fit into sub-rows. Each event reserves its marker, its span
     bar, and its label, so no label is drawn over another mark.

     A label normally trails its marker. Near the right edge it flips to the
     left; if it fits on neither side it is dropped — a clipped label is worse
     than none, and the tooltip and table still carry the text.
     ----------------------------------------------------------------------- */
  function layoutGroup(events, scale, maxRows, query, bounds, wantLabels) {
    function attempt(wantsLabel) {
      var rows = [];
      var placed = [];

      events.forEach(function (ev) {
        var xs = scale(ev.startPos);
        var xe = ev.span ? scale(ev.endPos) : xs;
        var markL = Math.min(xs, xe) - MARK_R;
        var markR = Math.max(xs, xe) + MARK_R;
        var labelW = wantsLabel(ev) ? textWidth(ev.title) : 0;

        var row = 0;
        while (row < rows.length && rows[row] > markL - MIN_MARK_GAP) row++;

        var full = row >= maxRows;
        if (full) row = rows.indexOf(Math.min.apply(null, rows));

        var prevRight = rows[row] === undefined ? -Infinity : rows[row];
        var side = null;
        if (labelW && !full) {
          if (markR + LABEL_GAP + labelW <= bounds.right) side = "right";
          else if (markL - LABEL_GAP - labelW >= Math.max(bounds.left, prevRight + MIN_MARK_GAP)) side = "left";
        }
        if (!side) labelW = 0;

        rows[row] = side === "right" ? markR + LABEL_GAP + labelW : markR;
        placed.push({ ev: ev, row: row, xs: xs, xe: xe, labelW: labelW, side: side });
      });

      return { rows: rows.length, placed: placed };
    }

    if (!wantLabels) {
      var bare = attempt(function () { return false; });
      bare.rows = Math.min(bare.rows, maxRows);
      return bare;
    }

    var full = attempt(function () { return true; });
    if (full.rows <= maxRows) return full;

    // Too tall with every label. Keep only the labels that earn their space.
    var priority = new Set();
    events.forEach(function (ev) {
      if (ev.highlight || (query && matchesQuery(ev, query))) priority.add(ev.id);
    });

    var trimmed = attempt(function (ev) { return priority.has(ev.id); });
    trimmed.rows = Math.min(trimmed.rows, maxRows);
    return trimmed;
  }

  /* --- tooltip ----------------------------------------------------------- */
  var tooltip = document.createElement("div");
  tooltip.className = "tl-tooltip";
  tooltip.setAttribute("role", "status");
  tooltip.dataset.open = "false";
  viewport.appendChild(tooltip);

  function showTooltip(ev, cat, anchorRect) {
    tooltip.textContent = "";

    var meta = document.createElement("div");
    meta.className = "tl-tt-meta";
    meta.appendChild(shapeKey(cat.colorIndex, cat.shape, "tl-tt-key"));
    meta.appendChild(document.createTextNode(
      DATA.grouped ? ev.group + " · " + ev.category : ev.category
    ));
    tooltip.appendChild(meta);

    var title = document.createElement("div");
    title.className = "tl-tt-title";
    title.textContent = ev.title;
    tooltip.appendChild(title);

    var date = document.createElement("div");
    date.className = "tl-tt-date";
    date.textContent = eventDateText(ev);
    tooltip.appendChild(date);

    if (ev.detail) {
      var d = document.createElement("div");
      d.className = "tl-tt-detail";
      d.textContent = ev.detail;
      tooltip.appendChild(d);
    }

    if (ev.location) {
      var loc = document.createElement("div");
      loc.className = "tl-tt-foot";
      loc.textContent = ev.location;
      tooltip.appendChild(loc);
    }

    // A real anchor, not a hint. The tooltip becomes interactive only when there
    // is something in it to click, so it never swallows pointer events over the
    // chart otherwise.
    if (ev.link) {
      var linkWrap = document.createElement("div");
      linkWrap.className = "tl-tt-foot";
      var a = document.createElement("a");
      a.className = "tl-tt-link";
      a.href = ev.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = linkLabel(ev.link);
      linkWrap.appendChild(a);
      tooltip.appendChild(linkWrap);
    }

    // Say so when the source hasn't been checked, rather than letting a link
    // imply the entry is settled.
    if (ev.verify) {
      var flag = document.createElement("div");
      flag.className = "tl-tt-unverified";
      flag.textContent = "Source not yet verified";
      tooltip.appendChild(flag);
    }
    tooltip.dataset.interactive = ev.link ? "true" : "false";

    tooltip.dataset.open = "true";

    var vp = viewport.getBoundingClientRect();
    var tw = tooltip.offsetWidth;
    var th = tooltip.offsetHeight;
    var cx = anchorRect.left - vp.left + anchorRect.width / 2;
    var top = anchorRect.top - vp.top - th - 10;
    if (top < 4) top = anchorRect.bottom - vp.top + 10;
    var left = Math.max(4, Math.min(cx - tw / 2, vp.width - tw - 4));

    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }

  // "example.com ↗" reads better than a raw URL in a small box.
  function linkLabel(href) {
    try {
      return new URL(href, location.href).hostname.replace(/^www\./, "") + " ↗";
    } catch (e) {
      return "Source ↗";
    }
  }

  // A short grace period before hiding, so the pointer can travel from the mark
  // into the tooltip to click the source link without it vanishing en route.
  var hideTimer = null;

  function hideTooltip(immediate) {
    clearTimeout(hideTimer);
    if (immediate === true || tooltip.dataset.interactive !== "true") {
      tooltip.dataset.open = "false";
      return;
    }
    hideTimer = setTimeout(function () { tooltip.dataset.open = "false"; }, 220);
  }

  tooltip.addEventListener("pointerenter", function () { clearTimeout(hideTimer); });
  tooltip.addEventListener("pointerleave", function () { hideTooltip(true); });

  /* --- render ------------------------------------------------------------ */
  var markNodes = [];
  var axisHost = document.getElementById("tl-axis");

  function render() {
    // Drop any frame queued by a pan. Without this a stale rAF can land after a
    // synchronous render (a preset, a typed year) and repaint the old view —
    // and rAF doesn't fire at all in a hidden tab, so the frame can arrive much
    // later than it looks like it should.
    if (panFrame) { cancelAnimationFrame(panFrame); panFrame = null; }

    var viewMin = state.from;
    var viewMax = state.to;
    if (viewMax - viewMin < MIN_SPAN_YEARS) viewMax = viewMin + MIN_SPAN_YEARS;

    var query = state.query.trim().toLowerCase();
    var cfg = MODES[state.mode] || MODES.lanes;
    var tracks = visibleTracks();
    var shown = new Set(tracks.map(function (c) { return c.slug; }));

    var inView = DATA.events.filter(function (ev) {
      if (!shown.has(ev.categorySlug)) return false;
      if (state.minDuration && eventDuration(ev) < state.minDuration) return false;
      var s = ev.startPos;
      var e = ev.span ? ev.endPos : ev.startPos;
      return e >= viewMin && s <= viewMax;
    });

    // Everything that isn't the chart stays in step regardless of whether the
    // chart can be drawn. The table is the fallback view, so it must never be
    // coupled to the chart's ability to render.
    updateStatus(
      inView.length,
      query ? inView.filter(function (ev) { return matchesQuery(ev, query); }).length : null,
      tracks.length
    );
    renderLegend(tracks);
    syncFilterUi();
    syncTable(shown);
    writeUrl();

    // No layout yet — a background tab, or a container still display:none.
    var width = viewport.clientWidth;
    if (!width) return;

    var gutter = gutterFor(width, cfg);
    var left = PAD_X + gutter;
    var plotW = width - left - PAD_X;
    var scale = function (pos) {
      return left + ((pos - viewMin) / (viewMax - viewMin)) * plotW;
    };

    Array.prototype.slice.call(viewport.children).forEach(function (child) {
      if (child !== tooltip) child.remove();
    });
    markNodes = [];

    if (!inView.length) {
      var empty = document.createElement("p");
      empty.className = "timeline-empty";
      empty.textContent = emptyMessage(tracks.length);
      viewport.insertBefore(empty, tooltip);
      drawStickyAxis(null, width, viewMin, viewMax, scale, plotW);
      // The minimap still draws: with an unbounded axis it is the way back.
      drawMinimap(width, viewMin, viewMax);
      return;
    }

    /* bucket events into lanes */
    var groups;
    if (cfg.lane === "all") {
      groups = [{ key: "all", label: null, colorIndex: null, shape: null, events: inView }];
    } else if (cfg.lane === "group") {
      groups = (DATA.groups || [])
        .map(function (g) {
          return {
            key: g.slug, label: g.name, colorIndex: g.colorIndex, shape: null,
            events: inView.filter(function (ev) { return ev.groupSlug === g.slug; }),
          };
        })
        .filter(function (g) { return g.events.length; });
    } else {
      groups = tracks
        .map(function (c) {
          return {
            key: c.slug, label: c.name, colorIndex: c.colorIndex, shape: c.shape, track: c,
            events: inView.filter(function (ev) { return ev.categorySlug === c.slug; }),
          };
        })
        .filter(function (g) { return g.events.length; });
    }

    // With only a couple of lanes there is room to label far more generously.
    var maxRows = cfg.maxRows;
    if (cfg.lane === "track" && groups.length <= 3) maxRows = Math.max(maxRows, 10);

    var y = AXIS_H;
    var laid = [];
    var bounds = { left: left - PAD_X + 4, right: width - 4 };

    groups.forEach(function (g) {
      var layout = layoutGroup(g.events, scale, maxRows, query, bounds, cfg.eventLabels);
      var labelH = cfg.laneLabel === "above" ? LANE_LABEL_H : 0;
      var height = labelH + layout.rows * cfg.rowH + LANE_PAD_B;
      laid.push({ group: g, layout: layout, top: y, height: height, labelH: labelH });
      y += height + LANE_GAP;
    });

    var plotBottom = y - LANE_GAP;
    var totalH = plotBottom + AXIS_H;

    var svg = svgEl("svg", {
      class: "timeline-svg",
      viewBox: "0 0 " + width + " " + totalH,
      width: width,
      height: totalH,
      role: "img",
      "aria-label":
        inView.length + " events across " + tracks.length + " tracks, between " +
        Math.round(viewMin) + " and " + Math.round(viewMax) +
        ". A table of the same events follows the chart.",
    });

    /* lane bands */
    laid.forEach(function (l, i) {
      svg.appendChild(svgEl("rect", {
        class: "tl-lane-band" + (i % 2 ? " is-alt" : ""),
        x: 0, y: l.top, width: width, height: l.height, rx: 6,
      }));
    });

    /* gridlines + bottom axis */
    var step = niceStep(viewMax - viewMin, Math.max(3, Math.floor(plotW / 90)));
    var gGrid = svgEl("g", {});
    var gAxis = svgEl("g", {});

    axisTicks(viewMin, viewMax, step).forEach(function (t) {
      var x = scale(t);
      var major = t % (step * 5) === 0;
      gGrid.appendChild(svgEl("line", {
        class: "tl-grid-line" + (major ? " is-decade" : ""),
        x1: x, x2: x, y1: AXIS_H - 18, y2: plotBottom + 4,
      }));
      var label = svgEl("text", { class: "tl-tick-label", x: x, y: plotBottom + 17, "text-anchor": "middle" });
      label.textContent = formatYear(t);
      gAxis.appendChild(label);
    });
    gAxis.appendChild(svgEl("line", { class: "tl-axis-line", x1: 0, x2: width, y1: plotBottom + 4, y2: plotBottom + 4 }));
    svg.appendChild(gGrid);

    /* reference guides — compare mode drops a line from each event of the
       first pinned track across the others, which is what makes "what else
       happened that year" readable rather than a matter of eyeballing. */
    if (state.mode === "compare" && groups.length > 1) {
      var refEvents = groups[0].events;
      var gRef = svgEl("g", {});
      refEvents.forEach(function (ev) {
        var rx = scale(ev.startPos);
        gRef.appendChild(svgEl("line", {
          class: "tl-ref-line", x1: rx, x2: rx, y1: laid[0].top, y2: plotBottom,
        }));
      });
      svg.appendChild(gRef);
    }

    /* "today" marker */
    var nowYear = new Date().getFullYear() + new Date().getMonth() / 12;
    if (nowYear > viewMin && nowYear < viewMax) {
      var nx = scale(nowYear);
      svg.appendChild(svgEl("line", { class: "tl-now-line", x1: nx, x2: nx, y1: AXIS_H - 18, y2: plotBottom + 4 }));
    }

    /* lanes and marks */
    laid.forEach(function (l) {
      var g = svgEl("g", {});
      var lane = l.group;

      if (cfg.laneLabel === "above" && lane.label) {
        if (lane.shape) {
          var key = svgEl("use", {
            href: "#shape-" + lane.shape, x: left - PAD_X, y: l.top + 4, width: 13, height: 13,
          });
          key.style.fill = seriesVar(lane.colorIndex);
          g.appendChild(key);
        } else if (lane.colorIndex !== null) {
          var swatch = svgEl("rect", {
            x: left - PAD_X, y: l.top + 5, width: 11, height: 11, rx: 2.5,
          });
          swatch.style.fill = seriesVar(lane.colorIndex);
          g.appendChild(swatch);
        }
        var laneLabel = svgEl("text", { class: "tl-lane-label", x: left - PAD_X + 18, y: l.top + 14 });
        laneLabel.textContent = lane.label;
        g.appendChild(laneLabel);
      }

      if (cfg.laneLabel === "gutter" && lane.label) {
        var mid = l.top + l.height / 2;
        var gk = svgEl("use", {
          href: "#shape-" + lane.shape, x: 2, y: mid - 6, width: 12, height: 12,
        });
        gk.style.fill = seriesVar(lane.colorIndex);
        g.appendChild(gk);

        var gl = svgEl("text", { class: "tl-lane-label tl-lane-label-gutter", x: 19, y: mid + 4 });
        gl.textContent = fitText(lane.label, gutter - 19 - 8, true);
        g.appendChild(gl);

        // Whole gutter row is a target: click to open this track on its own.
        // The full name lives here as <title> and aria-label — inside <text> a
        // <title> gets laid out as visible glyphs, which doubles the label.
        var jump = svgEl("rect", {
          class: "tl-gutter-hit", x: 0, y: l.top, width: gutter, height: l.height,
        });
        jump.setAttribute("role", "button");
        jump.setAttribute("tabindex", "0");
        jump.setAttribute("aria-label", "Show only " + lane.label);
        var jumpTitle = document.createElementNS(SVG_NS, "title");
        jumpTitle.textContent = lane.label;
        jump.appendChild(jumpTitle);
        var focusTrack = function () {
          state.active = new Set([lane.key]);
          setMode("lanes");
        };
        jump.addEventListener("click", focusTrack);
        jump.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); focusTrack(); }
        });
        g.appendChild(jump);
      }

      l.layout.placed.forEach(function (p) {
        var ev = p.ev;
        var cat = catBySlug[ev.categorySlug];
        var rowY = l.top + l.labelH + p.row * cfg.rowH + cfg.rowH / 2;
        var isMatch = matchesQuery(ev, query);

        var mark = svgEl("g", {
          class: "tl-mark" + (ev.highlight ? " is-highlight" : "") + (query && !isMatch ? " is-dim" : ""),
          role: "button",
          tabindex: "-1",
          "aria-label": (DATA.grouped ? ev.group + ", " : "") + ev.category + ": " + ev.title +
            ". " + eventDateText(ev) + (ev.detail ? ". " + ev.detail : ""),
        });
        mark.dataset.eventId = ev.id;

        var leftX = p.xs;
        var rightX = p.xe;

        if (ev.span) {
          var barL = Math.max(left - 12, Math.min(leftX, rightX));
          var barR = Math.min(width - PAD_X + 12, Math.max(leftX, rightX));
          var bar = svgEl("rect", {
            class: "tl-mark-span",
            x: barL, y: rowY - 4, width: Math.max(6, barR - barL), height: 8,
          });
          bar.style.fill = seriesVar(cat.colorIndex);
          bar.style.fillOpacity = "0.8";
          mark.appendChild(bar);
        }

        var shape = svgEl("use", {
          class: "tl-mark-shape",
          href: "#shape-" + cat.shape,
          x: leftX - MARK_R, y: rowY - MARK_R,
          width: MARK_R * 2, height: MARK_R * 2,
        });
        shape.style.fill = seriesVar(cat.colorIndex);
        mark.appendChild(shape);

        var markL = Math.min(leftX, rightX) - MARK_R;
        var markR = Math.max(leftX, rightX) + MARK_R;

        if (p.labelW && p.side) {
          var lbl = svgEl("text", {
            class: "tl-mark-label",
            x: p.side === "right" ? markR + LABEL_GAP : markL - LABEL_GAP,
            y: rowY + 4,
            "text-anchor": p.side === "right" ? "start" : "end",
          });
          lbl.textContent = ev.title;
          mark.appendChild(lbl);
        }

        var hitL = markL - 4 - (p.side === "left" ? LABEL_GAP + p.labelW : 0);
        var hitR = markR + 4 + (p.side === "right" ? LABEL_GAP + p.labelW : 0);
        if (hitR - hitL < HIT_MIN) {
          var mid2 = (hitL + hitR) / 2;
          hitL = mid2 - HIT_MIN / 2;
          hitR = mid2 + HIT_MIN / 2;
        }
        mark.appendChild(svgEl("rect", {
          class: "tl-focus-ring",
          x: hitL, y: rowY - cfg.rowH / 2 + 1, width: hitR - hitL, height: cfg.rowH - 2,
        }));
        mark.appendChild(svgEl("rect", {
          class: "tl-hit",
          x: hitL, y: rowY - cfg.rowH / 2, width: hitR - hitL, height: cfg.rowH,
        }));

        attachMarkEvents(mark, ev, cat);
        g.appendChild(mark);
        markNodes.push({ node: mark, ev: ev, cat: cat });
      });

      svg.appendChild(g);
    });

    svg.appendChild(gAxis);
    viewport.insertBefore(svg, tooltip);

    markNodes.sort(function (a, b) { return a.ev.startPos - b.ev.startPos; });
    setRovingFocus(state.focusId);

    viewport.classList.add("can-pan");
    drawStickyAxis(svg, width, viewMin, viewMax, scale, plotW);
    drawMinimap(width, viewMin, viewMax);
  }

  function emptyMessage(trackCount) {
    if (state.mode === "compare" && !state.pinned.size) return "Pin two or three tracks to compare them.";
    if (!trackCount) return "No tracks selected. Turn one on above.";
    if (state.from > DATA.maxYear || state.to < DATA.minYear) {
      return "You have panned past the end of the record — nothing happened here yet.";
    }
    return "No events in this period. Widen the range or choose another track.";
  }

  /* --- minimap -----------------------------------------------------------
     An unbounded axis needs an overview or you get lost in empty millennia.
     This strip shows the whole record at once — one hairline per event,
     coloured by group — with a window marking the current view. Drag the
     window to travel, drag its edges to zoom.
     ----------------------------------------------------------------------- */
  var MINIMAP_H = 46;
  var HANDLE_W = 8;
  var minimapHost = document.getElementById("tl-minimap");
  var minimapScale = null;   // shared with the pointer handlers below

  function minimapExtent() {
    // Always covers the data plus the current view, so the window is never
    // off-strip no matter how far you have panned.
    var lo = Math.min(DATA.minYear, state.from);
    var hi = Math.max(DATA.maxYear, state.to);
    var pad = Math.max(5, (hi - lo) * 0.03);
    return { lo: lo - pad, hi: hi + pad };
  }

  function drawMinimap(width, viewMin, viewMax) {
    if (!minimapHost) return;
    minimapHost.textContent = "";
    minimapHost.hidden = false;

    var ext = minimapExtent();
    var span = Math.max(1, ext.hi - ext.lo);
    var x = function (year) { return PAD_X + ((year - ext.lo) / span) * (width - PAD_X * 2); };
    minimapScale = { x: x, ext: ext, span: span, width: width };

    var svg = svgEl("svg", {
      class: "tl-minimap-svg", viewBox: "0 0 " + width + " " + MINIMAP_H,
      width: width, height: MINIMAP_H, "aria-hidden": "true",
    });

    svg.appendChild(svgEl("rect", {
      class: "tl-minimap-bg", x: 0, y: 0, width: width, height: MINIMAP_H, rx: 6,
    }));

    // Era gridlines, so the strip is readable as time and not just texture.
    var step = niceStep(span, Math.max(2, Math.floor(width / 110)));
    axisTicks(ext.lo, ext.hi, step).forEach(function (t) {
      var gx = x(t);
      svg.appendChild(svgEl("line", {
        class: "tl-minimap-grid", x1: gx, x2: gx, y1: 0, y2: MINIMAP_H,
      }));
      var lbl = svgEl("text", { class: "tl-minimap-tick", x: gx + 3, y: MINIMAP_H - 4 });
      lbl.textContent = formatYear(t);
      svg.appendChild(lbl);
    });

    // One tick per event, only for tracks currently switched on.
    var shown = new Set(visibleTracks().map(function (c) { return c.slug; }));
    DATA.events.forEach(function (ev) {
      if (!shown.has(ev.categorySlug)) return;
      var cat = catBySlug[ev.categorySlug];
      if (!cat) return;
      var x1 = x(ev.startPos);
      var x2 = ev.endPos != null ? x(ev.endPos) : x1;
      var tick = svgEl("rect", {
        class: "tl-minimap-tick-mark",
        x: Math.min(x1, x2), y: 6,
        width: Math.max(1.5, Math.abs(x2 - x1)), height: MINIMAP_H - 20, rx: 1,
      });
      tick.style.fill = seriesVar(cat.colorIndex);
      svg.appendChild(tick);
    });

    // The view window.
    var wx1 = x(viewMin);
    var wx2 = x(viewMax);
    svg.appendChild(svgEl("rect", {
      class: "tl-minimap-shade", x: 0, y: 0, width: Math.max(0, wx1), height: MINIMAP_H,
    }));
    svg.appendChild(svgEl("rect", {
      class: "tl-minimap-shade", x: wx2, y: 0, width: Math.max(0, width - wx2), height: MINIMAP_H,
    }));
    svg.appendChild(svgEl("rect", {
      class: "tl-minimap-window", x: wx1, y: 1,
      width: Math.max(3, wx2 - wx1), height: MINIMAP_H - 2, rx: 4,
    }));
    [wx1, wx2].forEach(function (hx, i) {
      svg.appendChild(svgEl("rect", {
        class: "tl-minimap-handle", "data-edge": i === 0 ? "from" : "to",
        x: hx - HANDLE_W / 2, y: 1, width: HANDLE_W, height: MINIMAP_H - 2, rx: 3,
      }));
    });

    minimapHost.appendChild(svg);
  }

  /* Minimap interaction: drag the window to pan, drag a handle to zoom, click
     anywhere else to centre the view there. */
  if (minimapHost) {
    var mmDrag = null;

    minimapHost.addEventListener("pointerdown", function (e) {
      if (!minimapScale) return;
      var rect = minimapHost.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var year = minimapScale.ext.lo +
        ((px - PAD_X) / (minimapScale.width - PAD_X * 2)) * minimapScale.span;

      var edge = e.target.getAttribute && e.target.getAttribute("data-edge");
      if (edge) {
        mmDrag = { kind: "edge", edge: edge };
      } else if (year > state.from && year < state.to) {
        mmDrag = { kind: "pan", grabOffset: year - state.from, span: state.to - state.from };
      } else {
        var half = (state.to - state.from) / 2;
        setRange(year - half, year + half);
        mmDrag = { kind: "pan", grabOffset: half, span: half * 2 };
      }
      // Guarded: setPointerCapture throws if the pointer id isn't active, and an
      // exception here would skip the class and preventDefault below, leaving a
      // drag that never visually starts but still tracks the pointer.
      try { minimapHost.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      minimapHost.classList.add("is-dragging");
      e.preventDefault();
    });

    minimapHost.addEventListener("pointermove", function (e) {
      if (!mmDrag || !minimapScale) return;
      var rect = minimapHost.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var year = minimapScale.ext.lo +
        ((px - PAD_X) / (minimapScale.width - PAD_X * 2)) * minimapScale.span;

      if (mmDrag.kind === "pan") {
        var lo = year - mmDrag.grabOffset;
        var v = clampView(lo, lo + mmDrag.span);
        state.from = v.from; state.to = v.to;
      } else if (mmDrag.edge === "from") {
        var v2 = clampView(Math.min(year, state.to - MIN_SPAN_YEARS), state.to);
        state.from = v2.from; state.to = v2.to;
      } else {
        var v3 = clampView(state.from, Math.max(year, state.from + MIN_SPAN_YEARS));
        state.from = v3.from; state.to = v3.to;
      }
      syncRangeInputs();
      requestRender();
    });

    ["pointerup", "pointercancel"].forEach(function (type) {
      minimapHost.addEventListener(type, function () {
        mmDrag = null;
        minimapHost.classList.remove("is-dragging");
      });
    });
  }

  /* --- sticky axis -------------------------------------------------------
     SVG has no position:sticky, so the top axis lives in its own small SVG in
     a sticky wrapper beside the chart. It is the only top axis, not a copy.
     ----------------------------------------------------------------------- */
  function drawStickyAxis(chartSvg, width, viewMin, viewMax, scale, plotW) {
    if (!axisHost) return;
    axisHost.textContent = "";
    if (!chartSvg) { axisHost.hidden = true; return; }
    axisHost.hidden = false;

    var svg = svgEl("svg", {
      class: "timeline-axis-svg", viewBox: "0 0 " + width + " " + AXIS_H,
      width: width, height: AXIS_H, "aria-hidden": "true",
    });

    var step = niceStep(viewMax - viewMin, Math.max(3, Math.floor(plotW / 90)));
    axisTicks(viewMin, viewMax, step).forEach(function (t) {
      var label = svgEl("text", {
        class: "tl-tick-label", x: scale(t), y: AXIS_H - 9, "text-anchor": "middle",
      });
      label.textContent = formatYear(t);
      svg.appendChild(label);
    });

    var nowYear = new Date().getFullYear() + new Date().getMonth() / 12;
    if (nowYear > viewMin && nowYear < viewMax) {
      var nl = svgEl("text", { class: "tl-now-label", x: scale(nowYear), y: 10, "text-anchor": "middle" });
      nl.textContent = "NOW";
      svg.appendChild(nl);
    }

    svg.appendChild(svgEl("line", { class: "tl-axis-line", x1: 0, x2: width, y1: AXIS_H - 4, y2: AXIS_H - 4 }));
    axisHost.appendChild(svg);
  }

  /* --- mark interaction -------------------------------------------------- */
  function attachMarkEvents(mark, ev, cat) {
    function open() {
      clearTimeout(hideTimer);
      showTooltip(ev, cat, mark.getBoundingClientRect());
      state.focusId = ev.id;
    }
    mark.addEventListener("pointerenter", open);
    mark.addEventListener("pointerleave", function () { hideTooltip(); });
    // Keyboard focus is handled by one delegated focusin/focusout pair on the
    // viewport rather than two listeners on each of ~100 marks.
    mark.addEventListener("click", function () {
      open();
      if (ev.link) window.open(ev.link, "_blank", "noopener");
    });
    mark.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (ev.link) window.open(ev.link, "_blank", "noopener");
        else open();
      }
    });
  }

  // Roving tabindex: one tab stop for the whole chart, arrow keys move within.
  function setRovingFocus(id, moveFocus) {
    if (!markNodes.length) return;
    var idx = markNodes.findIndex(function (m) { return m.ev.id === id; });
    if (idx < 0) idx = 0;
    markNodes.forEach(function (m, i) {
      m.node.setAttribute("tabindex", i === idx ? "0" : "-1");
      m.node.classList.toggle("is-active", i === idx && moveFocus === true);
    });
    if (moveFocus === true) {
      markNodes[idx].node.focus();
      state.focusId = markNodes[idx].ev.id;
    }
  }

  // Keyboard tooltips, delegated: focusin bubbles, focus does not.
  viewport.addEventListener("focusin", function (e) {
    var node = e.target.closest ? e.target.closest(".tl-mark") : null;
    if (!node) return;
    var entry = markNodes.find(function (m) { return m.node === node; });
    if (!entry) return;
    state.focusId = entry.ev.id;
    showTooltip(entry.ev, entry.cat, node.getBoundingClientRect());
  });

  viewport.addEventListener("focusout", function (e) {
    if (e.target.closest && e.target.closest(".tl-mark")) hideTooltip();
  });

  viewport.addEventListener("keydown", function (e) {
    if (!markNodes.length) return;
    if (["ArrowRight", "ArrowLeft", "Home", "End"].indexOf(e.key) === -1) return;
    var idx = markNodes.findIndex(function (m) { return m.ev.id === state.focusId; });
    if (idx < 0) idx = 0;
    if (e.key === "ArrowRight") idx = Math.min(markNodes.length - 1, idx + 1);
    if (e.key === "ArrowLeft") idx = Math.max(0, idx - 1);
    if (e.key === "Home") idx = 0;
    if (e.key === "End") idx = markNodes.length - 1;
    e.preventDefault();
    setRovingFocus(markNodes[idx].ev.id, true);
  });

  /* --- legend, status, table -------------------------------------------- */
  var legendEl = document.getElementById("tl-legend");
  var countEl = document.getElementById("tl-count");

  function renderLegend(tracks) {
    if (!legendEl) return;
    legendEl.textContent = "";

    // Roll-up draws one lane per group, so the legend names groups there.
    var items = state.mode === "rollup"
      ? (DATA.groups || []).filter(function (g) {
          return tracks.some(function (c) { return c.groupSlug === g.slug; });
        }).map(function (g) { return { label: g.name, colorIndex: g.colorIndex, shape: null }; })
      : tracks.map(function (c) {
          return { label: DATA.grouped ? c.group + " · " + c.name : c.name, colorIndex: c.colorIndex, shape: c.shape };
        });

    if (items.length < 2) { legendEl.hidden = true; return; }
    legendEl.hidden = false;

    items.forEach(function (it) {
      var item = document.createElement("span");
      item.className = "tl-legend-item";
      if (it.shape) {
        item.appendChild(shapeKey(it.colorIndex, it.shape, "tl-legend-key"));
      } else {
        var sw = document.createElement("span");
        sw.className = "tl-legend-swatch";
        sw.style.background = seriesVar(it.colorIndex);
        item.appendChild(sw);
      }
      item.appendChild(document.createTextNode(it.label));
      legendEl.appendChild(item);
    });
  }

  function updateStatus(shown, matched, trackCount) {
    if (!countEl) return;
    var text = shown + (shown === 1 ? " event" : " events") +
      " across " + trackCount + (trackCount === 1 ? " track" : " tracks");
    if (matched !== null && matched !== undefined) {
      text += " · " + matched + " matching “" + state.query.trim() + "”";
    }
    countEl.textContent = text;
  }

  var tableBody = document.querySelector("#tl-table tbody");
  var tableRows = Array.prototype.slice.call(document.querySelectorAll("#tl-table tbody tr"));
  var tableCaption = document.getElementById("tl-table-caption");

  /* The table is server-rendered so it works without JavaScript, but once the
     model can change (the editor adds and removes events) it has to be built
     from the model instead. Rebuilding on load keeps one source of truth rather
     than two subtly different renderings. */
  function renderTableBody() {
    if (!tableBody) return;
    tableBody.textContent = "";

    DATA.events.forEach(function (ev) {
      var cat = catBySlug[ev.categorySlug];
      if (!cat) return;

      var tr = document.createElement("tr");
      tr.dataset.category = ev.categorySlug;
      tr.dataset.group = ev.groupSlug || "";
      tr.dataset.start = ev.startYear;
      tr.dataset.end = ev.endYear == null ? ev.startYear : ev.endYear;
      tr.dataset.eventId = ev.id;

      var date = document.createElement("td");
      date.className = "col-date";
      date.textContent = ev.end ? ev.start + " – " + ev.end : ev.start;
      tr.appendChild(date);

      var title = document.createElement("th");
      title.setAttribute("scope", "row");
      title.style.fontWeight = "600";
      if (ev.link) {
        var a = document.createElement("a");
        a.href = ev.link;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = ev.title;
        title.appendChild(a);
      } else {
        title.textContent = ev.title;
      }
      if (ev.verify) {
        var mark = document.createElement("span");
        mark.className = "unverified-mark";
        mark.textContent = "unverified";
        mark.title = "This source has not been checked against an authoritative record.";
        title.appendChild(document.createTextNode(" "));
        title.appendChild(mark);
      }
      tr.appendChild(title);

      var grp = document.createElement("td");
      grp.textContent = ev.group || "";
      tr.appendChild(grp);

      var track = document.createElement("td");
      var cell = document.createElement("span");
      cell.className = "cat-cell";
      cell.appendChild(shapeKey(cat.colorIndex, cat.shape, "cat-key"));
      cell.appendChild(document.createTextNode(ev.category));
      track.appendChild(cell);
      tr.appendChild(track);

      var detail = document.createElement("td");
      detail.textContent = ev.detail || "";
      tr.appendChild(detail);

      var loc = document.createElement("td");
      loc.textContent = ev.location || "";
      tr.appendChild(loc);

      tableBody.appendChild(tr);
    });

    tableRows = Array.prototype.slice.call(tableBody.querySelectorAll("tr"));
    if (editorHook) editorHook.decorateTable(tableBody);
  }

  // Track and period filters remove rows; a search query only de-emphasises
  // them, exactly as it dims marks in the chart. Keeping the two identical is
  // what stops the chart and the table reporting different counts.
  function syncTable(shown) {
    var q = state.query.trim().toLowerCase();
    var visible = 0;
    var matched = 0;

    tableRows.forEach(function (row) {
      var s = Number(row.dataset.start);
      var e = Number(row.dataset.end);
      var inScope = shown.has(row.dataset.category) &&
        e >= Math.floor(state.from) && s <= Math.ceil(state.to);
      var isMatch = !q || row.textContent.toLowerCase().indexOf(q) !== -1;

      row.hidden = !inScope;
      row.classList.toggle("is-dim", inScope && !isMatch);
      if (inScope) { visible++; if (isMatch) matched++; }
    });

    if (tableCaption) {
      var text = visible + (visible === 1 ? " event" : " events") +
        " · " + Math.round(state.from) + "–" + Math.round(state.to);
      if (q) text += " · " + matched + " matching “" + state.query.trim() + "”";
      tableCaption.textContent = text + ".";
    }
  }

  /* --- filter panel ------------------------------------------------------ */
  var filterBody = document.getElementById("tl-filter-body");
  var filterToggle = document.getElementById("tl-filter-toggle");
  var filterCount = document.getElementById("tl-filter-count");
  var filterKeys = document.getElementById("tl-filter-keys");
  var trackSearch = document.getElementById("tl-track-search");

  function trackChecks() {
    return Array.prototype.slice.call(document.querySelectorAll(".tl-track-check"));
  }

  function syncFilterUi() {
    trackChecks().forEach(function (box) {
      box.checked = state.active.has(box.dataset.track);
      var row = box.closest(".filter-track");
      if (row) row.classList.toggle("is-pinned", state.pinned.has(box.dataset.track));
    });

    // Group boxes are tri-state: all / some / none of their tracks active.
    document.querySelectorAll(".tl-group-check").forEach(function (box) {
      var g = groupBySlug[box.dataset.group];
      if (!g) return;
      var on = g.tracks.filter(function (t) { return state.active.has(t); }).length;
      box.checked = on === g.tracks.length;
      box.indeterminate = on > 0 && on < g.tracks.length;
    });

    if (filterCount) {
      filterCount.textContent = state.active.size + " of " + DATA.categories.length;
    }

    if (filterKeys) {
      filterKeys.textContent = "";
      DATA.categories.filter(function (c) { return state.active.has(c.slug); }).forEach(function (c) {
        var k = shapeKey(c.colorIndex, c.shape, "filter-key");
        k.setAttribute("role", "img");
        k.setAttribute("aria-label", c.name);
        k.removeAttribute("aria-hidden");
        filterKeys.appendChild(k);
      });
    }
  }

  /* The panel is server-rendered, which is what a reader gets. Only the editor
     can change the set of tracks, so only the editor pays for rebuilding it. */
  function renderFilterPanel() {
    var host = document.querySelector(".filter-groups");
    if (!host) return;
    host.textContent = "";

    (DATA.groups || []).forEach(function (group) {
      var wrap = document.createElement("div");
      wrap.className = "filter-group";
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-labelledby", "grp-" + group.slug + "-label");

      var head = document.createElement("div");
      head.className = "filter-group-head";
      var headLabel = document.createElement("label");
      headLabel.className = "filter-check";
      headLabel.id = "grp-" + group.slug + "-label";
      var gBox = document.createElement("input");
      gBox.type = "checkbox";
      gBox.className = "tl-group-check";
      gBox.dataset.group = group.slug;
      headLabel.appendChild(gBox);
      var sw = document.createElement("span");
      sw.className = "filter-swatch";
      sw.style.background = seriesVar(group.colorIndex);
      headLabel.appendChild(sw);
      var gName = document.createElement("span");
      gName.className = "filter-group-name";
      gName.textContent = group.name;
      headLabel.appendChild(gName);
      head.appendChild(headLabel);
      var gCount = document.createElement("span");
      gCount.className = "chip-count";
      gCount.textContent = group.count;
      head.appendChild(gCount);
      wrap.appendChild(head);

      var list = document.createElement("div");
      list.className = "filter-tracks";
      DATA.categories.filter(function (c) { return c.groupSlug === group.slug; }).forEach(function (cat) {
        var row = document.createElement("div");
        row.className = "filter-track";
        row.dataset.search = (cat.name + " " + cat.group).toLowerCase();

        var label = document.createElement("label");
        label.className = "filter-check";
        var box = document.createElement("input");
        box.type = "checkbox";
        box.className = "tl-track-check";
        box.dataset.track = cat.slug;
        label.appendChild(box);
        label.appendChild(shapeKey(cat.colorIndex, cat.shape, "filter-key"));
        var name = document.createElement("span");
        name.className = "filter-track-name";
        name.textContent = cat.name;
        label.appendChild(name);
        row.appendChild(label);

        var count = document.createElement("span");
        count.className = "chip-count";
        count.textContent = cat.count;
        row.appendChild(count);

        [["tl-only", "Only", "Show only this track"], ["tl-pin", "Pin", "Pin for comparison"]].forEach(function (spec) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "btn btn-tiny " + spec[0];
          b.dataset.track = cat.slug;
          b.textContent = spec[1];
          b.title = spec[2];
          if (spec[0] === "tl-pin") b.setAttribute("aria-pressed", String(state.pinned.has(cat.slug)));
          row.appendChild(b);
        });

        list.appendChild(row);
      });
      wrap.appendChild(list);
      host.appendChild(wrap);
    });
  }

  // Single entry point for "the data changed": recompute, redraw everything.
  function applyModelChange() {
    rebuildModel();
    renderFilterPanel();
    renderTableBody();
    // The view is not re-clamped to the data here: adding an ancient event must
    // not yank the reader somewhere else. clampView keeps it inside the world.
    var v = clampView(state.from, state.to);
    state.from = v.from;
    state.to = v.to;
    syncRangeInputs();
    render();
  }

  if (filterToggle && filterBody) {
    filterToggle.addEventListener("click", function () {
      var open = filterBody.hidden;
      filterBody.hidden = !open;
      filterToggle.setAttribute("aria-expanded", String(open));
    });
  }

  if (filterBody) {
    filterBody.addEventListener("change", function (e) {
      var box = e.target;
      if (box.classList.contains("tl-track-check")) {
        if (box.checked) state.active.add(box.dataset.track);
        else state.active.delete(box.dataset.track);
        render();
      } else if (box.classList.contains("tl-group-check")) {
        var g = groupBySlug[box.dataset.group];
        if (!g) return;
        g.tracks.forEach(function (t) {
          if (box.checked) state.active.add(t); else state.active.delete(t);
        });
        render();
      }
    });

    filterBody.addEventListener("click", function (e) {
      var only = e.target.closest(".tl-only");
      if (only) {
        state.active = new Set([only.dataset.track]);
        render();
        return;
      }
      var pin = e.target.closest(".tl-pin");
      if (pin) {
        var slug = pin.dataset.track;
        if (state.pinned.has(slug)) state.pinned.delete(slug);
        else {
          if (state.pinned.size >= 3) state.pinned.delete(state.pinned.values().next().value);
          state.pinned.add(slug);
        }
        pin.setAttribute("aria-pressed", String(state.pinned.has(slug)));
        render();
      }
    });
  }

  var selectAll = document.getElementById("tl-select-all");
  if (selectAll) {
    selectAll.addEventListener("click", function () {
      state.active = new Set(DATA.categories.map(function (c) { return c.slug; }));
      render();
    });
  }
  var clearAll = document.getElementById("tl-clear-all");
  if (clearAll) {
    clearAll.addEventListener("click", function () {
      state.active = new Set();
      render();
    });
  }

  if (trackSearch) {
    trackSearch.addEventListener("input", function () {
      var q = trackSearch.value.trim().toLowerCase();
      document.querySelectorAll(".filter-track").forEach(function (row) {
        row.hidden = q ? row.dataset.search.indexOf(q) === -1 : false;
      });
      document.querySelectorAll(".filter-group").forEach(function (grp) {
        var any = Array.prototype.slice.call(grp.querySelectorAll(".filter-track"))
          .some(function (r) { return !r.hidden; });
        grp.hidden = !any;
      });
    });
  }

  /* --- period, zoom, modes ----------------------------------------------- */
  var fromEl = document.getElementById("tl-from");
  var toEl = document.getElementById("tl-to");
  var searchEl = document.getElementById("tl-search");
  var durationEl = document.getElementById("tl-duration");

  if (durationEl) {
    durationEl.addEventListener("change", function () {
      var v = Number(durationEl.value);
      state.minDuration = Number.isFinite(v) && v > 0 ? v : 0;
      render();
    });
  }

  function setRange(lo, hi) {
    var v = clampView(lo, hi);
    state.from = v.from;
    state.to = v.to;
    syncRangeInputs();
    render();
  }

  // The inputs are text, not number, so BC can be typed directly.
  function syncRangeInputs() {
    fromEl.value = formatYear(state.from);
    toEl.value = formatYear(state.to);
  }

  // "All" fits the data rather than the world envelope — panning past the edges
  // stays possible, but the default view is always where the events are. The pad
  // is just enough that edge markers aren't clipped, capped so a 4,000-year span
  // doesn't trail decades of blank future.
  function fitToData() {
    var pad = Math.min(40, Math.max(2, (DATA.maxYear - DATA.minYear) * 0.01));
    setRange(DATA.minYear - pad, DATA.maxYear + pad);
  }

  document.getElementById("tl-presets").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-range]");
    if (!btn) return;
    var spec = btn.dataset.range;
    if (spec === "all") return fitToData();
    if (spec.charAt(0) === "~") {           // "~25" = the last N years
      var years = Number(spec.slice(1));
      return setRange(DATA.maxYear - years, DATA.maxYear);
    }
    // Written as display years ("3000 BC,AD 500") so the markup reads the way a
    // person would say it, rather than in astronomical offsets.
    var parts = spec.split(",");
    var lo = parts[0] ? parseYearInput(parts[0]) : null;
    var hi = parts[1] ? parseYearInput(parts[1]) : null;
    setRange(lo === null ? DATA.minYear : lo, hi === null ? DATA.maxYear : hi);
  });

  [fromEl, toEl].forEach(function (el) {
    el.addEventListener("change", function () {
      var lo = parseYearInput(fromEl.value);
      var hi = parseYearInput(toEl.value);
      if (lo === null || hi === null) { syncRangeInputs(); return; }
      setRange(Math.min(lo, hi), Math.max(lo, hi));
    });
  });

  /** Accepts "776 BC", "AD 79", "-500", "1896". Returns null if unreadable. */
  function parseYearInput(text) {
    text = String(text || "").trim();
    if (!text) return null;
    var m = text.match(/^(\d{1,6})\s*(?:BC|BCE)$/i);
    if (m) return 1 - Number(m[1]);
    m = text.match(/^(?:AD|CE)\s*(\d{1,4})$/i) || text.match(/^(\d{1,4})\s*(?:AD|CE)$/i);
    if (m) return Number(m[1]);
    m = text.match(/^(-?\d{1,6})$/);
    return m ? Number(m[1]) : null;
  }

  var modeButtons = Array.prototype.slice.call(document.querySelectorAll("[data-mode]"));

  function setMode(mode) {
    if (!MODES[mode]) mode = "lanes";
    // Entering compare with nothing pinned: seed it from what is on screen.
    if (mode === "compare" && !state.pinned.size) {
      DATA.categories
        .filter(function (c) { return state.active.has(c.slug); })
        .slice(0, 2)
        .forEach(function (c) { state.pinned.add(c.slug); });
      document.querySelectorAll(".tl-pin").forEach(function (b) {
        b.setAttribute("aria-pressed", String(state.pinned.has(b.dataset.track)));
      });
    }
    state.mode = mode;
    modeButtons.forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    });
    document.body.classList.toggle("tl-compare", mode === "compare");
    render();
  }

  modeButtons.forEach(function (b) {
    b.addEventListener("click", function () { setMode(b.dataset.mode); });
  });

  function zoom(factor) {
    var mid = (state.from + state.to) / 2;
    var half = ((state.to - state.from) * factor) / 2;
    setRange(mid - half, mid + half);
  }
  document.getElementById("tl-zoom-in").addEventListener("click", function () { zoom(0.6); });
  document.getElementById("tl-zoom-out").addEventListener("click", function () { zoom(1 / 0.6); });
  document.getElementById("tl-reset").addEventListener("click", function () {
    state.query = "";
    if (searchEl) searchEl.value = "";
    if (trackSearch) { trackSearch.value = ""; trackSearch.dispatchEvent(new Event("input")); }
    state.active = new Set(DATA.categories.map(function (c) { return c.slug; }));
    state.pinned = new Set();
    document.querySelectorAll(".tl-pin").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
    state.minDuration = 0;
    if (durationEl) durationEl.value = "0";
    setMode("lanes");
    fitToData();
  });

  if (searchEl) {
    var debounce;
    searchEl.addEventListener("input", function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () { state.query = searchEl.value; render(); }, 140);
    });
  }

  var tableToggle = document.getElementById("tl-table-toggle");
  var tableWrap = document.getElementById("tl-table-wrap");
  if (tableToggle && tableWrap) {
    tableToggle.hidden = false;
    var setTable = function (open) {
      tableWrap.hidden = !open;
      tableToggle.setAttribute("aria-expanded", String(open));
      tableToggle.textContent = open ? "Hide table" : "Show table";
    };
    setTable(false);
    tableToggle.addEventListener("click", function () { setTable(tableWrap.hidden); });
  }

  /* --- pan & pinch-zoom -------------------------------------------------- */
  var drag = null;
  var panFrame = null;

  // Coalesce pan renders into one per frame. Rendering per pointermove is fine
  // at 50 events and visibly stutters at several hundred.
  function requestRender() {
    if (panFrame) return;
    panFrame = requestAnimationFrame(function () { panFrame = null; render(); });
  }

  // Panning is always available now — there is no "you have the whole dataset"
  // stop, because the axis extends well past the data in both directions.
  viewport.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".tl-mark") || e.target.closest(".tl-gutter-hit")) return;
    drag = { x: e.clientX, from: state.from, to: state.to };
    try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    viewport.classList.add("is-panning");
  });

  viewport.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var cfg = MODES[state.mode] || MODES.lanes;
    var plotW = Math.max(1, viewport.clientWidth - PAD_X * 2 - gutterFor(viewport.clientWidth, cfg));
    var perPx = (drag.to - drag.from) / plotW;
    var shift = (e.clientX - drag.x) * perPx;
    var v = clampView(drag.from - shift, drag.to - shift);
    state.from = v.from;
    state.to = v.to;
    syncRangeInputs();
    requestRender();
  });

  ["pointerup", "pointercancel"].forEach(function (type) {
    viewport.addEventListener(type, function () {
      drag = null;
      viewport.classList.remove("is-panning");
    });
  });

  viewport.addEventListener("wheel", function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1 / 0.9 : 0.9);
  }, { passive: false });

  /* --- URL state --------------------------------------------------------- */
  function writeUrl() {
    var p = new URLSearchParams();
    if (state.active.size !== DATA.categories.length) {
      p.set("tracks", Array.from(state.active).join(","));
    }
    p.set("from", String(Math.round(state.from)));
    p.set("to", String(Math.round(state.to)));
    if (state.mode !== "lanes") p.set("mode", state.mode);
    if (state.minDuration) p.set("dur", String(state.minDuration));
    if (state.pinned.size) p.set("pin", Array.from(state.pinned).join(","));
    if (state.query.trim()) p.set("q", state.query.trim());
    var hash = p.toString();
    history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
  }

  function readUrl() {
    if (!location.hash || location.hash.length < 2) return;
    var p = new URLSearchParams(location.hash.slice(1));

    var tracks = p.get("tracks");
    if (tracks) {
      var wanted = new Set(tracks.split(",").filter(function (s) { return catBySlug[s]; }));
      if (wanted.size) state.active = wanted;
    }

    var pin = p.get("pin");
    if (pin) {
      pin.split(",").filter(function (s) { return catBySlug[s]; })
        .slice(0, 3).forEach(function (s) { state.pinned.add(s); });
      document.querySelectorAll(".tl-pin").forEach(function (b) {
        b.setAttribute("aria-pressed", String(state.pinned.has(b.dataset.track)));
      });
    }

    var from = Number(p.get("from"));
    var to = Number(p.get("to"));
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
      var v = clampView(from, to);
      state.from = v.from; state.to = v.to;
      syncRangeInputs();
    }

    var dur = Number(p.get("dur"));
    if (Number.isFinite(dur) && dur > 0) {
      state.minDuration = dur;
      if (durationEl) durationEl.value = String(dur);
    }

    var mode = p.get("mode");
    if (mode && MODES[mode]) {
      state.mode = mode;
      modeButtons.forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
      });
      document.body.classList.toggle("tl-compare", mode === "compare");
    }

    var q = p.get("q");
    if (q && searchEl) { state.query = q; searchEl.value = q; }
  }

  /* --- lifecycle --------------------------------------------------------- */
  // The sticky axis has to clear the sticky site header.
  function measureHeader() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    document.documentElement.style.setProperty("--header-h", header.offsetHeight + "px");
  }

  var resizeTimer;
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { measureHeader(); render(); }, 80);
    }).observe(viewport);
  } else {
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { measureHeader(); render(); }, 120);
    });
  }

  window.addEventListener("themechange", hideTooltip);

  // The container can have zero width at script time — a background tab, a
  // still-loading stylesheet, a collapsed parent. render() declines to draw at
  // zero, so keep asking across frames until layout exists.
  function firstRender(attempt) {
    if (viewport.clientWidth) { measureHeader(); render(); return; }
    if (attempt > 90) return;
    requestAnimationFrame(function () { firstRender(attempt + 1); });
  }

  /* --- editor seam -------------------------------------------------------
     The editor is author-only, so it is a separate file fetched solely when
     ?edit is in the URL. Readers download none of it. This object is the whole
     contract between the two.
     ----------------------------------------------------------------------- */
  window.__timeline = {
    DATA: DATA,
    SHAPES: SHAPES,
    MAX_SLOTS: MAX_SLOTS,
    state: state,
    applyModelChange: applyModelChange,
    render: render,
    shapeKey: shapeKey,
    seriesVar: seriesVar,
    slugify: function (s) {
      return String(s).toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
    },
    setEditorHook: function (hook) { editorHook = hook; },
  };

  readUrl();
  // The template renders raw astronomical years; show them as BC/AD from the
  // first paint rather than only after the reader touches something.
  syncRangeInputs();
  renderTableBody();
  firstRender(0);
  window.addEventListener("load", function () { firstRender(0); });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) firstRender(0);
  });

  if (new URLSearchParams(location.search).has("edit")) {
    var s = document.createElement("script");
    s.src = dataEl.dataset.editorSrc || "/assets/js/timeline-editor.js";
    s.defer = true;
    document.body.appendChild(s);
  }
})();
