import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDocumentSchema,validateDocumentField} from '../services/documents/schema.mjs';

const schema=()=>({schemaVersion:1,schemaId:'invoice',revision:2,schema:{type:'object',additionalProperties:false,properties:{
 issued:{type:'string',format:'date'},reference:{type:'string',format:'identifier',maxLength:32},total:{type:'string',format:'amount'},
 count:{type:'integer',minimum:0,maximum:100},ratio:{type:'number',minimum:0,maximum:1},paid:{type:'boolean'},currency:{type:'string',enum:['SAR','USD']}
},required:['issued','reference','total']}});

test('versioned flat schema is copied and immutable, and required means required by the caller',()=>{
 const input=schema(),validated=validateDocumentSchema(input);
 input.schema.properties.currency.enum[0]='X';
 assert.equal(validated.schemaVersion,1);assert.equal(validated.schemaId,'invoice');assert.equal(validated.revision,2);
 assert.deepEqual(validated.schema.properties.currency.enum,['SAR','USD']);
 assert.ok(Object.isFrozen(validated));assert.ok(Object.isFrozen(validated.schema.properties.currency.enum));
 assert.deepEqual(validated.schema.required,['issued','reference','total']);
});

test('field validators accept exact types and deterministic date, identifier and amount formats',()=>{
 const validated=validateDocumentSchema(schema());
 for(const [field,value] of [['issued','2024-02-29'],['reference','INV-2024_007'],['total','-123456.70'],['count',0],['ratio',0.25],['paid',false],['currency','SAR']])assert.deepEqual(validateDocumentField(validated,field,value),{valid:true});
 for(const [field,value] of [['issued','2023-02-29'],['issued','2024-2-9'],['reference','../secret'],['reference','مرحبا'],['total','1,234.00'],['total','1e3'],['total','123.456'],['count',1.5],['count',101],['count',Number.MAX_SAFE_INTEGER+1],['ratio',Infinity],['ratio',-0.1],['paid','false'],['currency','EUR'],['missing','x']])assert.equal(validateDocumentField(validated,field,value).valid,false,`${field}: ${value}`);
});

test('schema rejects references, executable patterns, unknown keywords, nesting and unsafe names',()=>{
 const variants=[
  {$ref:'#/definitions/x'},{$ref:'https://example.com/schema'},{$defs:{}},{pattern:'^.*$'},{default:'x'},{xValidate:'run'},
  {type:'object',properties:{}},{type:'array',items:{type:'string'}},
 ];
 for(const property of variants){const input=schema();input.schema.properties.reference={type:'string',...property};assert.throws(()=>validateDocumentSchema(input),/invalid_document_schema/);}
 for(const key of ['__proto__','prototype','constructor','$ref']){const input=schema();input.schema.properties=JSON.parse(`{"${key}":{"type":"string"}}`);input.schema.required=[];assert.throws(()=>validateDocumentSchema(input),/invalid_document_schema/);}
 for(const patch of [{schemaVersion:2},{revision:0},{schemaId:'../other'},{extra:true}])assert.throws(()=>validateDocumentSchema({...schema(),...patch}),/invalid_document_schema/);
});

test('schema rejects huge, ambiguous and non-data structures before use',()=>{
 const bad=[schema(),schema(),schema(),schema(),schema(),schema(),schema(),schema()];
 bad[0].schema.properties=Object.fromEntries(Array.from({length:65},(_,i)=>['f'+i,{type:'string'}]));bad[0].schema.required=[];
 bad[1].schema.properties.currency.enum=Array.from({length:17},(_,i)=>'C'+i);
 bad[2].schema.required=['issued','issued'];
 bad[3].schema.required=['absent'];
 bad[4].schema.properties.reference.maxLength=100000;
 bad[5].schema.properties.reference.enum=['x','x'];
 Object.defineProperty(bad[6].schema.properties.reference,'format',{get(){throw new Error('getter executed');},enumerable:true});
 bad[7].schema.properties.reference.minimum=0;
 for(const input of bad)assert.throws(()=>validateDocumentSchema(input),/invalid_document_schema/);
 assert.throws(()=>validateDocumentSchema(JSON.parse('{"schemaVersion":1,"schemaId":"x","revision":1,"schema":{"type":"object","additionalProperties":false,"properties":{},"required":[],"__proto__":{}}}')),/invalid_document_schema/);
 const absent=schema();absent.schema.properties=null;assert.throws(()=>validateDocumentSchema(absent),/invalid_document_schema/);
 const oversized=schema();oversized.schema.properties.currency.enum=Array.from({length:16},(_,i)=>String(i).padEnd(1024,'A'));oversized.schema.properties.note={type:'string',enum:Array.from({length:16},(_,i)=>String(i).padEnd(1024,'B'))};assert.throws(()=>validateDocumentSchema(oversized),/invalid_document_schema/);
});

test('numeric enums remain stable after JSON persistence and oversized field strings are rejected',()=>{
 const negative=schema();negative.schema.properties.ratio.enum=[-0];
 assert.throws(()=>validateDocumentSchema(negative),/invalid_document_schema/);
 const duplicate=schema();duplicate.schema.properties.ratio.enum=[-0,0];
 assert.throws(()=>validateDocumentSchema(duplicate),/invalid_document_schema/);
 const valid=validateDocumentSchema(schema());
 assert.deepEqual(validateDocumentField(valid,'reference','x'.repeat(10000000)),{valid:false,code:'invalid_value'});
});
