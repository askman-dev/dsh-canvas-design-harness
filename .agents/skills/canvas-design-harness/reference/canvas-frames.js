/* Canvas frame kit - Figma-like multi-page canvas.
 * Each page (.cf-page) owns one infinite canvas (.cf-stage) with its own
 * pan/zoom state; page tabs (.cf-pagetab) switch pages. Launch sheets
 * (.cf-ls) can switch internal states without navigation.
 * Embed a copy into each visualization fragment. Expects:
 *   root#canvas-frames-demo
 *   button.cf-pagetab (one per page)
 *   .cf-page > (.cf-flow)? + .cf-stage
 *   .cf-stage > .cf-canvas-viewport > .cf-canvas-inner > .cf-canvas
 *   .cf-fig > .cf-frame-wrap > .cf-frame
 *   .cf-zoombar with [data-zoom] buttons and .cf-zoom-value
 *   .cf-ls with [data-ls-state] panels, [data-ls-go] controls,
 *     textarea[data-ls-draft], [data-ls-submit]
 */

/* #cf-node-selected-payload-start
 * Pure payload builder for the viewer bridge
 * (spec design_harness_external_viewer_bridge). Kept outside the IIFE and
 * marker-wrapped so the server smoke test can extract and unit-test it; the
 * browser half calls it from notifyNodeSelected below.
 */
function buildNodeSelectedPayload(info) {
  var fileId = info && info.fileId ? String(info.fileId) : null;
  var payload = {
    fileId: fileId,
    pageId: info && info.pageId != null ? String(info.pageId) : null,
    nodeId: info && info.nodeId ? String(info.nodeId) : null,
    nodeType: info && info.nodeType ? String(info.nodeType) : 'frame',
    nodeLabel: info && info.nodeLabel != null ? String(info.nodeLabel) : null,
  };
  if (info && info.rect && typeof info.rect === 'object') {
    payload.rect = {
      x: Number(info.rect.x) || 0,
      y: Number(info.rect.y) || 0,
      width: Number(info.rect.width) || 0,
      height: Number(info.rect.height) || 0,
    };
  }
  return { source: 'canvas-design-harness', type: 'node:selected', payload: payload };
}
/* #cf-node-selected-payload-end */

