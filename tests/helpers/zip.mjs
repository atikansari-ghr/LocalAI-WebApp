// Deterministic small ZIP fixtures, including deliberately malformed metadata.
import {crc32,deflateRawSync} from 'node:zlib';
export function makeZip(items){
 const local=[],central=[];let offset=0;
 for(const item of items){
  const name=Buffer.from(item.name),bytes=Buffer.from(item.bytes??''),extra=Buffer.from(item.extra??[]),method=item.method??0,flags=item.flags??0x800,compressed=method===8?deflateRawSync(bytes):bytes,crc=item.crc??crc32(bytes),size=item.size??bytes.length;
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(flags,6);header.writeUInt16LE(method,8);
  if(!(flags&8)){header.writeUInt32LE(item.localCrc??crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(size,22);}header.writeUInt16LE(name.length,26);header.writeUInt16LE(extra.length,28);
  let descriptor=Buffer.alloc(0);if(flags&8){descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(compressed.length,8);descriptor.writeUInt32LE(size,12);}
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(0x314,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(flags,8);directory.writeUInt16LE(method,10);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(size,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(((item.mode??(item.name.endsWith('/')?0o40755:0o100644))<<16)>>>0,38);directory.writeUInt32LE(item.offset??offset,42);
  directory.writeUInt16LE(extra.length,30);local.push(header,name,extra,compressed,descriptor);central.push(directory,name,extra);offset+=header.length+name.length+extra.length+compressed.length+descriptor.length;
 }
 const table=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(items.length,8);end.writeUInt16LE(items.length,10);end.writeUInt32LE(table.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,table,end]);
}
