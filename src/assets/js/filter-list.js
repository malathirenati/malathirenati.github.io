/* Shared list filter — Articles, Books and Careers.
 *
 * Every row is already in the HTML; this only hides rows that don't match. The
 * page is therefore complete without JavaScript, and filtering can never
 * disagree with what was published, because there is one list.
 *
 * Facets combine the way a reader expects:
 *   within a facet  -> OR   (op-ed or blog)
 *   between facets  -> AND  (an op-ed AND tagged sport AND matching "doping")
 *
 * Driven entirely by attributes so one copy serves every page:
 *
 *   [data-filter-root]              the container; one instance per root
 *     [data-noun="articles"]        plural noun for the status line
 *     [data-fsearch]                text input
 *     [data-fstatus]                live region for the count
 *     [data-fempty]                 shown when nothing matches
 *     [data-freset]                 clears everything; hidden when inactive
 *     input[data-facet="type"]      a chip; its value is matched against...
 *     [data-fitem][data-type="..."] ...the item's matching attribute
 *       [data-hay]                  lowercased search text, built at build time
 *     [data-fgroup]                 heading block, hidden when it has no items
 */
(function () {
  "use strict";

  function init(root) {
    var search = root.querySelector("[data-fsearch]");
    var status = root.querySelector("[data-fstatus]");
    var empty = root.querySelector("[data-fempty]");
    var reset = root.querySelector("[data-freset]");
    var noun = root.getAttribute("data-noun") || "items";

    var groups = [].slice.call(root.querySelectorAll("[data-fgroup]"));
    var boxes = [].slice.call(root.querySelectorAll('input[data-facet]'));

    /* Read the DOM once. Re-reading dataset on every keystroke is the
       difference between filtering as you type and filtering after you stop. */
    var facets = [];
    for (var i = 0; i < boxes.length; i++) {
      var f = boxes[i].getAttribute("data-facet");
      if (facets.indexOf(f) === -1) facets.push(f);
    }

    var rows = [].slice.call(root.querySelectorAll("[data-fitem]")).map(function (el) {
      var values = {};
      for (var j = 0; j < facets.length; j++) {
        values[facets[j]] = (el.getAttribute("data-" + facets[j]) || "")
          .split(" ").filter(Boolean);
      }
      return { el: el, values: values, hay: el.getAttribute("data-hay") || "" };
    });
    var total = rows.length;
    if (!total) return;

    function selected(facet) {
      var out = [];
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].getAttribute("data-facet") === facet && boxes[i].checked) {
          out.push(boxes[i].value);
        }
      }
      return out;
    }

    // OR within a facet: a row matching any selected value qualifies.
    function hasAny(have, want) {
      for (var i = 0; i < want.length; i++) {
        if (have.indexOf(want[i]) !== -1) return true;
      }
      return false;
    }

    function apply() {
      var chosen = {}, active = false;
      for (var f = 0; f < facets.length; f++) {
        chosen[facets[f]] = selected(facets[f]);
        if (chosen[facets[f]].length) active = true;
      }

      /* Split on whitespace so "doping india" narrows rather than looking for
         that exact phrase — which is how every other search box behaves. */
      var terms = ((search && search.value) || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
      if (terms.length) active = true;

      var shown = 0;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i], ok = true;

        for (var k = 0; ok && k < facets.length; k++) {
          var want = chosen[facets[k]];
          if (want.length) ok = hasAny(r.values[facets[k]], want);
        }

        if (ok && terms.length) {
          for (var q = 0; q < terms.length; q++) {
            if (r.hay.indexOf(terms[q]) === -1) { ok = false; break; }
          }
        }

        r.el.hidden = !ok;
        if (ok) shown++;
      }

      // A group heading with nothing under it is noise.
      for (var g = 0; g < groups.length; g++) {
        groups[g].hidden = !groups[g].querySelector("[data-fitem]:not([hidden])");
      }

      if (empty) empty.hidden = shown !== 0;
      if (reset) reset.hidden = !active;

      if (status) {
        status.textContent = !active
          ? "Showing all " + total + " " + noun + "."
          : shown === 0
            ? "No " + noun + " match."
            : "Showing " + shown + " of " + total + " " + noun + ".";
      }
    }

    /* Delegated, so this stays one listener however many chips the data grows to. */
    root.addEventListener("change", apply);

    /* `input` rather than `keyup`: it fires for paste, for the search field's
       native clear button, and for dictation, none of which raise a key event. */
    if (search) search.addEventListener("input", apply);

    if (reset) {
      reset.addEventListener("click", function () {
        for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
        if (search) { search.value = ""; }
        apply();
        if (search) search.focus();
      });
    }

    /* Enter in a search field submits the form; the form is inert but the
       browser still fires submit, and some will scroll. */
    root.addEventListener("submit", function (e) { e.preventDefault(); });

    /* Back/forward restores form state without firing change or input, so the
       controls and the list would disagree until the reader touched something. */
    window.addEventListener("pageshow", apply);

    apply();
  }

  var roots = document.querySelectorAll("[data-filter-root]");
  for (var i = 0; i < roots.length; i++) init(roots[i]);
})();
