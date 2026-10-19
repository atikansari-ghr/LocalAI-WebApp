import {spawn} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {DocumentError} from './validation.mjs';
const fail=code=>{throw new DocumentError(code);};
export async function runDocumentTool(command,args,options={}){
 if(typeof command!=='string'||!isAbsolute(command)||!Array.isArray(args)||args.some(v=>typeof v!=='string'||v.includes('\0')))fail('invalid_document_tool');
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['signal','cwd','env','timeoutMs','maxStdoutBytes','maxStderrBytes'].includes(k)))fail('invalid_document_tool_options');
 const timeoutMs=options.timeoutMs??10000,maxStdoutBytes=options.maxStdoutBytes??1024**2,maxStderrBytes=options.maxStderrBytes??65536;
 for(const [value,max]of [[timeoutMs,30000],[maxStdoutBytes,20*1024**2],[maxStderrBytes,1024**2]])if(!Number.isSafeInteger(value)||value<1||value>max)fail('invalid_document_tool_limits');
 if(options.signal!==undefined&&!(options.signal instanceof AbortSignal))fail('invalid_document_tool_signal');if(options.signal?.aborted)fail('document_tool_cancelled');
 return new Promise((resolve,reject)=>{
  let child;try{child=spawn(command,args,{cwd:options.cwd,env:options.env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});}catch{reject(new DocumentError('document_tool_spawn_failed'));return;}
  const stdout=[],stderr=[];let outBytes=0,errBytes=0,failure;
  const kill=()=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}};
  const stop=code=>{failure??=code;kill();},abort=()=>stop('document_tool_cancelled');
  const timer=setTimeout(()=>stop('document_tool_timeout'),timeoutMs);timer.unref();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
  child.stdout.on('data',chunk=>{outBytes+=chunk.length;if(outBytes>maxStdoutBytes)stop('document_tool_output_limit');else if(!failure)stdout.push(chunk);});
  child.stderr.on('data',chunk=>{errBytes+=chunk.length;if(errBytes>maxStderrBytes)stop('document_tool_output_limit');else if(!failure)stderr.push(chunk);});
  child.on('error',()=>stop('document_tool_spawn_failed'));
  child.on('close',(code,signal)=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);kill();if(failure)reject(new DocumentError(failure));else resolve({code,signal,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)});});
 });
}
