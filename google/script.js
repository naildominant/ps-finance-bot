// PS Финансы — скрипт внутри таблицы (Расширения → Apps Script).
// Бот (сервер psfinance) шлёт сюда запросы: записать строку, изменить ячейки, прочитать данные.
// Каждую ночь делает копию таблицы на Google Диск (папка «PS Финансы — копии»).
var SHEET_ID = '1OXZEt2YRwHJmy8QZtCH3rZMNgaVyW5d5u7tsKONrmgU';
var KEY = 'PUT_KEY_HERE';               // секрет, совпадает с секретом на сервере
var BACKUP_FOLDER = 'PS Финансы — копии';
var KEEP_BACKUPS = 60;                  // сколько последних копий хранить

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.key !== KEY) return json({ ok: false, error: 'forbidden' });
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var res = [];
    (req.ops || []).forEach(function (op) { res.push(run(ss, op)); });
    SpreadsheetApp.flush();
    out = { ok: true, res: res };
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return json(out);
}

function run(ss, op) {
  var sh = op.sheet ? ss.getSheetByName(op.sheet) : null;
  switch (op.op) {
    case 'append':                       // {sheet, row:[...]}
      sh.appendRow(op.row.map(fix));
      return { row: sh.getLastRow() };
    case 'set':                          // {sheet, range:'A2:C2', values:[[...]]}
      sh.getRange(op.range).setValues(op.values.map(function (r) { return r.map(fix); }));
      return {};
    case 'get':                          // {sheet, range}
      return { values: sh.getRange(op.range).getValues().map(function (r) { return r.map(unfix); }) };
    case 'find':                         // {sheet, col:'A', value} -> row number or 0
      var col = sh.getRange(op.col + '1:' + op.col + sh.getLastRow()).getValues();
      for (var i = col.length - 1; i >= 0; i--) if (String(col[i][0]) === String(op.value)) return { row: i + 1 };
      return { row: 0 };
    default:
      throw new Error('unknown op ' + op.op);
  }
}

// {d: <ms>} -> дата; остальное как есть
function fix(v) { return (v && typeof v === 'object' && 'd' in v) ? new Date(v.d) : v; }
function unfix(v) { return (v instanceof Date) ? { d: v.getTime() } : v; }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Ежедневная копия таблицы
function backup() {
  var file = DriveApp.getFileById(SpreadsheetApp.openById(SHEET_ID).getId());
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
  var name = 'PS Финансы ' + Utilities.formatDate(new Date(), 'Asia/Tashkent', 'yyyy-MM-dd');
  file.makeCopy(name, folder);
  var files = [], f = folder.getFiles();
  while (f.hasNext()) files.push(f.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(KEEP_BACKUPS).forEach(function (x) { x.setTrashed(true); });
}

// Запустить один раз: включает ежедневную копию в 3:00 по Ташкенту и делает первую копию
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backup').timeBased().everyDays(1).atHour(3).inTimezone('Asia/Tashkent').create();
  backup();
}
