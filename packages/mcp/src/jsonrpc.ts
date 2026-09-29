/**
 * Minimal JSON-RPC 2.0 helpers + MCP stdio Content-Length framing.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: string | number | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export function rpcSuccess(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  const error: JsonRpcErrorObject = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

export function isNotification(msg: JsonRpcRequest): boolean {
  return msg.id === undefined;
}

/** Encode a JSON-RPC message with MCP/LSP Content-Length framing. */
export function encodeMessage(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  return Buffer.concat([header, body]);
}

/**
 * Incremental Content-Length frame parser.
 * Also accepts newline-delimited JSON for simple test harnesses.
 */
export class MessageParser {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];

    while (this.buffer.length > 0) {
      const headerEnd = indexOfHeaderEnd(this.buffer);
      if (headerEnd >= 0) {
        const header = this.buffer.subarray(0, headerEnd).toString('utf8');
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          this.buffer = this.buffer.subarray(headerEnd + 4);
          continue;
        }
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (this.buffer.length < bodyStart + length) {
          break;
        }
        const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
        this.buffer = this.buffer.subarray(bodyStart + length);
        messages.push(JSON.parse(body));
        continue;
      }

      // Fallback: newline-delimited JSON (test helper)
      const nl = this.buffer.indexOf(0x0a);
      if (nl < 0) break;
      const line = this.buffer.subarray(0, nl).toString('utf8').trim();
      this.buffer = this.buffer.subarray(nl + 1);
      if (!line || line.startsWith('Content-Length')) continue;
      messages.push(JSON.parse(line));
    }

    return messages;
  }
}

function indexOfHeaderEnd(buf: Buffer): number {
  const crlf = buf.indexOf('\r\n\r\n');
  if (crlf >= 0) return crlf;
  return -1;
}
