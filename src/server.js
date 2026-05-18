import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import { config, publicConfig } from './config.js';
import { getBatch, listBatches, listProjects, recoverInterruptedRuns, stats } from './db.js';
import { refinalizeBatch, startAnalysis } from './analyzer.js';

const publicDir = path.join(process.cwd(), 'public');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

async function handleApi(request, response, url) {
  const { pathname } = url;

  if (request.method === 'GET' && pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/config') {
    sendJson(response, 200, publicConfig());
    return;
  }

  if (request.method === 'GET' && pathname === '/api/stats') {
    sendJson(response, 200, stats());
    return;
  }

  if (request.method === 'GET' && pathname === '/api/batches') {
    sendJson(response, 200, { batches: listBatches() });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/projects') {
    sendJson(response, 200, { projects: listProjects() });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/open-x') {
    if (!isLocalRequest(request)) {
      sendJson(response, 403, { error: 'Only local requests can open external links' });
      return;
    }
    const body = await readJson(request);
    const handle = normalizeXHandle(body.handle);
    if (!handle) {
      sendJson(response, 400, { error: 'Invalid X handle' });
      return;
    }
    const url = `https://x.com/${handle}`;
    openExternalUrl(url);
    sendJson(response, 200, { ok: true, url });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/analyze') {
    const body = await readJson(request);
    const batch = startAnalysis({
      rawInput: body.rawInput,
      name: body.name,
      finalizer: body.finalizer,
      auditStage: body.auditStage
    });
    sendJson(response, 202, { batch });
    return;
  }

  const refinalizeMatch = pathname.match(/^\/api\/batches\/([^/]+)\/refinalize$/);
  if (request.method === 'POST' && refinalizeMatch) {
    const body = await readJson(request);
    const batch = refinalizeBatch(refinalizeMatch[1], {
      finalizer: body.finalizer,
      auditStage: body.auditStage
    });
    if (!batch) {
      sendJson(response, 404, { error: 'Batch not found' });
      return;
    }
    sendJson(response, 202, { batch });
    return;
  }

  const markdownMatch = pathname.match(/^\/api\/batches\/([^/]+)\/markdown$/);
  if (request.method === 'GET' && markdownMatch) {
    const batch = getBatch(markdownMatch[1]);
    if (!batch) {
      sendJson(response, 404, { error: 'Batch not found' });
      return;
    }
    const filename = `${batch.name.replace(/[^\w.-]+/g, '-') || batch.id}.md`;
    response.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    });
    response.end(batch.markdown || '# Report is not ready yet\n');
    return;
  }

  const batchMatch = pathname.match(/^\/api\/batches\/([^/]+)$/);
  if (request.method === 'GET' && batchMatch) {
    const batch = getBatch(batchMatch[1]);
    if (!batch) {
      sendJson(response, 404, { error: 'Batch not found' });
      return;
    }
    sendJson(response, 200, { batch });
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

function serveStatic(response, pathname) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(publicDir, `.${requestPath}`);
  if (!resolved.startsWith(publicDir)) {
    sendText(response, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    sendText(response, 404, 'Not found');
    return;
  }
  const ext = path.extname(resolved);
  response.writeHead(200, {
    'Content-Type': mimeTypes[ext] ?? 'application/octet-stream'
  });
  fs.createReadStream(resolved).pipe(response);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(text);
}

function normalizeXHandle(value) {
  const clean = String(value || '').trim().replace(/^@/, '');
  const match = clean.match(/^[A-Za-z0-9_]{1,20}$/);
  return match ? clean : '';
}

function isLocalRequest(request) {
  const address = request.socket.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

function openExternalUrl(url) {
  if (process.platform === 'win32') {
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    return;
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
}

server.listen(config.port, () => {
  const recovered = recoverInterruptedRuns();
  if (!process.argv.includes('--quiet')) {
    console.log(`Analyzer running at http://localhost:${config.port}`);
    console.log(`Mode: ${config.mockLLM ? 'mock' : 'real'} | Grok: ${config.xai.model} | GPT: ${config.gpt.model}`);
    if (recovered) console.log(`Recovered ${recovered} interrupted batch(es)`);
  }
});
