// Two-page print PDF (side 1 = outside, side 2 = inside) from the 600 dpi masters.
// PNG embedding is lossless; TrimBox marks the A4 cut, BleedBox the 3 mm around it.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("D:/hostel-management-software/package.json");
const { PDFDocument } = require("pdf-lib");
const mm = (v) => (v * 72) / 25.4;
const pdf = await PDFDocument.create();
pdf.setTitle("HostelPalika pamphlet — print (A4 tri-fold, 3 mm bleed)");
pdf.setAuthor("Softmato Technology Pvt. Ltd.");
for (const side of ["outside", "inside"]) {
  const img = await pdf.embedPng(readFileSync(`${side}_master600.png`));
  const page = pdf.addPage([mm(303), mm(216)]);
  page.drawImage(img, { x: 0, y: 0, width: mm(303), height: mm(216) });
  page.setBleedBox(0, 0, mm(303), mm(216));
  page.setTrimBox(mm(3), mm(3), mm(297), mm(210));
}
writeFileSync(process.argv[2] ?? "pamphlet-print.pdf", await pdf.save());
console.log("pdf written");