(function () {
  var root = document.getElementById('canvas-frames-demo');
  if (!root) return;
  var pageTabs = Array.prototype.slice.call(root.querySelectorAll('.cf-pagetab'));
  var pages = Array.prototype.slice.call(root.querySelectorAll('.cf-page'));
  if (pageTabs.length === 0 || pages.length === 0) return;

  function clampScale(s) {
    return Math.min(4, Math.max(0.15, s));
  }
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function apply(st) {
    st.inner.style.transform =
      'translate(' + st.T.x + 'px,' + st.T.y + 'px) scale(' + st.T.s + ')';
    if (st.zoomValue) st.zoomValue.textContent = Math.round(st.T.s * 100) + '%';
  }
  function viewportSize(st) {
    var r = st.viewport.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  }
  function zoomAt(st, cx, cy, factor) {
    var s2 = clampScale(st.T.s * factor);
    var k = s2 / st.T.s;
    st.T.x = cx - (cx - st.T.x) * k;
    st.T.y = cy - (cy - st.T.y) * k;
    st.T.s = s2;
    apply(st);
  }
  function contentBox(st) {
    var v = viewportSize(st);
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    st.figs.forEach(function (fig) {
      var node = fig.querySelector('.cf-frame-wrap') || fig;
      var r = node.getBoundingClientRect();
      var x0 = (r.left - v.left - st.T.x) / st.T.s;
      var y0 = (r.top - v.top - st.T.y) / st.T.s;
      var x1 = x0 + r.width / st.T.s;
      var y1 = y0 + r.height / st.T.s;
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);
    });
    if (minX === Infinity) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  function fit(st) {
    var box = contentBox(st);
    if (!box) return;
    var v = viewportSize(st);
    st.T.s = clampScale(Math.min(1, (v.w - 48) / box.w, (v.h - 48) / box.h));
    st.T.x = v.w / 2 - (box.x + box.w / 2) * st.T.s;
    st.T.y = v.h / 2 - (box.y + box.h / 2) * st.T.s;
    apply(st);
  }
  function focusFrame(st, index) {
    var fig = st.figs[index];
    if (!fig) return;
    var node = fig.querySelector('.cf-frame-wrap') || fig;
    var v = viewportSize(st);
    var r = node.getBoundingClientRect();
    var cx = (r.left - v.left - st.T.x + r.width / 2) / st.T.s;
    var cy = (r.top - v.top - st.T.y + r.height / 2) / st.T.s;
    st.T.x = v.w / 2 - cx * st.T.s;
    st.T.y = v.h / 2 - cy * st.T.s;
    apply(st);
  }
  function selectFrame(st, index, focus) {
    st.figs.forEach(function (fig, i) {
      var frame = fig.querySelector('.cf-frame');
      if (frame) frame.classList.toggle('is-selected', i === index);
    });
    if (focus) focusFrame(st, index);
  }

  function buildPageState(page) {
    var viewport = page.querySelector('.cf-canvas-viewport');
    var inner = page.querySelector('.cf-canvas-inner');
    var zoomValue = page.querySelector('.cf-zoom-value');
    var figs = Array.prototype.slice.call(page.querySelectorAll('.cf-fig'));
    if (!viewport || !inner || figs.length === 0) return null;
    var st = {
      page: page,
      viewport: viewport,
      inner: inner,
      zoomValue: zoomValue,
      figs: figs,
      T: { x: 0, y: 0, s: 1 },
      pointers: new Map(),
      pinch: null,
      dragStart: null,
      moved: false,
      initialized: false,
    };

    viewport.addEventListener('pointerdown', function (e) {
      viewport.setPointerCapture(e.pointerId);
      st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      st.moved = false;
      if (st.pointers.size === 1) {
        st.dragStart = { x: e.clientX, y: e.clientY, tx: st.T.x, ty: st.T.y };
        st.pinch = null;
      } else if (st.pointers.size === 2) {
        var pts = Array.prototype.slice.call(st.pointers.values());
        st.pinch = {
          dist: dist(pts[0], pts[1]),
          mid: mid(pts[0], pts[1]),
          tx: st.T.x,
          ty: st.T.y,
          s: st.T.s,
        };
        st.dragStart = null;
      }
    });
    viewport.addEventListener('pointermove', function (e) {
      var p = st.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (st.pointers.size === 1 && st.dragStart) {
        var dx = e.clientX - st.dragStart.x;
        var dy = e.clientY - st.dragStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
        if (st.moved) {
          st.T.x = st.dragStart.tx + dx;
          st.T.y = st.dragStart.ty + dy;
          viewport.classList.add('is-panning');
          apply(st);
        }
      } else if (st.pointers.size === 2 && st.pinch) {
        var pts = Array.prototype.slice.call(st.pointers.values());
        var d = dist(pts[0], pts[1]);
        var m = mid(pts[0], pts[1]);
        // Pinch sensitivity: fourth root of the distance ratio slows the
        // zoom to quarter speed (a 2x finger spread becomes ~1.19x zoom).
        var s2 = clampScale(st.pinch.s * Math.pow(d / st.pinch.dist, 0.25));
        var k = s2 / st.pinch.s;
        st.T.x = m.x - (st.pinch.mid.x - st.pinch.tx) * k;
        st.T.y = m.y - (st.pinch.mid.y - st.pinch.ty) * k;
        st.T.s = s2;
        apply(st);
      }
    });
    function endPointer(e) {
      st.pointers.delete(e.pointerId);
      if (st.pointers.size < 2) st.pinch = null;
      if (st.pointers.size === 0) {
        st.dragStart = null;
        viewport.classList.remove('is-panning');
      }
    }
    viewport.addEventListener('pointerup', endPointer);
    viewport.addEventListener('pointercancel', endPointer);
    viewport.addEventListener('click', function (e) {
      if (st.moved) {
        e.preventDefault();
        e.stopPropagation();
        st.moved = false;
      }
    }, true);
    viewport.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        var r = viewport.getBoundingClientRect();
        zoomAt(st, e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.037 : 1 / 1.037);
      } else {
        st.T.x -= e.deltaX;
        st.T.y -= e.deltaY;
        apply(st);
      }
    }, { passive: false });

    // Viewer bridge (spec design_harness_external_viewer_bridge): broadcast a
    // node:selected message to the embedding parent when the user clicks a
    // frame. Pure enhancement — without a parent listener it is a no-op.
    function notifyNodeSelected(st, fig, frame, index) {
      var parent = window.parent;
      if (!parent || parent === window || typeof parent.postMessage !== 'function') return;
      var fileId = null;
      try {
        fileId = new URLSearchParams(window.location.search).get('file');
      } catch (error) { /* not embedded via /open */ }
      var pageEl = frame.closest ? frame.closest('.cf-page') : null;
      var nameEl = fig.querySelectorAll('.cf-fig-label span')[1];
      var labelEl = fig.querySelector('.cf-fig-label b');
      var r = frame.getBoundingClientRect();
      var v = viewportSize(st);
      parent.postMessage(
        buildNodeSelectedPayload({
          fileId: fileId,
          pageId: pageEl ? pageEl.getAttribute('data-page') : null,
          nodeId: frame.getAttribute('data-cf-id') || 'frame-' + index,
          nodeType: frame.getAttribute('data-cf-type') || 'frame',
          nodeLabel: nameEl ? nameEl.textContent : labelEl ? labelEl.textContent : null,
          rect: {
            x: (r.left - v.left - st.T.x) / st.T.s,
            y: (r.top - v.top - st.T.y) / st.T.s,
            width: r.width / st.T.s,
            height: r.height / st.T.s,
          },
        }),
        '*',
      );
    }

    st.figs.forEach(function (fig, i) {
      var frame = fig.querySelector('.cf-frame');
      if (frame) {
        frame.addEventListener('click', function () {
          selectFrame(st, i, true);
          notifyNodeSelected(st, fig, frame, i);
        });
      }
    });
    var zoomButtons = page.querySelectorAll('.cf-zoombar [data-zoom]');
    Array.prototype.forEach.call(zoomButtons, function (btn) {
      btn.addEventListener('click', function () {
        var v = viewportSize(st);
        var mode = btn.getAttribute('data-zoom');
        if (mode === 'in') zoomAt(st, v.w / 2, v.h / 2, 1.25);
        else if (mode === 'out') zoomAt(st, v.w / 2, v.h / 2, 0.8);
        else if (mode === 'fit') fit(st);
      });
    });
    if (zoomValue) {
      zoomValue.addEventListener('click', function () {
        var v = viewportSize(st);
        zoomAt(st, v.w / 2, v.h / 2, 1 / st.T.s);
      });
    }
    return st;
  }

  function wireLaunchSheets(page) {
    Array.prototype.forEach.call(page.querySelectorAll('.cf-ls'), function (ls) {
      var panels = Array.prototype.slice.call(ls.querySelectorAll('[data-ls-state]'));
      var timers = {};
      function go(name) {
        panels.forEach(function (p) {
          var on = p.getAttribute('data-ls-state') === name;
          p.classList.toggle('is-active', on);
          if (on) {
            var timeout = p.getAttribute('data-ls-timeout');
            if (timeout) {
              var key = p.getAttribute('data-ls-state');
              clearTimeout(timers[key]);
              timers[key] = setTimeout(function () {
                var after = p.getAttribute('data-ls-after');
                if (after) go(after);
              }, parseInt(timeout, 10) || 1200);
            }
          }
        });
      }
      Array.prototype.forEach.call(ls.querySelectorAll('[data-ls-go]:not([data-ls-submit])'), function (ctrl) {
        ctrl.addEventListener('click', function (e) {
          e.stopPropagation();
          go(ctrl.getAttribute('data-ls-go'));
        });
      });
      // data-ls-toggle collapses/expands a section inside the same state
      // (e.g. the card intro); the button mirrors the section state.
      function toggleScope(ctrl) {
        return ctrl.closest('[data-ls-state]') || ls;
      }
      Array.prototype.forEach.call(ls.querySelectorAll('[data-ls-toggle]'), function (ctrl) {
        var target = toggleScope(ctrl).querySelector(ctrl.getAttribute('data-ls-toggle'));
        if (target) {
          ctrl.classList.toggle('is-active', !target.classList.contains('is-collapsed'));
        }
        ctrl.addEventListener('click', function (e) {
          e.stopPropagation();
          var t = toggleScope(ctrl).querySelector(ctrl.getAttribute('data-ls-toggle'));
          if (!t) return;
          var collapsed = t.classList.toggle('is-collapsed');
          ctrl.classList.toggle('is-active', !collapsed);
        });
      });
      // data-ls-expand swaps a source row for an inline input panel in place
      // (open/close on the same button; the source list stays visible).
      Array.prototype.forEach.call(ls.querySelectorAll('[data-ls-expand]'), function (ctrl) {
        ctrl.addEventListener('click', function (e) {
          e.stopPropagation();
          var host = ctrl.closest('.cf-ls-expand');
          if (!host) return;
          if (ctrl.getAttribute('data-ls-expand') === 'open') {
            host.classList.add('is-open');
          } else {
            host.classList.remove('is-open');
          }
        });
      });
      Array.prototype.forEach.call(ls.querySelectorAll('textarea[data-ls-draft]'), function (ta) {
        var submit = ls.querySelector('[data-ls-submit]');
        function update() {
          if (submit) submit.classList.toggle('is-disabled', ta.value.trim() === '');
        }
        ta.addEventListener('input', update);
        if (submit) {
          submit.addEventListener('click', function (e) {
            if (submit.classList.contains('is-disabled')) {
              e.preventDefault();
              return;
            }
            var next = submit.getAttribute('data-ls-go');
            if (next) go(next);
          });
        }
        update();
      });
    });
  }

  var states = pages.map(buildPageState);
  if (!states.some(Boolean)) return;
  var current = -1;

  function activatePage(index) {
    current = index;
    pageTabs.forEach(function (tab, i) {
      tab.classList.toggle('is-active', i === index);
      tab.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    pages.forEach(function (page, i) {
      page.classList.toggle('is-active', i === index);
    });
    var st = states[index];
    if (!st) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!st.initialized) {
          fit(st);
          selectFrame(st, 0, false);
          st.initialized = true;
        }
      });
    });
    try {
      history.replaceState(null, '', '#page-' + (index + 1));
    } catch (e) {
      // Sandboxed iframes may disallow history updates; page switching still works.
    }
  }

  pageTabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { activatePage(i); });
  });
  pages.forEach(function (page) {
    wireLaunchSheets(page);
  });
  var initial = parseInt((location.hash.match(/#page-(\d+)/) || [])[1] || '1', 10) - 1;
  if (isNaN(initial) || initial < 0 || initial >= pages.length) initial = 0;
  activatePage(initial);
  window.addEventListener('hashchange', function () {
    var m = (location.hash || '').match(/#page-(\d+)/);
    var idx = m ? parseInt(m[1], 10) - 1 : 0;
    if (idx >= 0 && idx < pages.length && idx !== current) {
      activatePage(idx);
    }
  });
})();
