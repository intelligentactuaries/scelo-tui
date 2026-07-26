// A minimal .xlsx writer — the OOXML a spreadsheet actually requires.
//
// Strings go in as inline strings rather than a shared-string table: one
// fewer part, no indirection, and every consumer that matters (Excel,
// LibreOffice, openpyxl, Google Sheets) reads them. Numbers are written as
// numbers — the whole point of handing an actuary a workbook instead of a
// PDF is that the cells compute.

import { type ZipEntry, buildZip } from "./zip";

export type SheetCell = string | number | null;
export type Sheet = { name: string; rows: SheetCell[][] };

/** Escape for XML text and attribute content. Control characters are
 *  stripped outright — Excel refuses the whole file over one 0x07 in a cell,
 *  which is not a trade worth making for fidelity to a broken byte. */
function esc(s: string): string {
  return (
    s
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  );
}

/** 0 → A, 25 → Z, 26 → AA … the base-26-without-zero column scheme. */
export function colRef(n: number): string {
  let s = "";
  let x = n;
  while (x >= 0) {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  }
  return s;
}

function sheetXml(sheet: Sheet): string {
  const rows: string[] = [];
  for (let r = 0; r < sheet.rows.length; r++) {
    const cells: string[] = [];
    for (let c = 0; c < sheet.rows[r].length; c++) {
      const v = sheet.rows[r][c];
      if (v === null) continue;
      const ref = `${colRef(c)}${r + 1}`;
      if (typeof v === "number" && Number.isFinite(v)) {
        cells.push(`<c r="${ref}"><v>${v}</v></c>`);
      } else {
        const text = typeof v === "number" ? String(v) : v;
        cells.push(
          `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`,
        );
      }
    }
    rows.push(`<row r="${r + 1}">${cells.join("")}</row>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${rows.join("")}</sheetData></worksheet>`
  );
}

/** Excel's own hard rules for tab names; the caller picks nice ones, this
 *  just refuses to build a file Excel would refuse to open. */
function safeSheetName(name: string, index: number): string {
  const cleaned = name.replace(/[[\]*?:/\\]/g, " ").trim().slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

export function buildXlsx(sheets: Sheet[], mtime?: Date): Uint8Array {
  const enc = new TextEncoder();
  const names = sheets.map((s, i) => safeSheetName(s.name, i));

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets
      .map(
        (_s, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    names
      .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("") +
    `</sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map(
        (_s, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  // The empty-but-valid style part: one of everything, referenced by
  // nothing. The named "Normal" cell style is what readers mean by "default
  // style" — openpyxl warns without it, and Excel synthesises one anyway.
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
    `<borders count="1"><border/></borders>` +
    `<cellStyleXfs count="1"><xf/></cellStyleXfs>` +
    `<cellXfs count="1"><xf xfId="0"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rootRels) },
    { name: "xl/workbook.xml", data: enc.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(workbookRels) },
    { name: "xl/styles.xml", data: enc.encode(styles) },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: enc.encode(sheetXml(s)),
    })),
  ];
  return buildZip(entries, mtime);
}
