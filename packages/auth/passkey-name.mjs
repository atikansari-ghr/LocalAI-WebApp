export function normalizePasskeyName(value=''){
 if(typeof value!=='string')throw new TypeError('Invalid passkey device name');
 const name=value.normalize('NFC').trim();
 if([...name].length>80||/[\p{Cc}\p{Cf}]/u.test(name))throw new TypeError('Invalid passkey device name');
 return name;
}
