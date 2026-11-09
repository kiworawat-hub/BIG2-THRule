// Google Apps Script -- paste into the Sheet's Extensions > Apps Script.
// Receives one POST per finished match and appends one row per player.
// Set SECRET to the same value as SHEET_SECRET on Render (or leave "" for none).
const SECRET = "big2-thrule1234";
const SHEET_NAME = "แมตช์";
// Only needed if this script was NOT created from the sheet (Extensions > Apps Script).
// Paste the sheet's ID: the long text between /d/ and /edit in its address.
const SPREADSHEET_ID = "";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (SECRET && data.secret !== SECRET) return out_("forbidden");
    const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) sh = ss.insertSheet(SHEET_NAME);
    if (sh.getLastRow() === 0) {
      sh.appendRow(["วันที่", "เวลา", "ชื่อ", "คะแนน", "อันดับ", "จำนวนรอบ", "รหัสแมตช์"]);
      sh.setFrozenRows(1);
    }
    // a retry after a lost reply must not add the match twice
    const last = sh.getLastRow();
    if (last > 1) {
      const ids = sh.getRange(2, 7, last - 1, 1).getValues().flat();
      if (ids.indexOf(data.matchId) !== -1) return out_("duplicate");
    }
    const rows = data.rows.map(function (r) {
      return [data.date, data.time, r.name, r.score, r.rank, data.rounds, data.matchId];
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 7).setNumberFormat("@").setValues(rows);
    // keep score/rank/rounds as real numbers
    sh.getRange(sh.getLastRow() - rows.length + 1, 4, rows.length, 3).setNumberFormat("0");
    return out_("ok");
  } catch (err) {
    return out_("error: " + err);
  }
}

function out_(s) { return ContentService.createTextOutput(s); }
