import {createHash} from 'node:crypto';
import {constants,createReadStream,closeSync,fstatSync,lstatSync,openSync,readlinkSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';

const LIMITS=Object.freeze({entries:100000,bytes:10*1024**3,findings:4096,path:1024});
const stable=(before,after)=>before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.mode===after.mode&&before.uid===after.uid&&before.gid===after.gid;
const licenseName=name=>/^(?:licen[sc]e|copying|notice)(?:[._-].*)?$/i.test(name);
const outside=(root,path)=>{const rel=relative(root,path);return rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel);};
const number=value=>Number(value);

// Read-only observational evidence, not an atomic snapshot or release qualification.
// Linux path descent is anchored to open directory descriptors and never follows an
// entry symlink. A changing tree fails where detectable; qualification needs a
// frozen candidate tree or a filesystem snapshot.
export async function inventoryDocumentCohortTree(root){
 if(typeof root!=='string'||!isAbsolute(root))throw new TypeError('invalid_document_cohort_root');
 const base=resolve(root),linux=process.platform==='linux',flags=constants.O_RDONLY|(linux?(constants.O_DIRECTORY|constants.O_NOFOLLOW):0);
 const digest=createHash('sha256'),licensePaths=[],externalSymlinks=[],unsafeModePaths=[],nonRootPaths=[];
 let files=0,symlinks=0,bytes=0,entries=0;
 const record=value=>digest.update(JSON.stringify(value)+'\n');
 const append=(array,value)=>{if(array.length>=LIMITS.findings)throw new Error('document_cohort_inventory_limit');array.push(value);};
 const assess=(rel,stat)=>{
  const mode=number(stat.mode&0o777n);
  if((mode&0o022)!==0)append(unsafeModePaths,rel);
  if(linux&&stat.uid!==0n)append(nonRootPaths,rel);
  return mode;
 };
 function linkEscapes(full,target){
  const lexical=resolve(dirname(full),target);
  if(outside(base,lexical))return true;
  try{return outside(base,realpathSync(full));}catch{return false;}
 }
 async function visit(directory,relativeDir=''){
  const directoryFd=openSync(directory,flags);
  try{
   const directoryPath=linux?`/proc/self/fd/${directoryFd}`:directory;
   for(const name of readdirSync(directoryPath).sort()){
    const full=join(directoryPath,name),rel=relativeDir?relativeDir+'/'+name:name;
    if(++entries>LIMITS.entries||Buffer.byteLength(rel)>LIMITS.path)throw new Error('document_cohort_inventory_limit');
    const stat=lstatSync(full,{bigint:true}),mode=number(stat.mode&0o777n),uid=number(stat.uid),gid=number(stat.gid);
    if(stat.isSymbolicLink()){
     symlinks++;const target=readlinkSync(full);
     if(!stable(stat,lstatSync(full,{bigint:true})))throw new Error('document_cohort_changed_during_inventory');
     if(linkEscapes(join(base,rel),target))append(externalSymlinks,rel);
     record([rel,'link',target,uid,gid]);continue;
    }
    assess(rel,stat);
    if(stat.isDirectory()){
     record([rel,'dir',mode,uid,gid]);
     await visit(full,rel);
     if(!stable(stat,lstatSync(full,{bigint:true})))throw new Error('document_cohort_changed_during_inventory');
     continue;
    }
    if(!stat.isFile())throw new Error('unsupported_document_cohort_entry');
    files++;const size=number(stat.size);
    if(!Number.isSafeInteger(size)||bytes+size>LIMITS.bytes)throw new Error('document_cohort_inventory_limit');bytes+=size;
    const fd=openSync(full,constants.O_RDONLY|(linux?constants.O_NOFOLLOW:0));
    let content;
    try{
     if(!stable(stat,fstatSync(fd,{bigint:true})))throw new Error('document_cohort_changed_during_inventory');
     content=createHash('sha256');
     for await(const chunk of createReadStream(null,{fd,autoClose:false}))content.update(chunk);
     if(!stable(stat,fstatSync(fd,{bigint:true})))throw new Error('document_cohort_changed_during_inventory');
    }finally{closeSync(fd);}
    record([rel,'file',mode,uid,gid,size,content.digest('hex')]);
    if(licenseName(name))append(licensePaths,rel);
   }
  }finally{closeSync(directoryFd);}
 }
 const rootStat=lstatSync(base,{bigint:true});
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error('unsafe_document_cohort_root');
 const rootMode=assess('.',rootStat);record(['.','dir',rootMode,number(rootStat.uid),number(rootStat.gid)]);
 await visit(base);
 if(!stable(rootStat,lstatSync(base,{bigint:true})))throw new Error('document_cohort_changed_during_inventory');
 return Object.freeze({version:1,files,symlinks,bytes,entries,unsafeModes:unsafeModePaths.length,unsafeModePaths,nonRootEntries:nonRootPaths.length,nonRootPaths,treeSha256:digest.digest('hex'),licensePaths,externalSymlinks});
}
