/** @OnlyCurrentDoc */
// (That line means the script can only open THIS spreadsheet, nothing else in your Drive.)

/**
 * MY/CO/L farm records: the script that links this Google Sheet to the app.
 *
 * Set up (once):
 *   1. In this sheet: Extensions > Apps Script. Delete what is there, paste this whole file, press Save.
 *   2. Deploy > New deployment > type Web app. Execute as: Me. Who has access: Anyone. Press Deploy.
 *   3. Google asks you to allow it. Press Allow (Advanced > Go to project if it warns you; it is your own script).
 *   4. Copy the Web app URL into the app: DATA > GOOGLE SHEET > SHEET ADDRESS, then press TEST LINK.
 * The key below was made by the app. Anyone who has both the address and the key can change farm records:
 * keep them private. To change the key, make a new script in the app and paste it again (Deploy > Manage
 * deployments > Edit > Version: New version, so the address stays the same).
 */
var MYCOL_KEY = '__MYCOL_KEY__';
var MYCOL_VERSION = 1;
var README = 'READ ME';
var ID = 'id';
var EDITED = '_edited_at';
var ACTION = '_action';
var HEAD_BG = '#10261a';
var HEAD_FG = '#9cff9c';
var RO_BG = '#e3e6e3';

function doGet() {
  return ContentService.createTextOutput('MY/CO/L sheet link is running. Paste this address into the app: DATA > GOOGLE SHEET.');
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!MYCOL_KEY || MYCOL_KEY.indexOf('__') === 0) throw new Error('THIS SCRIPT HAS NO KEY. MAKE THE SCRIPT IN THE APP AND PASTE IT AGAIN.');
    if (req.key !== MYCOL_KEY) throw new Error('WRONG KEY. THE APP AND THE SCRIPT DO NOT MATCH.');
    var lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      out = mycolHandle(req);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function mycolHandle(req) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (req.op === 'hello') return { version: MYCOL_VERSION, sheet: ss.getName(), url: ss.getUrl() };
  if (req.op === 'pull') return mycolPull(ss, req);
  if (req.op === 'push') return mycolPush(ss, req);
  throw new Error('UNKNOWN REQUEST ' + req.op);
}

/** Header names of a tab and where each one is. */
function mycolHeader(sh) {
  var lc = sh.getLastColumn();
  var names = lc ? sh.getRange(1, 1, 1, lc).getValues()[0].map(function (v) { return String(v || '').trim(); }) : [];
  var idx = {};
  for (var i = 0; i < names.length; i++) if (names[i] && !(names[i] in idx)) idx[names[i]] = i;
  return { names: names, idx: idx };
}

/** A cell as the app reads it: dates turned back into text. */
function mycolOut(v, tz) {
  if (v instanceof Date) {
    var day = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    var hms = Utilities.formatDate(v, tz, 'HH:mm:ss');
    return hms === '00:00:00' ? day : v.toISOString();
  }
  if (v === null || v === undefined) return '';
  return v;
}

/** A value as the sheet should hold it. A text that a spreadsheet would run as a formula gets a leading apostrophe. */
function mycolIn(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v === null || v === undefined ? '' : v;
}

function mycolBlank(row, skip) {
  for (var j = 0; j < row.length; j++) {
    if (skip[j]) continue;
    if (row[j] !== '' && row[j] !== null && row[j] !== false) return false;
  }
  return true;
}

