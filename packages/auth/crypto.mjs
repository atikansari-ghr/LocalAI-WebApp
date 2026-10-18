import { randomBytes, scrypt, timingSafeEqual, createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, openSync, writeFileSync, closeSync, fsyncSync, lstatSync } from 'node:fs';
const derive=promisify(scrypt), parameters={N:32768,r:8,p:3,maxmem:64*1024**2};
export const newToken=()=>randomBytes(32).toString('base64url');
export const tokenDigest=value=>createHash('sha256').update(value).digest('hex');
export function equalSecret(a,b) {
  if(typeof a!=='string'||typeof b!=='string')return false;
  const left=Buffer.from(a),right=Buffer.from(b);
  return left.length===right.length&&timingSafeEqual(left,right);
}
function validPassword(value){return typeof value==='string'&&value.length>=12&&Buffer.byteLength(value)<=1024;}
export async function hashPassword(password) {
  if(!validPassword(password))throw new TypeError('Password must contain at least 12 characters and at most 1024 bytes');
  const salt=randomBytes(16),key=await derive(password,salt,64,parameters);
  return ['scrypt',32768,8,3,salt.toString('base64url'),key.toString('base64url')].join('$');
}
export async function verifyPassword(password,encoded) {
  if(typeof password!=='string'||Buffer.byteLength(password)>1024||typeof encoded!=='string')return false;
  const match=encoded.match(/^scrypt\$32768\$8\$3\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/);
  if(!match)return false;
  const salt=Buffer.from(match[1],'base64url'),expected=Buffer.from(match[2],'base64url');
  if(salt.length!==16||expected.length!==64)return false;
  return timingSafeEqual(await derive(password,salt,64,parameters),expected);
}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function decodeBase32(value){
  if(typeof value!=='string'||!/^[A-Z2-7]{16,128}$/.test(value))throw new TypeError('Invalid TOTP secret');
  let bits=0,buffer=0;const bytes=[];
  for(const c of value){buffer=(buffer<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bits-=8;bytes.push((buffer>>>bits)&255);buffer&=(1<<bits)-1;}}
  return Buffer.from(bytes);
}
export function newTotpSecret(){
  let bits=0,buffer=0,result='';
  for(const byte of randomBytes(20)){buffer=(buffer<<8)|byte;bits+=8;while(bits>=5){bits-=5;result+=alphabet[(buffer>>>bits)&31];}buffer&=(1<<bits)-1;}
  return result;
}
export function totp(secret,now=Date.now()){
  if(!Number.isFinite(now)||now<0)throw new TypeError('Invalid TOTP time');
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(now/30000)));
  const digest=createHmac('sha1',decodeBase32(secret)).update(counter).digest(),offset=digest[19]&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
export function verifyTotp(secret,code,now=Date.now(),lastCounter=-1) {
  if(typeof code!=='string'||!/^\d{6}$/.test(code)||!Number.isFinite(now)||now<0||!Number.isSafeInteger(lastCounter))return null;
  const current=Math.floor(now/30000);
  for(const counter of [current,current-1,current+1]){
    if(counter>=0&&counter>lastCounter&&equalSecret(totp(secret,counter*30000),code))return counter;
  }
  return null;
}
export function openVault(path) {
  try {
    const fd=openSync(path,'wx',0o600);
    try{writeFileSync(fd,randomBytes(32));fsyncSync(fd);}finally{closeSync(fd);}
  }catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=lstatSync(path);
  if(!stat.isFile()||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Vault key permissions are unsafe');
  const key=readFileSync(path);if(key.length!==32)throw new Error('Vault key is invalid; recovery is required');
  return {
    seal(value,purpose){
      if(typeof value!=='string'||typeof purpose!=='string'||!purpose)throw new TypeError('Vault value and purpose required');
      const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(purpose));
      const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
      return ['v1',nonce.toString('base64url'),ciphertext.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
    },
    open(envelope,purpose){
      if(typeof envelope!=='string'||envelope.length>1024*1024)throw new Error('Invalid vault envelope');
      const parts=envelope.split('.');
      if(parts.length!==4||parts[0]!=='v1'||typeof purpose!=='string'||!purpose)throw new Error('Invalid vault envelope');
      const nonce=Buffer.from(parts[1],'base64url'),tag=Buffer.from(parts[3],'base64url');
      if(nonce.length!==12||tag.length!==16)throw new Error('Invalid vault envelope');
      const decipher=createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(Buffer.from(purpose));decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(parts[2],'base64url')),decipher.final()]).toString('utf8');
    },
    csrf(token){return createHmac('sha256',key).update('csrf:'+token).digest('base64url');}
  };
}
