import {readFile} from 'node:fs/promises';
import {parseMsgDocument} from '../msg.mjs';
try{if(process.argv.length!==3)throw new Error();const result=parseMsgDocument({name:'input.msg',bytes:await readFile(process.argv[2])});process.stdout.write(JSON.stringify(result));}catch(error){const allowed=new Set(['invalid_msg','text_output_limit','msg_metadata_limit','msg_attachment_limit','msg_rtf_only_unsupported','msg_html_encoding_unsupported']);process.stdout.write(JSON.stringify({error:allowed.has(error.code)?error.code:'invalid_msg'}));process.exitCode=2;}
