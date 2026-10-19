import {officeContext,OFFICE_REL,children,one,descendants,attr,fragments,literal,fail} from './office-xml.mjs';
const S='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function coordinate(value){const match=/^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(value??'');if(!match)fail('spreadsheet_invalid_coordinate');let column=0;for(const char of match[1])column=column*26+char.charCodeAt(0)-64;const row=Number(match[2]);if(column>16384||row>1048576)fail('spreadsheet_invalid_coordinate');return {column,row};}
function textNodes(node){return children(node,S,'t').concat(children(node,S,'r').flatMap(r=>children(r,S,'t')));}
export async function parseSpreadsheetDocument(input,options={}){
 const ctx=await officeContext(input,options,'xlsx'),workbook=ctx.read(ctx.pkg.mainPart),rels=ctx.relationships(ctx.pkg.mainPart),stringsRels=[...rels.values()].filter(r=>r.type===OFFICE_REL+'/sharedStrings');if(stringsRels.length>1)fail('spreadsheet_shared_strings_invalid');
 const strings=[];if(stringsRels.length){const root=ctx.read(stringsRels[0].target);if(root.ns!==S||root.local!=='sst')fail('spreadsheet_shared_strings_invalid');for(const si of children(root,S,'si')){const nodes=textNodes(si);strings.push({text:nodes.map(literal).join(''),sources:nodes.flatMap(fragments)});}}
 const sheetList=one(workbook,S,'sheets');if(!sheetList)fail('spreadsheet_sheets_missing');const cells=[],output=[],sheetIds=new Set(),names=new Set(),targets=new Set(),warnings=new Set(['spreadsheet_values_not_formatted','spreadsheet_formulas_not_evaluated','spreadsheet_charts_comments_and_layout_not_extracted']);
 for(const sheet of children(sheetList,S,'sheet')){
  ctx.check();const name=attr(sheet,'name'),id=attr(sheet,'sheetId'),rel=rels.get(attr(sheet,'id',OFFICE_REL));if(!name||name.length>31||/[\u0000-\u001f\[\]:*?\\/]/.test(name)||!id||sheetIds.has(id)||names.has(name.toLowerCase())||!rel||rel.type!==OFFICE_REL+'/worksheet'||targets.has(rel.target))fail('spreadsheet_sheet_invalid');sheetIds.add(id);names.add(name.toLowerCase());targets.add(rel.target);
  if(attr(sheet,'state')&&attr(sheet,'state')!=='visible')warnings.add('spreadsheet_hidden_sheets_included');
  const root=ctx.read(rel.target);if(root.ns!==S||root.local!=='worksheet')fail('spreadsheet_worksheet_invalid');const data=one(root,S,'sheetData');if(!data)fail('spreadsheet_data_missing');let previousRow=0;
  for(const row of children(data,S,'row')){
   const rowIndex=Number(attr(row,'r'));if(!Number.isSafeInteger(rowIndex)||rowIndex<=previousRow||rowIndex>1048576)fail('spreadsheet_invalid_row');previousRow=rowIndex;let previousColumn=0;
   if(attr(row,'hidden')==='1'||attr(row,'hidden')==='true')warnings.add('spreadsheet_hidden_rows_included');
   for(const cell of children(row,S,'c')){
    const ref=attr(cell,'r'),position=coordinate(ref);if(position.row!==rowIndex||position.column<=previousColumn)fail('spreadsheet_invalid_coordinate');previousColumn=position.column;
    const value=one(cell,S,'v'),formula=one(cell,S,'f'),inline=one(cell,S,'is'),type=attr(cell,'t')??'n';let text='',sources=[];
    if(formula&&(attr(formula,'t')??'normal')!=='normal')fail('spreadsheet_formula_kind_unsupported');
    if(type==='s'){const raw=value?literal(value):'',index=Number(raw);if(!/^(0|[1-9][0-9]*)$/.test(raw)||!Number.isSafeInteger(index)||!strings[index])fail('spreadsheet_string_index_invalid');text=strings[index].text;sources=strings[index].sources;}
    else if(type==='inlineStr'){if(!inline||value)fail('spreadsheet_inline_string_invalid');const nodes=textNodes(inline);text=nodes.map(literal).join('');sources=nodes.flatMap(fragments);}
    else if(['n','str','b','e','d'].includes(type)){text=value?literal(value):'';sources=value?fragments(value):[];}
    else fail('spreadsheet_cell_type_unsupported');
    const formulaText=formula?literal(formula):undefined;if(formula&&!value){text='='+formulaText;sources=fragments(formula);warnings.add('spreadsheet_formula_cached_value_missing');}
    const rendered=name+'!'+ref+'\t'+text+'\n';ctx.add(rendered,sources.length+1);
    cells.push(Object.freeze({text,type,source:Object.freeze({...ctx.source(rel.target,cell),sheet:name,sheetId:id,cell:ref,row:position.row,column:position.column}),valueSources:Object.freeze(sources),...(formula?{formula:formulaText,formulaSources:Object.freeze(fragments(formula)),cached:Boolean(value)}:{})}));output.push(rendered);
   }
  }
 }
 return Object.freeze({document:ctx.pkg.document,parser:'spreadsheet-literal-v1+saxes-6.0.0',text:output.join(''),cells:Object.freeze(cells),warnings:Object.freeze([...warnings])});
}
