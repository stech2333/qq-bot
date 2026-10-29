import dns from 'node:dns';
import net from 'node:net';
import { isPrivateIp, resolveSafeAddresses } from '../../integrations/qq-bridge/src/safe-fetch.js';

// Campus split DNS can publish both RFC1918 IPv4 and globally routed IPv6.
// Only this administrator-configured provider may discard private answers; none
// of those answers is ever returned to the transport. General web SSRF policy is unchanged.
export async function resolveModelAddresses(hostname, { lookup = dns.promises.lookup, resolve = resolveSafeAddresses } = {}) {
  if (hostname !== 'token.nuaa.edu.cn') return resolve(hostname);
  let timer;
  try {
    const rows = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('校园模型 DNS 解析超时')), 5000); }),
    ]);
    const addresses = [...new Set(rows.map(row => row.address).filter(address => !isPrivateIp(address)))];
    if (!addresses.length) throw Error('校园模型未解析到公网地址，已阻止内网连接');
    return addresses;
  } finally { clearTimeout(timer); }
}

// Node/undici lookup contract, including Happy Eyeballs' `all` form. Returning
// validated literals pins the connection without changing Host or TLS SNI.
export function modelLookup(hostname, options, callback) {
  resolveModelAddresses(hostname).then(addresses => {
    const rows = addresses.map(address => ({ address, family: net.isIP(address) }));
    callback(null, options?.all ? rows : rows[0].address, rows[0].family);
  }, error => callback(error));
}

// Only the fixed campus API origin uses this transport. It cannot become a
// general proxy, fetch tool, alternative hostname, redirect, or private-IP tunnel.
export function createDirectModelFetch(originalFetch, dispatcher, campusFetch = originalFetch) {
  return (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname !== 'token.nuaa.edu.cn') return originalFetch(input, options);
    const method = String(options?.method || input?.method || 'GET').toUpperCase();
    if (url.origin !== 'https://token.nuaa.edu.cn' || url.username || url.password || url.search || url.hash ||
        !(method === 'POST' && url.pathname === '/v1/chat/completions' || method === 'GET' && url.pathname === '/v1/models')) {
      return Promise.reject(Error('校园模型只允许标准 HTTPS 模型列表及 Chat Completions 操作'));
    }
    const requestOptions = typeof input === 'string' || input instanceof URL ? options : {
      method: input.method, headers: input.headers, body: input.body, signal: input.signal,
      ...(input.body ? { duplex: 'half' } : {}), ...options,
    };
    return campusFetch(url, { ...requestOptions, dispatcher, redirect: 'error' });
  };
}
