/* Articles filter.
 *
 * Every row is already in the HTML — this only hides rows that don't match.
 * That means the page is complete without JavaScript, and that filtering can
 * never disagree with what was published, because there is one list.
 *
 * Three facets, combined the way a reader expects:
 *   within a facet  -> OR   (op-ed or blog)
 *   between facets  -> AND  (an op-ed AND tagged sport AND matching "doping")
 */
(function () {
  "use strict";

  var form = document.getElementById("artfilter");
  if (!form) return;

  var search = document.getElementById("artsearch");
  var reset = document.getElementById("artreset");
  var status = document.getElementById("artstatus");
  var empty = document.getElementById("artempty");

  var items = [].slice.call(document.querySelectorAll(".art"));
  var years = [].slice.call(document.querySelectorAll(".artyear"));
  var total = items.length;

  /* Read the DOM once. Re-reading dataset on every keystroke is the difference
     between filtering as you type and filtering after you stop. */
  var rows = items.map(function (el) {
    return {
      el: el,
      type: el.dataset.type || "",
      tags: (el.dataset.tags || "").split(" ").filter(Boolean),
      hay: el.dataset.hay || "",
    };
  });

  var boxes = [].slice.call(form.querySelectorAll('input[type="checkbox"]'));

  function selected(facet) {
    var out = [];
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].dataset.facet === facet && boxes[i].checked) out.push(boxes[i].value);
    }
    return out;
  }

  // OR within the topic facet: a row matching any selected tag qualifies.
  function hasAny(have, want) {
    for (var i = 0; i < want.length; i++) {
      if (have.indexOf(want[i]) !== -1) return true;
    }
    return false;
  }

  function apply() {
    var types = selected("type");
    var tags = selected("tag");
    /* Split on whitespace so "doping india" narrows rather than looking for
       that exact phrase — which is how every other search box behaves. */
    var terms = (search.value || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    var active = types.length || tags.length || terms.length;

    var shown = 0;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var ok = true;

      if (ok && types.length) ok = types.indexOf(r.type) !== -1;

      if (ok && tags.length) ok = hasAny(r.tags, tags);

      if (ok && terms.length) {
        for (var q = 0; q < terms.length; q++) {
          if (r.hay.indexOf(terms[q]) === -1) { ok = false; break; }
        }
      }

      r.el.hidden = !ok;
      if (ok) shown++;
    }

    // A year heading with nothing under it is noise.
    for (var y = 0; y < years.length; y++) {
      years[y].hidden = !years[y].querySelector(".art:not([hidden])");
    }

    empty.hidden = shown !== 0;
    reset.hidden = !active;

    status.textContent = !active
      ? "Showing all " + total + " articles."
      : shown === 0
        ? "No articles match."
        : "Showing " + shown + " of " + total + " articles.";
  }

  /* Delegated, so this stays one listener however many chips the data grows to. */
  form.addEventListener("change", apply);

  /* `input` rather than `keyup`: it fires for paste, for the search field's
     native clear button, and for dictation, none of which raise a key event. */
  search.addEventListener("input", apply);

  reset.addEventListener("click", function () {
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
    search.value = "";
    apply();
    search.focus();
  });

  /* Enter in a search field submits the form; the form is inert but the browser
     still fires submit, and some will scroll. */
  form.addEventListener("submit", function (e) { e.preventDefault(); });

  /* Back/forward restores form state without firing change or input, so the
     controls and the list would disagree until the reader touched something. */
  window.addEventListener("pageshow", apply);

  apply();
})();