/** Rows people edited since `since` (every row on a full check), and every id on a full check. */
function mycolPull(ss, req) {
  var now = new Date().toISOString();
  var tz = ss.getSpreadsheetTimeZone();
  var tabs = {};
  (req.tabs || []).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var h = mycolHeader(sh);
    var idC = h.idx[ID];
    var edC = h.idx[EDITED];
    if (idC === undefined) return;
    var lr = sh.getLastRow();
    var rows = [];
    var ids = [];
    if (lr >= 2) {
      var vals = sh.getRange(2, 1, lr - 1, h.names.length).getValues();
      var skip = {};
      skip[idC] = true;
      if (edC !== undefined) skip[edC] = true;
      for (var i = 0; i < vals.length; i++) {
        var row = vals[i];
        if (mycolBlank(row, skip)) continue;
        var id = String(row[idC] || '').trim();
        var ed = edC === undefined ? '' : String(mycolOut(row[edC], tz) || '');
        if (!id) {
          // Typed in by hand and the edit stamp did not run (pasted by another tool): give it an id now.
          id = Utilities.getUuid();
          ed = now;
          sh.getRange(i + 2, idC + 1).setValue(id);
          if (edC !== undefined) sh.getRange(i + 2, edC + 1).setValue(now);
        }
        if (req.full) ids.push(id);
        if (req.since && !(ed > req.since)) continue;
        var cells = {};
        for (var j = 0; j < h.names.length; j++) if (h.names[j]) cells[h.names[j]] = mycolOut(row[j], tz);
        rows.push({ id: id, edited_at: ed, cells: cells });
      }
    }
    tabs[name] = req.full ? { rows: rows, ids: ids } : { rows: rows };
  });
  return { now: now, tabs: tabs };
}

/** Make sure every column the app sends is in row 1 (new ones go on the right) and style new columns. */
function mycolColumns(sh, cols, fresh) {
  var h = mycolHeader(sh);
  var added = [];
  cols.forEach(function (c) {
    if (h.idx[c.name] !== undefined) return;
    h.idx[c.name] = h.names.length;
    h.names.push(c.name);
    added.push(c);
  });
  if (!added.length) return h;
  var first = h.names.length - added.length + 1;
  var n = added.length;
  var max = sh.getMaxRows();
  var rows = Math.max(1, max - 1);
  sh.getRange(1, first, 1, n).setValues([added.map(function (c) { return c.name; })]);
  sh.getRange(1, first, 1, n).setNotes([added.map(function (c) { return c.note || ''; })]);
  // Number formats in one call: numbers grouped, tick boxes left alone, everything else plain text (no date guessing).
  var fmt = added.map(function (c) { return c.kind === 'number' ? '#,##0.###' : c.kind === 'bool' ? 'General' : '@'; });
  var grid = [];
  for (var r = 0; r < rows; r++) grid.push(fmt);
  sh.getRange(2, first, rows, n).setNumberFormats(grid);
  // Read-only columns: grey, with a warning if someone edits them. Side-by-side ones share one range.
  var i = 0;
  while (i < n) {
    if (!added[i].ro) { i++; continue; }
    var j = i;
    while (j + 1 < n && added[j + 1].ro) j++;
    var ro = sh.getRange(2, first + i, rows, j - i + 1);
    ro.setBackground(RO_BG);
    ro.protect().setWarningOnly(true).setDescription('Set by the MY/CO/L app. A change here is put back.');
    i = j + 1;
  }
  added.forEach(function (c, k) {
    if (c.ro) return;
    var body = sh.getRange(2, first + k, rows, 1);
    if (c.kind === 'bool') body.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    else if (c.choices && c.choices.length) {
      body.setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(c.choices, true).setAllowInvalid(true).setHelpText('One of: ' + c.choices.join(', ')).build(),
      );
    }
  });
  var all = sh.getRange(1, 1, 1, h.names.length);
  all.setFontWeight('bold').setBackground(HEAD_BG).setFontColor(HEAD_FG);
  sh.setFrozenRows(1);
  return h;
}

