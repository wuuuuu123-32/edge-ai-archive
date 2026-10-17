/* AI 回答存档 —— Native Messaging host
 * 让扩展能在“服务没开”的时候一键把它拉起来（扩展自己不能启动本地进程）。
 *
 * 协议：stdin / stdout 上的 4 字节小端长度前缀 + UTF-8 JSON
 * 由 native-host.cmd 用 node 调起。
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const DEFAULT_PORT = 8765;

function reply(obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length, 0);
  process.stdout.write(Buffer.concat([len, buf]));
}

function portOpen(port, timeout = 700) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v) => {
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(v);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(timeout, () => done(false));
  });
}

async function handle(msg) {
  const port = Number(msg && msg.port) || DEFAULT_PORT;

  if (msg && msg.cmd === 'ping') {
    reply({ ok: true, running: await portOpen(port) });
    return;
  }

  if (msg && msg.cmd === 'start-server') {
    if (await portOpen(port)) {
      reply({ ok: true, started: false, running: true });
      return;
    }
    try {
      const child = spawn(process.execPath, [SERVER], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
    } catch (e) {
      reply({ ok: false, error: '启动失败：' + String((e && e.message) || e) });
      return;
    }
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await portOpen(port, 400)) {
        reply({ ok: true, started: true, running: true });
        return;
      }
    }
    reply({ ok: true, started: true, running: false, error: '进程起了但端口没通，检查 node 路径' });
    return;
  }

  reply({ ok: false, error: 'unknown cmd' });
}

let buf = Buffer.alloc(0);
let chain = Promise.resolve();

process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const raw = buf.subarray(4, 4 + len).toString('utf8');
    buf = buf.subarray(4 + len);
    chain = chain.then(() => {
      let msg = null;
      try { msg = JSON.parse(raw); } catch { /* ignore */ }
      return handle(msg);
    }).catch(() => { /* ignore */ });
  }
});

// 必须等所有消息都处理完再退出：Chrome 会在拿到回复后关掉管道，
// 如果此时处理还没结束，回复就丢了。
const bye = () => {
  chain.then(() => process.exit(0)).catch(() => process.exit(0));
};
process.stdin.on('end', bye);
process.stdin.on('error', bye);
