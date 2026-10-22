import {DocumentError} from './validation.mjs';
// Structural/script signals are not an estimate of recognition accuracy.
export function evaluateOcrText(text,{language='auto',minCharacters=3}={}){
 if(typeof text!=='string'||!['auto','en','ar'].includes(language)||!Number.isSafeInteger(minCharacters)||minCharacters<1||minCharacters>100)throw new DocumentError('invalid_ocr_quality_options');
 const characters=[...text.trim()],letters=characters.filter(c=>/[\p{L}\p{N}]/u.test(c)),arabic=letters.filter(c=>/\p{Script=Arabic}/u.test(c)).length,latin=letters.filter(c=>/\p{Script=Latin}/u.test(c)).length;
 const reasons=[];if(letters.length<minCharacters)reasons.push('insufficient_text');if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/u.test(text))reasons.push('corrupt_characters');if(language==='ar'&&arabic<minCharacters)reasons.push('expected_arabic_script_missing');if(language==='en'&&latin<minCharacters)reasons.push('expected_latin_script_missing');
 return Object.freeze({acceptable:reasons.length===0,accuracyVerified:false,reasons:Object.freeze(reasons),signals:Object.freeze({characters:characters.length,letters:letters.length,arabic,latin})});
}
