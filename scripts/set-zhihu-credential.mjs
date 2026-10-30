// Local administrator utility: credential input via stdin only, never argv or logs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'integrations/qq-bridge/package.json')),YAML=require('js-yaml');
export function saveZhihuCredential(value,file=path.join(root,'data-bridge/.credentials.yaml')) {
  const secret=String(value||'').trim();if(!secret||secret.length>4096||/[\r\n\u0000]/.test(secret))throw Error('密钥为空或格式无效');
  let data={};if(fs.existsSync(file))data=YAML.load(fs.readFileSync(file,'utf8'))||{};
  if(typeof data!=='object'||Array.isArray(data)||data.refs!==undefined&&(typeof data.refs!=='object'||!data.refs||Array.isArray(data.refs)))throw Error('现有凭据存储格式异常，未覆盖');
  const next={...data,refs:{...data.refs,QQ_COMMUNITY_ZHIHU_ACCESS_SECRET:secret}};
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file))fs.copyFileSync(file,file+'.backup-zhihu-'+Date.now()+'-'+randomUUID(),fs.constants.COPYFILE_EXCL);
  const tmp=file+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,YAML.dump(next,{noRefs:true,lineWidth:-1}),{mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  return {saved:true,credentialRef:'QQ_COMMUNITY_ZHIHU_ACCESS_SECRET'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>8192)throw Error('输入过长');}
    saveZhihuCredential(input);input='';process.stdout.write('已保存知乎凭据引用；无需重启 Bridge。\n');
  }catch{process.stderr.write('凭据保存未完成，请检查输入及本机存储权限。\n');process.exitCode=1;}
}
