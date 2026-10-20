import {validateDocumentField,validateDocumentSchema} from './schema.mjs';

const fail=(code='invalid_structured_candidate')=>{throw new TypeError(code);};
const prepared=new WeakSet();
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const keys=(value,allowed)=>plain(value)&&Object.keys(value).every(key=>allowed.includes(key));
const freeze=value=>{if(value&&typeof value==='object'){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
function literalIn(text,value){
 const needle=String(value),word=/[\p{L}\p{N}._-]/u;
 for(let start=text.indexOf(needle);start!==-1;start=text.indexOf(needle,start+1)){
  const before=start?text[start-1]:'',after=text[start+needle.length]??'';
  if(!(before&&word.test(before))&&!(after&&word.test(after)))return true;
 }
 return false;
}

// The parser/OCR worker owns these sources. This stage never manufactures a
// citation from the document's combined text or from model-supplied metadata.
export function prepareStructuredEvidence(report){
 if(!plain(report)||!plain(report.document)||!/^[a-f0-9]{64}$/.test(report.document.sha256))fail('invalid_structured_evidence');
 if(report.units!==undefined&&!Array.isArray(report.units)||report.pages!==undefined&&!Array.isArray(report.pages))fail('invalid_structured_evidence');
 if((report.units?.length??0)>128||(report.pages?.length??0)>100)fail('invalid_structured_evidence');
 const units=[...(report.units??[])];
 for(const page of report.pages??[]){
  if(!plain(page)||page.units!==undefined&&!Array.isArray(page.units)||page.ocr!==undefined&&(!plain(page.ocr)||!Array.isArray(page.ocr.units)))fail('invalid_structured_evidence');
  if(units.length+(page.units?.length??0)+(page.ocr?.units?.length??0)>128)fail('invalid_structured_evidence');
  units.push(...(page.units??[]),...(page.ocr?.units??[]));
 }
 if(!units.length||units.length>128)fail('invalid_structured_evidence');
 let total=0;
 const evidence=units.map((unit,index)=>{
  if(!plain(unit)||typeof unit.text!=='string'||!unit.text.trim()||Buffer.byteLength(unit.text)>1024||!plain(unit.source))fail('invalid_structured_evidence');
  total+=Buffer.byteLength(unit.text);if(total>16384)fail('invalid_structured_evidence');
  let source;
  try{const raw=JSON.stringify(unit.source);if(!raw||Buffer.byteLength(raw)>2048)fail('invalid_structured_evidence');source=JSON.parse(raw);}catch{fail('invalid_structured_evidence');}
  if(source.documentSha256!==undefined&&source.documentSha256!==report.document.sha256)fail('invalid_structured_evidence');
  source.documentSha256=report.document.sha256;
  return freeze({id:'u'+String(index+1).padStart(4,'0'),text:unit.text,source});
 });
 Object.freeze(evidence);prepared.add(evidence);return evidence;
}

// This is a constrained evidence checker, not a claim of semantic truth. A
// literal match plus a source citation still requires human review.
export function assessStructuredCandidates(schemaInput,evidence,modelText){
 const schema=validateDocumentSchema(schemaInput);
 if(!prepared.has(evidence)||typeof modelText!=='string'||Buffer.byteLength(modelText)>32768)fail();
 const byId=new Map(evidence.map(unit=>[unit.id,unit]));
 if(byId.size!==evidence.length||evidence.some(unit=>!plain(unit)||typeof unit.text!=='string'||!plain(unit.source)))fail();
 let parsed;try{parsed=JSON.parse(modelText);if(modelText!==JSON.stringify(parsed))fail();}catch{fail();}
 if(!keys(parsed,['fields'])||!Object.hasOwn(parsed,'fields')||!plain(parsed.fields)||Object.keys(parsed.fields).some(name=>!Object.hasOwn(schema.schema.properties,name)))fail();
 const fields=Object.create(null);
 for(const name of Object.keys(schema.schema.properties)){
  const rows=parsed.fields[name];
  if(rows===undefined){fields[name]=freeze({status:'missing',required:schema.schema.required.includes(name)});continue;}
  if(!Array.isArray(rows)||rows.length<1||rows.length>4)fail();
  const accepted=[];
  for(const row of rows){
   if(!keys(row,['value','evidenceIds'])||Object.keys(row).length!==2||typeof row.value==='string'&&!row.value.trim()||!validateDocumentField(schema,name,row.value).valid||!Array.isArray(row.evidenceIds)||row.evidenceIds.length<1||row.evidenceIds.length>4||new Set(row.evidenceIds).size!==row.evidenceIds.length)fail();
   const sources=[];
   for(const id of row.evidenceIds){
    const unit=byId.get(id);
    if(!unit||!literalIn(unit.text,row.value))fail();
    sources.push(unit.source);
   }
   accepted.push(freeze({value:row.value,evidenceIds:[...row.evidenceIds],sources}));
  }
  const distinct=new Set(accepted.map(row=>JSON.stringify(row.value)));
  fields[name]=distinct.size===1?freeze({status:'found',required:schema.schema.required.includes(name),value:accepted[0].value,candidates:accepted}):freeze({status:'conflict',required:schema.schema.required.includes(name),candidates:accepted});
 }
 return freeze({schemaId:schema.schemaId,revision:schema.revision,fields,reviewRequired:true});
}
