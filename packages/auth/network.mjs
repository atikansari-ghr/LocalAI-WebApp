import { BlockList, isIP } from 'node:net';
function normalize(ip){
 if(typeof ip!=='string'||!isIP(ip))throw new TypeError('Invalid IP address');
 return ip.toLowerCase().startsWith('::ffff:')&&isIP(ip.slice(7))===4?ip.slice(7):ip;
}
export function matchesNetwork(ip,networks){
 ip=normalize(ip);
 if(!Array.isArray(networks)||networks.length>100)throw new TypeError('Invalid network policy');
 const block=new BlockList();
 for(const network of networks){
  if(typeof network!=='string')throw new TypeError('Invalid network');
  const parts=network.split('/'),address=normalize(parts[0]),version=isIP(address),family=version===4?'ipv4':'ipv6';
  if(parts.length===1)block.addAddress(address,family);
  else {
   if(parts.length!==2||!/^(0|[1-9]\d*)$/.test(parts[1])||Number(parts[1])>(version===4?32:128))throw new TypeError('Invalid subnet prefix');
   block.addSubnet(address,Number(parts[1]),family);
  }
 }
 return block.check(ip,isIP(ip)===4?'ipv4':'ipv6');
}
export function resolveClientIp(remote,forwarded,trusted=[]){
 remote=normalize(remote);
 if(!matchesNetwork(remote,trusted)||forwarded===undefined||forwarded===null)return remote;
 if(typeof forwarded!=='string'||forwarded.length>2048)throw new TypeError('Invalid forwarding chain');
 const chain=forwarded.split(',').map(ip=>normalize(ip.trim()));
 if(!chain.length||chain.length>20)throw new TypeError('Invalid forwarding chain');
 chain.push(remote);
 for(let i=chain.length-1;i>=0;i--)if(!matchesNetwork(chain[i],trusted))return chain[i];
 return chain[0];
}
