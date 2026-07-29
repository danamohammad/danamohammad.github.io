/**
 * Generates copy-paste request snippets from endpoint definitions.
 * Pure string building at build time — the APIs page makes no network requests,
 * at build or at runtime.
 */

export interface Param {
  name: string;
  in: 'query' | 'body' | 'form' | 'path';
  type: string;
  required: boolean;
  description: string;
}

export interface Endpoint {
  method: string;
  path: string;
  summary: string;
  parameters?: Param[];
}

/** A representative value per declared type, so snippets are runnable-looking. */
function sample(p: Param): unknown {
  if (p.type === 'boolean') return true;
  if (p.type === 'integer') return 10;
  if (p.type === 'number') return 0.85;
  if (p.type.endsWith('[]')) return [`<${p.name}>`];
  if (p.type === 'object') return { field: '<value>' };
  if (p.type === 'file') return '<path/to/file>';
  return `<${p.name}>`;
}

function pathWithParams(ep: Endpoint): string {
  let path = ep.path;
  for (const p of ep.parameters ?? []) {
    if (p.in === 'path') path = path.replace(`{${p.name}}`, `<${p.name}>`);
  }
  const query = (ep.parameters ?? []).filter((p) => p.in === 'query' && p.required);
  if (query.length) path += '?' + query.map((p) => `${p.name}=${sample(p)}`).join('&');
  return path;
}

function bodyObject(ep: Endpoint): Record<string, unknown> | null {
  const body = (ep.parameters ?? []).filter((p) => p.in === 'body');
  if (!body.length) return null;
  return Object.fromEntries(body.filter((p) => p.required || body.length <= 4).map((p) => [p.name, sample(p)]));
}

function formFields(ep: Endpoint): Param[] {
  return (ep.parameters ?? []).filter((p) => p.in === 'form');
}

export function curlSnippet(ep: Endpoint, baseUrl: string, authHeader: string): string {
  const lines = [`curl -X ${ep.method} "${baseUrl}${pathWithParams(ep)}" \\`];
  const form = formFields(ep);
  const body = bodyObject(ep);

  if (body) lines.push(`  -H "Content-Type: application/json" \\`);
  lines.push(`  -H "${authHeader}: $API_KEY"${form.length || body ? ' \\' : ''}`);

  if (form.length) {
    form.forEach((p, i) => {
      const val = p.type === 'file' ? `@${sample(p)}` : sample(p);
      lines.push(`  -F "${p.name}=${val}"${i < form.length - 1 ? ' \\' : ''}`);
    });
  } else if (body) {
    lines.push(`  -d '${JSON.stringify(body, null, 2).split('\n').join('\n  ')}'`);
  }

  return lines.join('\n');
}

export function fetchSnippet(ep: Endpoint, baseUrl: string, authHeader: string): string {
  const body = bodyObject(ep);
  const form = formFields(ep);

  if (form.length) {
    const fd = form
      .map((p) =>
        p.type === 'file'
          ? `form.append(${JSON.stringify(p.name)}, fileInput.files[0]);`
          : `form.append(${JSON.stringify(p.name)}, ${JSON.stringify(String(sample(p)))});`
      )
      .join('\n');
    return `const form = new FormData();\n${fd}\n\nconst res = await fetch(${JSON.stringify(
      baseUrl + pathWithParams(ep)
    )}, {\n  method: ${JSON.stringify(ep.method)},\n  headers: { ${JSON.stringify(
      authHeader
    )}: process.env.API_KEY },\n  body: form,\n});\n\nconst data = await res.json();`;
  }

  const init = [
    `  method: ${JSON.stringify(ep.method)},`,
    `  headers: {\n    ${JSON.stringify(authHeader)}: process.env.API_KEY,${
      body ? `\n    "Content-Type": "application/json",` : ''
    }\n  },`,
    body ? `  body: JSON.stringify(${JSON.stringify(body, null, 2).split('\n').join('\n  ')}),` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `const res = await fetch(${JSON.stringify(
    baseUrl + pathWithParams(ep)
  )}, {\n${init}\n});\n\nconst data = await res.json();`;
}

export function pythonSnippet(ep: Endpoint, baseUrl: string, authHeader: string): string {
  const body = bodyObject(ep);
  const form = formFields(ep);
  const head = `import os, requests\n\nurl = ${JSON.stringify(baseUrl + pathWithParams(ep))}\nheaders = {${JSON.stringify(
    authHeader
  )}: os.environ["API_KEY"]}`;

  if (form.length) {
    const files = form.filter((p) => p.type === 'file');
    const data = form.filter((p) => p.type !== 'file');
    const parts = [head];
    if (files.length)
      parts.push(`files = {${files.map((p) => `${JSON.stringify(p.name)}: open("document.pdf", "rb")`).join(', ')}}`);
    if (data.length)
      parts.push(
        `data = {\n${data.map((p) => `    ${JSON.stringify(p.name)}: ${JSON.stringify(String(sample(p)))},`).join('\n')}\n}`
      );
    parts.push(
      `resp = requests.${ep.method.toLowerCase()}(url, headers=headers${files.length ? ', files=files' : ''}${
        data.length ? ', data=data' : ''
      })\nprint(resp.json())`
    );
    return parts.join('\n\n');
  }

  const py = body
    ? JSON.stringify(body, null, 4).replace(/": true/g, '": True').replace(/": false/g, '": False')
    : null;

  return [
    head,
    py ? `payload = ${py}` : null,
    `resp = requests.${ep.method.toLowerCase()}(url, headers=headers${py ? ', json=payload' : ''})\nprint(resp.json())`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
