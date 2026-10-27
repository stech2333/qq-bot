// Local privacy rules shared by QQ conversation memory and outgoing content.
export const SAFE_REPLY = '这是鲸的小秘密，不告诉你～';
export const TASK_REPLY = '后台的事情就不在群里展开啦。';

export function canonicalize(value) {
  let text = String(value ?? '').normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
  for (let i = 0; i < 3; i++) {
    const before = text
    text = text.replace(/\\u\{([\da-f]{1,6})\}|\\u([\da-f]{4})|\\x([\da-f]{2})/gi,
      (_, a, b, c) => String.fromCodePoint(Math.min(0x10ffff, parseInt(a || b || c, 16))))
      .replace(/&#(?:x([\da-f]+)|(\d+));?/gi, (_, a, b) => String.fromCodePoint(Math.min(0x10ffff, parseInt(a || b, a ? 16 : 10))))
      .replace(/&(?:bsol|sol|colon);/gi, (s) => ({ '&bsol;': '\\', '&sol;': '/', '&colon;': ':' })[s.toLowerCase()])
    try { text = decodeURIComponent(text) } catch { /* malformed escapes stay detectable */ }
    if (before === text) break
  }
  return text
}

const PATH = /(?:[a-z]\s*[:：]\s*[\\/]|\\\\|(?<!:)\/\/[\w.-]+\/|file\s*:\s*\/|(?:^|[\s"'`(=：:])\/(?:[\w.~-]+\/|[\w~-]+\.[\w]+\b|etc\b|home\b|root\b|tmp\b|var\b|opt\b|mnt\b)|~[\\/]|\$\{?(?:HOME|USERPROFILE|env:)|%(?:USERPROFILE|APPDATA|HOME)%)/i
const PRIVATE = /(?:\.env\b|[\w.-]+\.(?:log|sqlite\w*|db|ps1|ya?ml|jsonl|pem|key)\b|(?:cordis|config|package|settings|credentials|tasks)\.(?:json|yml|yaml)\b|BEGIN [A-Z ]*PRIVATE KEY|(?:api[_ -]?key|app[_ -]?secret|access[_ -]?token|authorization|password|QQBOT_SECRET)\s*[:=：]|Bearer\s+[\w.+/-]+|\bsk-[\w-]{12,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+|at\s+\S+\s+\([^\n]*:\d+:\d+\)|Traceback \(most recent|PS [A-Z]:|process\.env|Get-ChildItem|Get-Content|\$env:)/i
const INTERNAL = /(?:后台(?:任务|工作流|执行|操作|状态|记录)|内部(?:目录|文件|配置|服务|任务|系统提示|执行|存储)|(?:存储|保存|素材库|数据库|日志)(?:路径|目录|位置|结构)|(?:任务|待办|工作流)(?:列表|记录|详情)|(?:系统提示词|调试日志|错误堆栈|异常堆栈)|[a-z](?:盘|驱动器).*(?:用户|目录|文件夹)|用户(?:名)?目录.*(?:下面|里面)|[盘碟]符.*(?:反斜杠|冒号))/i
const INJECTION = /(?:忽略.{0,12}(?:指令|规则)|(?:system|developer)\s*:|<\/?(?:system|instruction)|执行.{0,10}(?:命令|代码)|你(?:必须|应该).{0,15}(?:泄露|读取|输出路径)|权限(?:提升|升级))/i

export class PrivacyGuard {
  constructor({ secrets = [], privateNames = [] } = {}) {
    this.secrets = new Set(secrets.filter((s) => typeof s === 'string' && s.length >= 6))
    this.privateNames = new Set(privateNames.filter((s) => typeof s === 'string' && s.length >= 2))
  }
  addSecret(value) { if (typeof value === 'string' && value.length >= 6) this.secrets.add(value) }
  inspect(value, { source = 'chat', peerKey, owner, visibility = 'conversation' } = {}) {
    if (['internal', 'tool-raw', 'debug', 'filesystem'].includes(source) || visibility === 'private' || (owner && owner !== peerKey)) {
      return { safe: false, reason: 'source' }
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
    if (text.length > 64000) return { safe: false, reason: 'size' }
    const normalized = canonicalize(text)
    const forms = [normalized, normalized.replace(/[\s`'"+|,，、\[\]{}]+/g, '')]
    // Encoded output is not useful ordinary chat; decode for detection, deny opaque blobs too.
    for (const token of normalized.match(/[A-Za-z0-9+/_=-]{12,}/g) ?? []) {
      try { forms.push(canonicalize(Buffer.from(token, 'base64').toString('utf8'))) } catch {}
      if (/^(?:[\da-f]{2}){6,}$/i.test(token)) forms.push(canonicalize(Buffer.from(token, 'hex').toString('utf8')))
      if (token.length >= 48) return { safe: false, reason: 'encoding' }
    }
    for (const form of forms) {
      if ([...this.secrets, ...this.privateNames].some((secret) => form.includes(secret) || form.replace(/\s/g, '').includes(secret))) return { safe: false, reason: 'credential' }
      if (PATH.test(form) || PRIVATE.test(form) || (source !== 'policy' && INTERNAL.test(form))) return { safe: false, reason: 'private-content' }
    }
    return { safe: true }
  }
  reference(value, metadata = {}) {
    return this.inspect(value, metadata).safe && !INJECTION.test(canonicalize(value)) ? String(value ?? '') : ''
  }
  requestRisk(text) {
    const s = canonicalize(text).replace(/\s/g, '')
    if (/(?:后台任务|任务列表|列出.*(?:任务|待办|工作流))/.test(s)) return 'task'
    if (/(?:读取|查看|列出|泄露|输出|告诉|打印|执行|运行|打开|扮演|假装|复述|编码|分段|拆开|翻译|还原|有哪些|放在哪|存在哪|保存在哪).{0,55}(?:本机|本地|文件|目录|路径|日志|配置|环境变量|密钥|凭证|token值|powershell|shell|命令|其他群|别的群|私聊|系统提示|用户目录|后台)|(?:文件|表情包|素材库|数据).{0,20}(?:放在哪里|存在哪里|在哪个目录|保存位置|保存路径)|(?:其他群|别的群|私聊).{0,20}(?:记忆|记录|聊过|说过)|(?:绕过|提升|升级).{0,12}权限/i.test(s)) return 'private'
    return null
  }
  output(text, { state, source = 'chat' } = {}) {
    const joined = `${state?.sentText ?? ''}${text}`
    if (!this.inspect(joined, { source }).safe || state?.risk) return state?.risk === 'task' ? TASK_REPLY : SAFE_REPLY
    return text
  }
}

