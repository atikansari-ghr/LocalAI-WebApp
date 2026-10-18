import {inspectDocument,decodeDocumentUtf8,DocumentError} from './validation.mjs';

const fail=code=>{throw new DocumentError(code);};
const MAX_UNITS=10000,MAX_LINE=65536;
function add(units,text,source){if(text.length>MAX_LINE)fail('text_line_limit');if(units.length>=MAX_UNITS)fail('text_unit_limit');units.push(Object.freeze({text,source:Object.freeze({...source,unit:'utf16'})}));}
function physicalLines(text){
 const lines=[];let start=0,line=1;
 for(let index=0;index<=text.length;index++)if(index===text.length||text[index]==='\r'||text[index]==='\n'){
  if(index===text.length&&start===text.length)break;
  add(lines,text.slice(start,index),{kind:'text',line,start,end:index});
  if(text[index]==='\r'&&text[index+1]==='\n')index++;
  start=index+1;line++;
 }
 return lines;
}
function validateJson(text){
 let value;try{value=JSON.parse(text);}catch{fail('invalid_json');}
 const stack=[[value,0]];let nodes=0;
 while(stack.length){const [item,depth]=stack.pop();if(++nodes>MAX_UNITS||depth>32)fail('json_structure_limit');if(item!==null&&typeof item==='object'){const children=Object.values(item);if(children.length+stack.length+nodes>MAX_UNITS)fail('json_structure_limit');for(const child of children)stack.push([child,depth+1]);}}
}
function parseCsv(text){
 const units=[],rows=[];let index=0,row=1,column=1,values=[];
 while(index<=text.length){
  const start=index;let value='';
  if(text[index]==='"'){
   index++;let closed=false;
   while(index<text.length){const char=text[index++];if(char==='"'){if(text[index]==='"'){value+='"';index++;}else{closed=true;break;}}else value+=char;if(value.length>MAX_LINE)fail('text_line_limit');}
   if(!closed||!(index===text.length||[',','\r','\n'].includes(text[index])))fail('invalid_csv');
  }else{while(index<text.length&&![',','\r','\n'].includes(text[index])){if(text[index]==='"')fail('invalid_csv');value+=text[index++];if(value.length>MAX_LINE)fail('text_line_limit');}}
  if(column>256)fail('csv_column_limit');
  add(units,value,{kind:'cell',row,column,start,end:index});values.push(value);
  if(index===text.length){rows.push(values);break;}
  if(text[index]===','){index++;column++;continue;}
  if(text[index]==='\r'&&text[index+1]==='\n')index++;
  index++;rows.push(values);values=[];column=1;row++;
  if(index===text.length)break;
 }
 return {units,text:rows.map(cells=>cells.join('\t')).join('\n'),warnings:['cell_content_is_literal_text']};
}
function parseCalendar(text){
 const unfolded=[];
 for(const line of physicalLines(text)){
  if(/^[ \t]/.test(line.text)){
   if(!unfolded.length)fail('invalid_calendar');const prior=unfolded.at(-1);prior.text+=line.text.slice(1);prior.source.end=line.source.end;prior.source.endLine=line.source.line;if(prior.text.length>MAX_LINE)fail('text_line_limit');
  }else unfolded.push({text:line.text,source:{...line.source,endLine:line.source.line}});
 }
 const stack=[];let opened=false,finished=false,version=false;
 for(const line of unfolded){
  if(!line.text)continue;if(finished)fail('invalid_calendar');
  const colon=line.text.indexOf(':');if(colon<1||!/^[-A-Za-z0-9]+(?:;[^\r\n]*)?$/.test(line.text.slice(0,colon)))fail('invalid_calendar');
  const key=line.text.slice(0,colon).toUpperCase(),value=line.text.slice(colon+1);
  if(key==='BEGIN'){
   if(!/^[A-Za-z0-9-]{1,64}$/.test(value)||stack.length>=32)fail('invalid_calendar');
   if(!stack.length){if(opened||value.toUpperCase()!=='VCALENDAR')fail('invalid_calendar');opened=true;}
   stack.push(value.toUpperCase());
  }else if(key==='END'){if(!stack.length||stack.pop()!==value.toUpperCase())fail('invalid_calendar');if(!stack.length)finished=true;}
  else{if(!stack.length)fail('invalid_calendar');if(key==='VERSION'&&stack.length===1){if(version||value!=='2.0')fail('invalid_calendar');version=true;}}
 }
 if(!opened||!finished||stack.length||!version)fail('invalid_calendar');
 const units=[];for(const line of unfolded)add(units,line.text,line.source);
 return {units,text:units.map(line=>line.text).join('\n'),warnings:['calendar_content_only_no_events_created']};
}
export function parseTextDocument(input,limits={}){
 // Inspection rejects shared memory and limits size before allocation. Parsing
 // then uses an owned copy in the same synchronous turn, with no caller yield.
 if(!(input?.bytes instanceof Uint8Array))fail('invalid_bytes');
 const document=inspectDocument(input,limits),bytes=Buffer.from(input.bytes);
 if(!['txt','md','json','csv','ics'].includes(document.format))fail('parser_unavailable');
 const text=decodeDocumentUtf8(bytes);if(!text.length)fail('empty_text');let parsed;
 if(document.format==='csv')parsed=parseCsv(text);
 else if(document.format==='ics')parsed=parseCalendar(text);
 else{if(document.format==='json')validateJson(text);parsed={text,units:physicalLines(text),warnings:document.format==='json'?['json_members_retained_as_literal_source']:[]};}
 if(Buffer.byteLength(parsed.text)>(limits.maxTextBytes??1024**2))fail('text_output_limit');
 return Object.freeze({document,parser:'localai-'+document.format+'-v1',text:parsed.text,units:Object.freeze(parsed.units),warnings:Object.freeze(parsed.warnings)});
}
