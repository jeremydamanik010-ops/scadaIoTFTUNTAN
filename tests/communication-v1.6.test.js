// Self-contained V1.6 tests. No external npm packages or cloud connections.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {diffMs,clockQuality,parseDateWindow,stats,packetIdOrNew}=require('../services/communication-metrics');
const {makeWorkbook}=require('../services/xlsx-export');
assert.equal(diffMs('2026-11-05T12:00:00.153Z','2026-11-05T12:00:00.100Z'),53);
assert.equal(diffMs('invalid','2026-11-05T12:00:00Z'),null);
assert.equal(clockQuality('local_os'),'unverified');
assert.equal(clockQuality('ntp_synced'),'ntp_synced');
assert.equal(stats([null,undefined,100,200,-20]).avg,150);
assert.equal(stats([null,undefined]).count,0);
assert.equal(packetIdOrNew('abc').length,36);
assert.equal(parseDateWindow('2026-11-05','2026-11-05').from,'2026-11-04T17:00:00.000Z');
assert.equal(parseDateWindow('2026-11-05','2026-11-05').to,'2026-11-05T17:00:00.000Z');
assert.throws(()=>parseDateWindow('2026-11-05','2026-12-10'));
assert.throws(()=>parseDateWindow('2026-02-30','2026-03-01'));
const tabs=[{name:'Data Sensor',columns:['ID','Suhu','Catatan'],rows:[['a',30.5,'=DANGEROUS'],['b',28,'<RTU>']]},
 {name:'Delay RTU-MTU',columns:['Delay ms'],rows:[[83.5]]},
 {name:'Kontrol MTU-RTU',columns:['RTT ms'],rows:[[122.2]]},
 {name:'Statistik',columns:['Parameter','Nilai'],rows:[['Paket',2]]}];
const xlsx=makeWorkbook(tabs);
assert.equal(xlsx.readUInt32LE(0),0x04034b50);
assert(xlsx.includes(Buffer.from('xl/workbook.xml')));
fs.writeFileSync('/mnt/data/scada_v16_test.xlsx',xlsx);
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/script.js'),'utf8');
assert(source.includes('queueBrowserReceipt(payload.packet_id,browserReceivedAt)'));
assert(source.includes('exportCommunicationExcel()')); 
console.log('✅ V1.6 metrics, date UTC+7, missing-value stats, XLSX ZIP, browser receipt: OK');