function mycolPush(ss, req) {
  var names = Object.keys(req.tabs || {}).sort(function (a, b) { return req.tabs[a].order - req.tabs[b].order; });
  var written = 0;
  var created = false;
  names.forEach(function (name) {
    var t = req.tabs[name];
    var sh = ss.getSheetByName(name);
    var fresh = !sh;
    if (fresh) {
      sh = ss.insertSheet(name);
      created = true;
      if (t.color) sh.setTabColor(t.color);
      if (t.columns.every(function (c) { return c.ro; })) sh.protect().setWarningOnly(true).setDescription('Read only: filled by the MY/CO/L app.');
    }
    var h = mycolColumns(sh, t.columns, fresh);
    var kinds = {};
    t.columns.forEach(function (c) { kinds[c.name] = c.kind; });
    if (!t.upserts.length && !t.deletes.length) return;
    var width = h.names.length;
    var lr = sh.getLastRow();
    var vals = lr >= 2 ? sh.getRange(2, 1, lr - 1, width).getValues() : [];
    var idC = h.idx[ID];
    var at = {};
    for (var i = 0; i < vals.length; i++) {
      var id = String(vals[i][idC] || '').trim();
      if (id && !(id in at)) at[id] = i;
    }
    var touched = {};
    var appended = 0;
    t.upserts.forEach(function (u) {
      var i = at[u.id];
      var cells = u.cells;
      if (i === undefined) {
        i = vals.length;
        var blank = [];
        for (var j = 0; j < width; j++) blank.push('');
        vals.push(blank);
        at[u.id] = i;
        cells = u.fill || u.cells;
        cells[ID] = u.id;
        appended++;
      }
      Object.keys(cells).forEach(function (k) {
        var c = h.idx[k];
        if (c === undefined) return;
        vals[i][c] = mycolIn(cells[k]);
        touched[c] = true;
      });
      written++;
    });
    if (appended) {
      var need = vals.length + 1 - sh.getMaxRows();
      if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
    }
    Object.keys(touched).forEach(function (c) {
      c = Number(c);
      var col = [];
      for (var i = 0; i < vals.length; i++) col.push([vals[i][c]]);
      var rng = sh.getRange(2, c + 1, vals.length, 1);
      var kind = kinds[h.names[c]];
      if (kind && kind !== 'number' && kind !== 'bool') rng.setNumberFormat('@');
      rng.setValues(col);
    });
    // Rows of records deleted in the app: bottom up, so the row numbers above stay right.
    var gone = t.deletes.map(function (id) { return at[id]; }).filter(function (i) { return i !== undefined; }).sort(function (a, b) { return b - a; });
    var k = 0;
    while (k < gone.length) {
      var end = gone[k];
      var start = end;
      while (k + 1 < gone.length && gone[k + 1] === start - 1) {
        k++;
        start = gone[k];
      }
      sh.deleteRows(start + 2, end - start + 1);
      k++;
    }
  });
  mycolReadme(ss, req.readme || [], created ? names : null);
  return { now: new Date().toISOString(), written: written };
}

function mycolReadme(ss, rows, order) {
  var sh = ss.getSheetByName(README);
  if (!sh) {
    sh = ss.insertSheet(README, 0);
    sh.setTabColor('#9cff9c');
  }
  sh.clearContents();
  if (rows.length) {
    var w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
    var padded = rows.map(function (r) { var o = r.slice(); while (o.length < w) o.push(''); return o.map(mycolIn); });
    sh.getRange(1, 1, padded.length, w).setValues(padded);
    sh.getRange(1, 1).setFontWeight('bold').setFontSize(16);
  }
  if (order) {
    // New tabs were made: put every tab in the app's order behind the READ ME.
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(1);
    order.forEach(function (name, i) {
      var t = ss.getSheetByName(name);
      if (!t) return;
      ss.setActiveSheet(t);
      ss.moveActiveSheet(i + 2);
    });
    ss.setActiveSheet(sh);
  }
}

/** Runs by itself when a person edits a cell: stamps the edit time, and gives a new row its id. */
function onEdit(e) {
  var r = e && e.range;
  if (!r) return;
  var sh = r.getSheet();
  if (sh.getName() === README) return;
  var top = Math.max(2, r.getRow());
  var bottom = r.getLastRow();
  if (bottom < top) return;
  var h = mycolHeader(sh);
  var idC = h.idx[ID];
  var edC = h.idx[EDITED];
  if (idC === undefined || edC === undefined) return;
  var n = bottom - top + 1;
  var vals = sh.getRange(top, 1, n, h.names.length).getValues();
  var skip = {};
  skip[idC] = true;
  skip[edC] = true;
  var now = new Date().toISOString();
  var ids = [];
  var stamps = [];
  for (var i = 0; i < n; i++) {
    var blank = mycolBlank(vals[i], skip);
    var id = String(vals[i][idC] || '').trim();
    ids.push([id || (blank ? '' : Utilities.getUuid())]);
    stamps.push([blank && !id ? '' : now]);
  }
  sh.getRange(top, idC + 1, n, 1).setNumberFormat('@').setValues(ids);
  sh.getRange(top, edC + 1, n, 1).setNumberFormat('@').setValues(stamps);
}
