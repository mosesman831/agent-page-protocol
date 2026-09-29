import type { ToolEnvelope } from './core/types.js';

export function renderPretty(envelope: ToolEnvelope, noColor = false): string {
  const c = noColor
    ? { reset: '', bold: '', dim: '', red: '', green: '', yellow: '' }
    : {
        reset: '\x1b[0m',
        bold: '\x1b[1m',
        dim: '\x1b[2m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
      };

  if (envelope.status === 'hold' && envelope.hold) {
    const h = envelope.hold;
    const lines = [
      `${c.yellow}${c.bold}HOLD${c.reset}  kind=${h.kind}  session=${envelope.session ?? '-'}`,
      `  origin:     ${h.origin ?? '-'}`,
      `  action:     ${h.action}`,
      `  class:      ${h.side_effect ?? '-'} (${h.level ?? '-'})`,
    ];
    if (h.amount) {
      lines.push(
        `  amount:     ${h.amount.value} ${h.amount.unit ?? ''} (scale=${h.amount.scale ?? 0})`,
      );
    }
    lines.push(`  initiated:  agent-page-cli`);
    if (h.expires_at) lines.push(`  expires:    ${h.expires_at}`);
    lines.push('');
    if (h.body) lines.push(`  ${h.body}`);
    if (h.resume_hint) lines.push(`${c.dim}  resume: ${h.resume_hint}${c.reset}`);
    return lines.join('\n');
  }

  if (envelope.status === 'error' && envelope.error) {
    return `${c.red}ERROR${c.reset}  ${envelope.error.code}\n  ${envelope.error.message}`;
  }

  const statusColor = envelope.ok || envelope.status === 'async_pending' ? c.green : c.yellow;
  const lines: string[] = [
    `${statusColor}${envelope.status.toUpperCase()}${c.reset}  session=${envelope.session ?? 'null'}  cache=${envelope.meta?.cache ?? '-'}`,
  ];

  if (envelope.discovery) {
    const d = envelope.discovery;
    lines.push(`DISCOVER  ${d.origin}  supported=${d.supported}`);
    if (d.site_name) lines.push(`SITE   ${d.site_name}`);
    if (d.capabilities?.length) lines.push(`CAPS   ${d.capabilities.join(', ')}`);
    if (d.entry_urls) {
      for (const [k, v] of Object.entries(d.entry_urls)) {
        lines.push(`ENTRY  ${k}  ${v}`);
      }
    }
  }

  if (envelope.page) {
    lines.push(`PAGE  ${envelope.page.id}  ${envelope.page.version}`, `URL   ${envelope.page.url}`);
    if (envelope.page.title) lines.push(`TITLE ${envelope.page.title}`);
  }

  if (envelope.digest) {
    lines.push('', 'STATE');
    for (const [k, node] of Object.entries(envelope.digest.state ?? {})) {
      lines.push(`  ${k.padEnd(14)} ${formatNode(node)}`);
    }
    lines.push('', 'ACTIONS');
    for (const a of envelope.digest.actions ?? []) {
      lines.push(
        `  ${a.id}   ${a.kind}  ${a.side_effect}  auth=${a.auth}  [${Object.keys(a.input ?? {}).join(', ')}]`,
      );
    }
    if (envelope.digest.capabilities?.length) {
      lines.push('', `CAPS  ${envelope.digest.capabilities.join(', ')}`);
    }
  }

  if (envelope.act) {
    lines.push(
      '',
      `ACT   ${envelope.act.action}  mode=${envelope.act.mode}  ${envelope.act.base_version ?? '-'} -> ${envelope.act.result_version}`,
    );
  }

  if (envelope.watch) {
    lines.push(`WATCH transport=${envelope.watch.transport} changed=${envelope.watch.changed}`);
  }

  if (envelope.sessions) {
    lines.push('', 'SESSIONS');
    for (const s of envelope.sessions) {
      lines.push(`  ${s.id}  ${s.origin}  ${s.current_page_id ?? '-'}`);
    }
  }

  return lines.join('\n');
}

function formatNode(node: unknown): string {
  if (!node || typeof node !== 'object') return String(node);
  const n = node as {
    type?: string;
    value?: unknown;
    options?: string[];
    label?: string;
  };
  if (n.type === 'enum' && Array.isArray(n.options)) {
    return `${String(n.value)}   enum [${n.options.join(', ')}]`;
  }
  if (n.type === 'table') {
    const rows = Array.isArray(n.value) ? n.value.length : 0;
    return `table (${rows} rows)`;
  }
  if ('value' in n) return String(n.value);
  return JSON.stringify(n);
}

export const USAGE = `agent-page — Agent Page Protocol CLI (tool-contract 1.0)

Usage:
  agent-page [global-flags] <command> [args]

Commands:
  open <url>              Hydrate a page; print PageDigest
  act <action> [params]   Invoke an action on the current page
  confirm --approve|--reject
  challenge submit|abort  Complete MFA/OTP hold
  watch [--once]          Poll for page changes
  sessions list|show|switch|close|gc
  logout [origin] [--all]
  reset [--all]
  state [--path /state/key]
  actions                 List current page actions
  navigate <url>          Same-origin GET in current session
  discover <origin>       GET /.well-known/agent-page
  version                 Tool / protocol versions
  help [command]          This text

Global flags:
  --json / --pretty       Output mode (JSON default; last flag wins)
  --session <id>          Session id
  --home <dir>            State root ($AGENT_PAGE_HOME)
  --timeout-ms <n>        Request / async budget
  --top-k <n>             Digest truncation (default 8)
  --full / --raw          Fuller digests
  --policy-strict         Deny-before-POST
  --interactive           TTY prompts for holds
  --bearer-env NAME       Read bearer from env
  --cookie-jar PATH       Opt-in cookie jar

Holds exit 10-13 and never auto-approve. Mode B uuid-mode: is rejected locally.
`;
