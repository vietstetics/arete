/* ============================================================================
 *  Dev tools: a Dev button (top right) that opens the computer's test-videos
 *  folders, so clips filmed on the phone go straight onto the computer, where
 *  the heavy pose analysis runs. Only loaded when the app comes from the dev
 *  server on the home Wi-Fi (scripts/dev-server.mjs); the live site never
 *  shows it. Self-contained: injects its own CSS.
 * ==========================================================================*/
(function () {
  if (window.__devtools) return; window.__devtools = true;
  var KEY_STORE = 'arete.devkey';
  function key() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (_) { return ''; } }

  function api(path, opts) {
    opts = opts || {};
    var h = opts.headers || {}; h['X-Dev-Key'] = key();
    if (opts.json) { h['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
    return fetch('/__dev/' + path, { method: opts.method || 'GET', headers: h, body: opts.body, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Failed'); return d; }); });
  }

  fetch('/__dev/ping', { headers: { 'X-Dev-Key': key() }, cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.dev) return;
      if (document.body) mount(d.paired); else document.addEventListener('DOMContentLoaded', function () { mount(d.paired); });
    })
    .catch(function () {});

  var css = '' +
    '.dv-btn{position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);right:8px;z-index:2147483000;height:30px;padding:0 11px;border-radius:15px;border:0;background:rgba(28,28,30,.82);color:#fff;font:600 12px/30px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.02em;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 2px 8px rgba(0,0,0,.18);cursor:pointer;display:flex;align-items:center;gap:6px}' +
    '.dv-btn svg{width:14px;height:14px}' +
    '.dv-btn i{width:7px;height:7px;border-radius:50%;background:#34C759;display:none}.dv-btn.busy i{display:block;animation:dvp 1.2s ease-in-out infinite}' +
    '@keyframes dvp{50%{opacity:.3}}' +
    '.dv-wrap{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.35);display:none}.dv-wrap.on{display:block}' +
    '.dv-sheet{position:absolute;top:0;right:0;bottom:0;width:min(440px,100%);background:#F2F2F7;color:#1C1C1E;display:flex;flex-direction:column;font:15px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:-8px 0 30px rgba(0,0,0,.15)}' +
    '.dv-head{display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px 10px;border-bottom:1px solid rgba(60,60,67,.12);background:#fff}' +
    '.dv-head b{font-size:17px;flex:1}.dv-x{border:0;background:#E5E5EA;width:30px;height:30px;border-radius:50%;font-size:18px;line-height:30px;color:#3A3A3C;cursor:pointer}' +
    '.dv-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 16px calc(env(safe-area-inset-bottom,0px) + 24px)}' +
    '.dv-msg{background:#fff;border-radius:12px;padding:14px;margin-bottom:12px;color:#3A3A3C}' +
    '.dv-msg.err{color:#C4271D}' +
    '.dv-crumb{display:flex;align-items:center;gap:6px;margin:0 0 10px;font-size:13px;color:#6E6E73}.dv-crumb button{border:0;background:none;color:#248A3D;font:inherit;font-weight:600;padding:0;cursor:pointer}' +
    '.dv-list{background:#fff;border-radius:12px;overflow:hidden;margin-bottom:14px}' +
    '.dv-row{display:flex;align-items:center;gap:10px;padding:12px 14px;border-top:1px solid rgba(60,60,67,.1);cursor:pointer;min-height:48px;box-sizing:border-box}.dv-row:first-child{border-top:0}' +
    '.dv-row:active{background:#F2F2F7}' +
    '.dv-row .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dv-row .c{color:#8E8E93;font-size:13px}' +
    '.dv-row svg{width:18px;height:18px;flex:none;color:#8E8E93}' +
    '.dv-clip{padding:12px 14px;border-top:1px solid rgba(60,60,67,.1)}.dv-clip:first-child{border-top:0}' +
    '.dv-clip .t{display:flex;gap:8px;align-items:baseline}.dv-clip .t .n{flex:1;min-width:0;word-break:break-all;font-weight:600;font-size:14px}.dv-clip .t .s{color:#8E8E93;font-size:12px;white-space:nowrap}' +
    '.dv-clip .st{font-size:13px;color:#6E6E73;margin-top:3px}.dv-clip .st.ok{color:#248A3D}.dv-clip .st.bad{color:#C4271D}' +
    '.dv-clip .note{font-size:13px;color:#3A3A3C;margin-top:4px;white-space:pre-wrap}' +
    '.dv-clip .acts{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}' +
    '.dv-b{border:0;border-radius:9px;padding:8px 12px;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#E5E5EA;color:#1C1C1E;cursor:pointer}' +
    '.dv-b.p{background:#248A3D;color:#fff}.dv-b:disabled{opacity:.45}' +
    '.dv-add{display:flex;flex-direction:column;gap:8px;background:#fff;border-radius:12px;padding:14px;margin-bottom:14px}' +
    '.dv-add label{font-size:13px;color:#6E6E73;display:flex;align-items:center;gap:8px}' +
    '.dv-add textarea{width:100%;box-sizing:border-box;border:1px solid rgba(60,60,67,.18);border-radius:9px;padding:8px 10px;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;resize:vertical;min-height:54px;background:#fff;color:#1C1C1E}' +
    '.dv-add .big{padding:12px;font-size:15px}' +
    '.dv-bar{height:6px;border-radius:3px;background:#E5E5EA;overflow:hidden}.dv-bar i{display:block;height:100%;width:0;background:#34C759;transition:width .2s}' +
    '.dv-guide{background:#fff;border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:13px;color:#3A3A3C;white-space:pre-wrap}' +
    '.dv-guide summary{font-weight:600;cursor:pointer;color:#1C1C1E}' +
    '.dv-sec{font-size:13px;color:#6E6E73;margin:4px 4px 6px}' +
    '.dv-img{width:100%;border-radius:8px;margin-top:8px;display:block}';

  var ICON = {
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    tool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/></svg>'
  };

  var state = { folders: [], jobs: [], open: null, paired: false, uploading: false, sheet: {} };
  var btn, wrap, body, timer;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mb(n) { return n >= 1024 * 1024 * 1024 ? (n / 1024 / 1024 / 1024).toFixed(1) + ' GB' : (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + ' MB'; }

  function mount(paired) {
    state.paired = paired;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    btn = document.createElement('button'); btn.className = 'dv-btn'; btn.type = 'button';
    btn.setAttribute('aria-label', 'Dev tools: test videos on the computer');
    btn.innerHTML = ICON.tool + 'Dev<i></i>';
    btn.onclick = openSheet;
    wrap = document.createElement('div'); wrap.className = 'dv-wrap';
    wrap.innerHTML = '<div class="dv-sheet" role="dialog" aria-label="Test videos"><div class="dv-head"><b>Test videos</b><button class="dv-x" type="button" aria-label="Close">×</button></div><div class="dv-body"></div></div>';
    wrap.onclick = function (e) { if (e.target === wrap) closeSheet(); };
    wrap.querySelector('.dv-x').onclick = closeSheet;
    body = wrap.querySelector('.dv-body');
    document.body.appendChild(btn); document.body.appendChild(wrap);
    if (paired) poll();
  }

  function openSheet() { wrap.classList.add('on'); refresh(); }
  function closeSheet() { wrap.classList.remove('on'); }

  function refresh() {
    if (!state.paired) { render(); return Promise.resolve(); }
    return api('files').then(function (d) { state.folders = d.folders; state.jobs = d.jobs; state.err = ''; render(); })
      .catch(function (e) { state.err = e.message; render(); });
  }
  // While anything is analysing, keep the list and the button's dot up to date.
  function poll() {
    clearTimeout(timer);
    api('files').then(function (d) {
      state.folders = d.folders; state.jobs = d.jobs;
      var busy = d.jobs.some(function (j) { return j.state === 'queued' || j.state === 'running'; });
      btn.classList.toggle('busy', busy || state.uploading);
      if (wrap.classList.contains('on') && !state.uploading) render();
      if (busy) timer = setTimeout(poll, 2500);
    }).catch(function () {});
  }

  function jobFor(folder, clip) {
    for (var i = state.jobs.length - 1; i >= 0; i--) { var j = state.jobs[i]; if (j.folder === folder && j.clip === clip) return j; }
    return null;
  }

  function render() {
    if (!state.paired) {
      body.innerHTML = '<div class="dv-msg">This phone isn’t paired yet. On the computer, run <b>npm run dev</b> and open the link it prints (it ends in <b>?devkey=…</b>) on this phone.</div>';
      return;
    }
    var html = state.err ? '<div class="dv-msg err">' + esc(state.err) + '</div>' : '';
    var f = state.open && state.folders.filter(function (x) { return x.name === state.open; })[0];
    if (!f) {
      state.open = null;
      html += '<div class="dv-sec">Folders on the computer · tap one to add videos</div><div class="dv-list">';
      state.folders.forEach(function (x, i) {
        var todo = x.clips.filter(function (c) { return !c.analysed; }).length;
        html += '<div class="dv-row" data-open="' + i + '">' + ICON.folder + '<span class="n">' + esc(x.name) + '</span><span class="c">' + x.clips.length + (x.clips.length === 1 ? ' clip' : ' clips') + (todo ? ' · ' + todo + ' to analyse' : '') + '</span>' + ICON.chev + '</div>';
      });
      html += '</div><button class="dv-b" type="button" data-new>New folder</button>';
      body.innerHTML = html;
      body.querySelectorAll('[data-open]').forEach(function (el) { el.onclick = function () { state.open = state.folders[+el.dataset.open].name; render(); body.scrollTop = 0; }; });
      body.querySelector('[data-new]').onclick = newFolder;
      return;
    }
    html += '<div class="dv-crumb"><button type="button" data-back>Folders</button><span>›</span><span>' + esc(f.name) + '</span></div>';
    html += '<div class="dv-add"><button class="dv-b p big" type="button" data-pick' + (state.uploading ? ' disabled' : '') + '>Add videos to “' + esc(f.name) + '”</button>' +
      '<input type="file" accept="video/*" multiple hidden>' +
      '<textarea placeholder="Note for these clips (optional): exercise, angle, weight, reps, velocity device numbers"></textarea>' +
      '<label><input type="checkbox" checked data-auto> Analyse on the computer after upload</label>' +
      '<div class="dv-prog" hidden><div class="dv-bar"><i></i></div><div class="st" style="font-size:13px;color:#6E6E73;margin-top:6px"></div></div></div>';
    if (f.guide) html += '<details class="dv-guide"><summary>What to record</summary>' + esc(f.guide.replace(/^.*\n\n?/, '')) + '</details>';
    html += '<div class="dv-sec">' + (f.clips.length ? f.clips.length + (f.clips.length === 1 ? ' clip' : ' clips') : 'No clips yet') + '</div>';
    if (f.clips.length) {
      html += '<div class="dv-list">';
      f.clips.forEach(function (c, i) {
        var j = jobFor(f.name, c.name), st, cls = '';
        if (j && j.state === 'running') st = 'Analysing… ' + esc(j.last);
        else if (j && j.state === 'queued') st = 'Waiting to analyse';
        else if (j && j.state === 'failed') { st = 'Analysis failed: ' + esc(j.last); cls = 'bad'; }
        else if (c.analysed) { st = 'Analysed · landmarks saved'; cls = 'ok'; }
        else st = 'Not analysed yet';
        var busy = j && (j.state === 'running' || j.state === 'queued');
        html += '<div class="dv-clip"><div class="t"><span class="n">' + esc(c.name) + '</span><span class="s">' + mb(c.size) + '</span></div>' +
          '<div class="st ' + cls + '">' + st + '</div>' + (c.note ? '<div class="note">' + esc(c.note) + '</div>' : '') +
          '<div class="acts"><button class="dv-b" type="button" data-an="' + i + '"' + (busy ? ' disabled' : '') + '>' + (c.analysed ? 'Analyse again' : 'Analyse') + '</button>' +
          (c.sheet ? '<button class="dv-b" type="button" data-sh="' + i + '">' + (state.sheet[f.name + '/' + c.name] ? 'Hide frames' : 'Check frames') + '</button>' : '') +
          '<button class="dv-b" type="button" data-nt="' + i + '">' + (c.note ? 'Edit note' : 'Add note') + '</button></div>' +
          (c.sheet && state.sheet[f.name + '/' + c.name] ? '<img class="dv-img" alt="Frames from ' + esc(c.name) + ' with the tracked skeleton drawn on" src="/__dev/sheet?folder=' + encodeURIComponent(f.name) + '&clip=' + encodeURIComponent(c.name) + '&key=' + encodeURIComponent(key()) + '&v=' + c.added + '">' : '') +
          '</div>';
      });
      html += '</div>';
    }
    body.innerHTML = html;
    body.querySelector('[data-back]').onclick = function () { state.open = null; render(); };
    var input = body.querySelector('input[type=file]');
    body.querySelector('[data-pick]').onclick = function () { input.click(); };
    input.onchange = function () { if (input.files.length) upload(f.name, Array.prototype.slice.call(input.files)); };
    body.querySelectorAll('[data-an]').forEach(function (el) { el.onclick = function () { analyse(f.name, f.clips[+el.dataset.an].name); }; });
    body.querySelectorAll('[data-sh]').forEach(function (el) { el.onclick = function () { var k = f.name + '/' + f.clips[+el.dataset.sh].name; state.sheet[k] = !state.sheet[k]; render(); }; });
    body.querySelectorAll('[data-nt]').forEach(function (el) { el.onclick = function () { editNote(f.name, f.clips[+el.dataset.nt]); }; });
  }

  function newFolder() {
    var name = (prompt('New folder name (e.g. lat pulldown)') || '').trim();
    if (!name) return;
    api('folder', { method: 'POST', json: { name: name } }).then(function () { state.open = name; return refresh(); }).catch(function (e) { alert(e.message); });
  }
  function analyse(folder, clip) {
    api('analyse', { method: 'POST', json: { folder: folder, clip: clip } }).then(function () { poll(); refresh(); }).catch(function (e) { alert(e.message); });
  }
  function editNote(folder, c) {
    var t = prompt('Note for ' + c.name, c.note || '');
    if (t == null) return;
    api('note', { method: 'POST', json: { folder: folder, clip: c.name, text: t } }).then(refresh).catch(function (e) { alert(e.message); });
  }

  // One file at a time, straight to disk on the computer (XHR for upload progress).
  function upload(folder, files) {
    var prog = body.querySelector('.dv-prog'), bar = prog.querySelector('i'), txt = prog.querySelector('.st');
    var note = body.querySelector('.dv-add textarea').value.trim();
    var auto = body.querySelector('[data-auto]').checked;
    var total = files.reduce(function (s, f) { return s + f.size; }, 0), doneBytes = 0, i = 0, failed = [];
    state.uploading = true; btn.classList.add('busy'); prog.hidden = false;
    body.querySelector('[data-pick]').disabled = true;
    function next() {
      if (i >= files.length) {
        state.uploading = false;
        txt.textContent = failed.length ? 'Done, but ' + failed.length + ' failed: ' + failed.join('; ') : 'Uploaded ' + files.length + (files.length === 1 ? ' video' : ' videos') + (auto ? ' · analysing on the computer' : '');
        refresh().then(poll);
        return;
      }
      var file = files[i];
      var name = file.name || ('clip-' + (i + 1) + '.mov');
      if (!/\.(mp4|mov|m4v|webm)$/i.test(name)) name += /quicktime/.test(file.type) ? '.mov' : '.mp4';
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/__dev/upload?folder=' + encodeURIComponent(folder) + '&name=' + encodeURIComponent(name) + '&analyse=' + (auto ? '1' : '0') + (note ? '&note=' + encodeURIComponent(note) : ''));
      xhr.setRequestHeader('X-Dev-Key', key());
      xhr.upload.onprogress = function (e) {
        var pct = total ? (100 * (doneBytes + e.loaded)) / total : 0;
        bar.style.width = pct.toFixed(1) + '%';
        txt.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + ' · ' + mb(doneBytes + e.loaded) + ' of ' + mb(total);
      };
      xhr.onload = function () {
        if (xhr.status !== 200) { var m = 'Failed'; try { m = JSON.parse(xhr.responseText).error; } catch (_) {} failed.push(name + ': ' + m); }
        doneBytes += file.size; i++; next();
      };
      xhr.onerror = function () { failed.push(name + ': connection lost'); doneBytes += file.size; i++; next(); };
      xhr.send(file);
    }
    next();
  }
})();
