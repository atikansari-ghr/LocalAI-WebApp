// Disposable Debian proof of the separate executor-group socket boundary.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {chmodSync,chownSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {initializeVault} from '../../packages/auth/crypto.mjs';
import {openStructuredJobStore} from '../../services/documents/structured-jobs.mjs';
import {createStructuredReceiptSocket} from '../../services/documents/supervisor-socket.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const executorGid=Number(execFileSync('/usr/bin/id',['-g','nobody'],{encoding:'utf8'}).trim());
const base=mkdtempSync('/tmp/localai-receipt-proof-'),stateDir=join(base,'state'),socketDir=join(base,'executor');
chmodSync(base,0o755);mkdirSync(stateDir,{mode:0o700});mkdirSync(socketDir,{mode:0o750});chownSync(socketDir,0,executorGid);chmodSync(socketDir,0o750);
const socketPath=join(socketDir,'receipts.sock');
const client="const net=require('node:net');const socket=net.createConnection(process.argv[1]);socket.once('connect',()=>socket.write('next\\n'));socket.on('data',chunk=>process.stdout.write(chunk));socket.once('error',error=>{process.stderr.write(error.code);process.exitCode=23;});";
function requestAs(user){return new Promise((resolve,reject)=>{
 const child=spawn('/usr/sbin/runuser',['-u',user,'--','/opt/localai/node/bin/node','-e',client,socketPath],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
});}
let store,server;
try{
 const vault=initializeVault(join(stateDir,'master.key'),{encryptedStateExists:false});
 store=openStructuredJobStore(join(stateDir,'jobs.sqlite'),{vault});
 const job=store.enqueue({namespace:'user:proof',scope:'private',idempotencyKey:'native_receipt_12345',report:{document:{sha256:'a'.repeat(64)},units:[{text:'Private invoice INV-42',source:{kind:'text'}}]},schema:{schemaVersion:1,schemaId:'invoice',revision:1,schema:{type:'object',additionalProperties:false,properties:{invoice:{type:'string',format:'identifier'}},required:['invoice']}},expiresAt:Date.now()+60000});
 server=await createStructuredReceiptSocket({socketPath,executorGid,structuredStore:store,barrier:{isClear:()=>true}});
 const gateway=await requestAs('localai');assert.equal(gateway.code,23);assert.match(gateway.stderr,/EACCES/);assert.equal(gateway.stdout,'');
 const executor=await requestAs('nobody');assert.equal(executor.code,0,executor.stderr);
 const receipt=JSON.parse(executor.stdout).data;assert.deepEqual(receipt,{id:job.id,namespace:'user:proof',scope:'private',claimCapability:job.claimCapability});
 assert.equal(executor.stdout.includes('Private invoice'),false);
 process.stdout.write(JSON.stringify({gate:'native-structured-receipt-socket',gatewayDenied:true,executorReceivedOneReceipt:true,reportNotExposed:true,activated:false})+'\n');
}finally{if(server)await new Promise(resolve=>server.close(resolve));store?.close();rmSync(base,{recursive:true,force:true});}
