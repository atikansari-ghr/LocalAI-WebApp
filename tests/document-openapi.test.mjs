import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('planned document OpenAPI has resolvable local references and explicit disabled availability',()=>{
 const spec=JSON.parse(readFileSync(new URL('../docs/openapi-documents.json',import.meta.url),'utf8'));
 assert.equal(spec.openapi,'3.1.2');assert.equal(spec['x-localai-availability'],'planned-disabled');
 const ids=new Set();
 for(const [path,methods] of Object.entries(spec.paths)){
  assert.match(path,/^\/v1\//);
  for(const [method,operation] of Object.entries(methods)){
   assert.ok(['get','post','delete'].includes(method));assert.ok(!ids.has(operation.operationId));ids.add(operation.operationId);
   assert.ok(operation['x-localai-capability']);assert.ok(operation.responses.default);assert.ok(operation.security.length);
   if(method==='get'||method==='delete')assert.equal(operation.requestBody,undefined);
  }
 }
 assert.equal(ids.size,4);
 function walk(value){if(!value||typeof value!=='object')return;if(typeof value.$ref==='string'){assert.match(value.$ref,/^#\//);const target=value.$ref.slice(2).split('/').reduce((at,part)=>at?.[part],spec);assert.ok(target,value.$ref);}for(const nested of Object.values(value))walk(nested);}
 walk(spec);
});
