// Deliberately small, data-only JSON Schema profile. This is a candidate
// internal contract, not a general JSON Schema evaluator or public API.
const invalid=()=>{throw new TypeError('invalid_document_schema');};
const forbidden=new Set(['__proto__','prototype','constructor']);
const identifier=/^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const fieldName=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const valueIdentifier=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const amount=/^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/;
const limits={properties:64,enum:16,schemaBytes:32768,stringLength:1024};

function record(value,allowed,required=allowed){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)invalid();
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Object.keys(descriptors);
 if(keys.some(key=>forbidden.has(key)||(allowed!==null&&!allowed.includes(key))||!Object.hasOwn(descriptors[key],'value')||!descriptors[key].enumerable)||required.some(key=>!Object.hasOwn(descriptors,key)))invalid();
 return Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
}
function list(value,maximum){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>maximum||Object.getOwnPropertySymbols(value).length)invalid();
 const entries=Object.getOwnPropertyDescriptors(value);
 if(Object.keys(entries).length!==value.length+1||Object.keys(entries).some(key=>key!=='length'&&(!/^(?:0|[1-9][0-9]*)$/.test(key)||Number(key)>=value.length||!Object.hasOwn(entries[key],'value'))))invalid();
 return Array.from({length:value.length},(_,index)=>entries[index].value);
}
function date(value){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return false;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 if(year<1||month<1||month>12)return false;
 const leap=year%4===0&&(year%100!==0||year%400===0);
 return day>=1&&day<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
}
function validValue(rule,value){
 if(rule.type==='string'){
  if(typeof value!=='string'||value.length>4096||Buffer.byteLength(value)>4096)return false;
  const length=Array.from(value).length;
  if(length<(rule.minLength??0)||length>(rule.maxLength??limits.stringLength)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))return false;
  if(rule.format==='date'&&!date(value)||rule.format==='identifier'&&!valueIdentifier.test(value)||rule.format==='amount'&&!amount.test(value))return false;
 }else if(rule.type==='integer'){
  if(!Number.isSafeInteger(value)||value<(rule.minimum??-1e12)||value>(rule.maximum??1e12))return false;
 }else if(rule.type==='number'){
  if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e12||value<(rule.minimum??-1e12)||value>(rule.maximum??1e12))return false;
 }else if(rule.type==='boolean'){
  if(typeof value!=='boolean')return false;
 }else return false;
 return rule.enum===undefined||rule.enum.some(item=>Object.is(item,value));
}
function field(input){
 const raw=record(input,['type','format','minLength','maxLength','minimum','maximum','enum'],['type']);
 if(!['string','integer','number','boolean'].includes(raw.type))invalid();
 const allowed=raw.type==='string'?['type','format','minLength','maxLength','enum']:raw.type==='boolean'?['type','enum']:['type','minimum','maximum','enum'];
 if(Object.keys(raw).some(key=>!allowed.includes(key)))invalid();
 if(raw.format!==undefined&&!['date','identifier','amount'].includes(raw.format))invalid();
 if(raw.minLength!==undefined&&(!Number.isSafeInteger(raw.minLength)||raw.minLength<0||raw.minLength>limits.stringLength))invalid();
 if(raw.maxLength!==undefined&&(!Number.isSafeInteger(raw.maxLength)||raw.maxLength<1||raw.maxLength>limits.stringLength))invalid();
 if((raw.minLength??0)>(raw.maxLength??limits.stringLength))invalid();
 for(const key of ['minimum','maximum'])if(raw[key]!==undefined&&(typeof raw[key]!=='number'||!Number.isFinite(raw[key])||Math.abs(raw[key])>1e12||(raw.type==='integer'&&!Number.isSafeInteger(raw[key]))))invalid();
 if((raw.minimum??-1e12)>(raw.maximum??1e12))invalid();
 const result={...raw};
 if(raw.enum!==undefined){
  const values=list(raw.enum,limits.enum);if(!values.length)invalid();
  result.enum=[];
  for(const value of values){if(typeof value==='number'&&Object.is(value,-0)||!validValue({...raw,enum:undefined},value)||result.enum.some(previous=>Object.is(previous,value)))invalid();result.enum.push(value);}
  Object.freeze(result.enum);
 }
 return Object.freeze(result);
}

export function validateDocumentSchema(input){
 const envelope=record(input,['schemaVersion','schemaId','revision','schema']);
 if(envelope.schemaVersion!==1||typeof envelope.schemaId!=='string'||!identifier.test(envelope.schemaId)||!Number.isSafeInteger(envelope.revision)||envelope.revision<1||envelope.revision>1000000)invalid();
 const schema=record(envelope.schema,['type','additionalProperties','properties','required']);
 if(schema.type!=='object'||schema.additionalProperties!==false)invalid();
 const properties=record(schema.properties,null,[]),names=Object.keys(properties);
 if(!names.length||names.length>limits.properties||names.some(name=>!fieldName.test(name)))invalid();
 const required=list(schema.required,limits.properties),seen=new Set();
 if(required.some(name=>typeof name!=='string'||!Object.hasOwn(properties,name)||seen.has(name)||!seen.add(name)))invalid();
 const normalized=Object.create(null);
 for(const name of names)normalized[name]=field(properties[name]);
 const result={schemaVersion:1,schemaId:envelope.schemaId,revision:envelope.revision,schema:Object.freeze({type:'object',additionalProperties:false,properties:Object.freeze(normalized),required:Object.freeze(required)})};
 if(Buffer.byteLength(JSON.stringify(result))>limits.schemaBytes)invalid();
 return Object.freeze(result);
}

export function validateDocumentField(schema,name,value){
 if(!schema||typeof name!=='string'||!Object.hasOwn(schema.schema?.properties??{},name))return {valid:false,code:'unknown_field'};
 return validValue(schema.schema.properties[name],value)?{valid:true}:{valid:false,code:'invalid_value'};
}
