// Minimal standards-compliant XLSX writer with built-in Node.js modules only.
// Inline strings are always text, so user-supplied cells cannot become formulas.
const zlib = require('node:zlib');

const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
function col(n) { let s=''; for(;n;n=Math.floor((n-1)/26)) s=String.fromCharCode(65+(n-1)%26)+s; return s; }
function sheetXml(columns,rows) {
  const widths=columns.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${Math.min(45,Math.max(11,c.length+5))}" customWidth="1"/>`).join('');
  const all=[columns,...rows];
  const lines=all.map((values,row)=>'<row r="'+(row+1)+'">'+values.map((v,i)=>{
    if(v===null || v===undefined)return '';
    const ref=col(i+1)+(row+1),style=row===0?' s="1"':'';
    if(v && typeof v==='object' && typeof v.formula==='string') {
      // Only server-generated formulas are accepted, never user-provided values.
      if(!/^IF\(B[23]>0,[CD][23]\/B[23]\*100,""\)$/.test(v.formula))throw new Error('Rumus ekspor tidak diizinkan');
      return `<c r="${ref}"><f>${esc(v.formula)}</f><v>${Number.isFinite(v.cached)?v.cached:0}</v></c>`;
    }
    if(typeof v==='number'&&Number.isFinite(v))return `<c r="${ref}"${style}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('')+'</row>').join('');
  const end=col(columns.length)+all.length;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
    `<dimension ref="A1:${end}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`+
    `<cols>${widths}</cols><sheetData>${lines}</sheetData><autoFilter ref="A1:${col(columns.length)}${all.length}"/></worksheet>`;
}
function crc32(buffer) {
  let crc=0xffffffff;
  for(const b of buffer){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^(-(crc&1)&0xedb88320);}
  return (crc^0xffffffff)>>>0;
}
function zip(files) {
  let offset=0;const local=[],central=[];
  for(const [name,value] of Object.entries(files)) {
    const filename=Buffer.from(name),data=Buffer.from(value,'utf8'),compressed=zlib.deflateRawSync(data);
    const crc=crc32(data),hdr=Buffer.alloc(30),cen=Buffer.alloc(46);
    hdr.writeUInt32LE(0x04034b50,0);hdr.writeUInt16LE(20,4);hdr.writeUInt16LE(0x0800,6);
    hdr.writeUInt16LE(8,8);hdr.writeUInt32LE(crc,14);hdr.writeUInt32LE(compressed.length,18);
    hdr.writeUInt32LE(data.length,22);hdr.writeUInt16LE(filename.length,26);
    cen.writeUInt32LE(0x02014b50,0);cen.writeUInt16LE(20,4);cen.writeUInt16LE(20,6);
    cen.writeUInt16LE(0x0800,8);cen.writeUInt16LE(8,10);cen.writeUInt32LE(crc,16);
    cen.writeUInt32LE(compressed.length,20);cen.writeUInt32LE(data.length,24);
    cen.writeUInt16LE(filename.length,28);cen.writeUInt32LE(offset,42);
    local.push(hdr,filename,compressed);central.push(cen,filename);
    offset+=hdr.length+filename.length+compressed.length;
  }
  const centralLen=central.reduce((sum,b)=>sum+b.length,0);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);
  end.writeUInt32LE(centralLen,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,...central,end]);
}
function makeWorkbook(tabs) {
  if(!tabs?.length||tabs.length>10)throw new Error('Jumlah sheet tidak valid');
  const files={
    '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tabs.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tabs.map((s,i)=>`<sheet name="${esc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tabs.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${tabs.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml':`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF123B54"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`
  };
  for(let i=0;i<tabs.length;i++)files[`xl/worksheets/sheet${i+1}.xml`]=sheetXml(tabs[i].columns,tabs[i].rows);
  return zip(files);
}
module.exports={makeWorkbook};
