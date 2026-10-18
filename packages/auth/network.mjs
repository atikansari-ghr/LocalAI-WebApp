import { BlockList, isIP } from 'node:net';
export function normalizeIp(ip){
 if(typeof ip!=='string'||!isIP(ip))throw new TypeError('Invalid IP address');
 if(isIP(ip)===4)return ip;
 const canonical=new URL('http://['+ip+']').hostname.slice(1,-1),mapped=canonical.match(/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/);
 if(mapped){const high=parseInt(mapped[1],16),low=parseInt(mapped[2],16);return [high>>>8,high&255,low>>>8,low&255].join('.');}
 return canonical;
}
export function matchesNetwork(ip,networks){
 ip=normalizeIp(ip);
 if(!Array.isArray(networks)||networks.length>100)throw new TypeError('Invalid network policy');
 const block=new BlockList();
 for(const network of networks){
  if(typeof network!=='string')throw new TypeError('Invalid network');
  const parts=network.split('/'),address=normalizeIp(parts[0]),version=isIP(address),family=version===4?'ipv4':'ipv6';
  if(parts.length===1)block.addAddress(address,family);
  else {
   if(parts.length!==2||!/^(0|[1-9]\d*)$/.test(parts[1])||Number(parts[1])>(version===4?32:128))throw new TypeError('Invalid subnet prefix');
   block.addSubnet(address,Number(parts[1]),family);
  }
 }
 return block.check(ip,isIP(ip)===4?'ipv4':'ipv6');
}
export function resolveClientIp(remote,forwarded,trusted=[]){
 remote=normalizeIp(remote);
 if(!matchesNetwork(remote,trusted)||forwarded===undefined||forwarded===null)return remote;
 if(typeof forwarded!=='string'||forwarded.length>2048)throw new TypeError('Invalid forwarding chain');
 const chain=forwarded.split(',').map(ip=>normalizeIp(ip.trim()));
 if(!chain.length||chain.length>20)throw new TypeError('Invalid forwarding chain');
 chain.push(remote);
 for(let i=chain.length-1;i>=0;i--)if(!matchesNetwork(chain[i],trusted))return chain[i];
 return chain[0];
}
