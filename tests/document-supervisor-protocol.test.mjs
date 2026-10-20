import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchDocumentMessage} from '../services/documents/supervisor-protocol.mjs';

const id='123e4567-e89b-42d3-a456-426614174000';
function fixture(){const calls=[];let status='complete';const store={enqueue:input=>{calls.push(['enqueue',input]);return {id,status:'queued',expiresAt:123};},get:(...args)=>{calls.push(['get',...args]);return {id,status,expiresAt:123};},result:(...args)=>{calls.push(['result',...args]);return {text:'مرحبا'};}};const runner={cancel:(...args)=>{calls.push(['cancel',...args]);return true;}};return {store,runner,calls,setStatus:value=>{status=value;}};}

test('Private supervisor commands enforce a bounded exact payload and scoped status',()=>{
 const context=fixture();
 const submit=dispatchDocumentMessage({op:'submit',namespace:'user:owner',scope:'private',kind:'extract',idempotencyKey:'abcdefghijklmnop',name:'x.txt',mime:'text/plain',content_base64:'eA==',options:{ocr:'off'}},context);
 assert.equal(submit.id,id);assert.equal(context.calls[0][1].bytes.toString(),'x');
 assert.equal(dispatchDocumentMessage({op:'status',id,namespace:'user:owner',scope:'private'},context).result.text,'مرحبا');
 assert.deepEqual(context.calls.at(-2),['get',id,'user:owner','private']);
 context.setStatus('running');
 assert.equal(dispatchDocumentMessage({op:'cancel',id,namespace:'user:owner',scope:'private'},context).status,'cancelling');
 assert.deepEqual(context.calls.at(-1),['cancel',id,'user:owner','private']);
});

test('Private supervisor commands reject malformed identity, data, and extra fields before store access',()=>{
 const context=fixture(),base={op:'submit',namespace:'user:owner',scope:'private',kind:'extract',idempotencyKey:'abcdefghijklmnop',name:'x.txt',mime:'text/plain',content_base64:'eA=='};
 for(const message of [{...base,content_base64:'eA='},{...base,content_base64:'eA==',path:'/etc/passwd'},{...base,namespace:'user:../owner'},{...base,scope:'../other'},{...base,kind:'execute'},{op:'status',id:'../../other',namespace:'user:owner',scope:'private'},{op:'cancel',id,namespace:'app:owner',scope:'private',extra:true}])assert.throws(()=>dispatchDocumentMessage(message,context));
 assert.equal(context.calls.length,0);
});

test('A full 10 MiB canonical upload reaches the encrypted store',()=>{
 let size=0;const store={enqueue:input=>{size=input.bytes.length;return {id,status:'queued'};}},runner={cancel:()=>false};
 const result=dispatchDocumentMessage({op:'submit',namespace:'user:owner',scope:'private',kind:'extract',idempotencyKey:'abcdefghijklmnop',name:'full.txt',mime:'text/plain',content_base64:Buffer.alloc(10*1024**2,120).toString('base64')},{store,runner});
 assert.equal(result.id,id);assert.equal(size,10*1024**2);
});
test('Private delete requests cancellation before durable scoped deletion',()=>{
 const context=fixture();context.store.requestDelete=(...args)=>{context.calls.push(['requestDelete',...args]);return {pending:true};};
 assert.deepEqual(dispatchDocumentMessage({op:'delete',id,namespace:'user:owner',scope:'private'},context),{pending:true});
 assert.deepEqual(context.calls.slice(-2),[['cancel',id,'user:owner','private'],['requestDelete',id,'user:owner','private']]);
 assert.throws(()=>dispatchDocumentMessage({op:'delete',id,namespace:'user:owner',scope:'private',path:'/tmp'},context));
});
