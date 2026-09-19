// Newline-delimited JSON-RPC 2.0 peer.
// Kept free of `vscode` imports so the smoke test can drive it under plain Node.

import { EventEmitter } from "events";
import { Readable, Writable } from "stream";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

interface RequestMessage {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Json;
}

interface ResponseMessage {
  jsonrpc: "2.0";
  id: number | string;
  result?: Json;
  error?: { code: number; message: string; data?: Json };
}

interface NotificationMessage {
  jsonrpc: "2.0";
  method: string;
  params?: Json;
}

export type IncomingHandler = (params: Json | undefined) => Promise<Json> | Json;
export type NotificationHandler = (params: Json | undefined) => void;

/**
 * A symmetric JSON-RPC endpoint: both sides can send requests,
 * responses and notifications. Messages are one JSON value per line.
 */
export class RpcPeer extends EventEmitter {
  private nextId = 1;
  private pending = new Map<
    number | string,
    { resolve: (v: Json) => void; reject: (e: Error) => void }
  >();
  private requestHandlers = new Map<string, IncomingHandler>();
  private notificationHandlers = new Map<string, NotificationHandler>();
  private buffer = "";

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly trace: (msg: string) => void = () => {},
  ) {
    super();
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => this.onData(chunk));
  }

  onRequest(method: string, handler: IncomingHandler): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  sendRequest(method: string, params?: Json): Promise<Json> {
    const id = this.nextId++;
    const msg: RequestMessage = { jsonrpc: "2.0", id, method, params };
    return new Promise<Json>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(msg);
    });
  }

  sendNotification(method: string, params?: Json): void {
    const msg: NotificationMessage = { jsonrpc: "2.0", method, params };
    this.write(msg);
  }

  private write(msg: object): void {
    const line = JSON.stringify(msg);
    this.trace(`-> ${line}`);
    this.output.write(line + "\n");
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length === 0) continue;
      this.trace(`<- ${line}`);
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        this.emit("parseError", line);
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: any): void {
    if (msg.id !== undefined && msg.method !== undefined) {
      this.handleIncomingRequest(msg as RequestMessage);
    } else if (msg.id !== undefined) {
      this.handleResponse(msg as ResponseMessage);
    } else if (msg.method !== undefined) {
      const h = this.notificationHandlers.get(msg.method);
      if (h) h(msg.params);
      else this.emit("unhandledNotification", msg);
    }
  }

  private async handleIncomingRequest(msg: RequestMessage): Promise<void> {
    const handler = this.requestHandlers.get(msg.method);
    let response: ResponseMessage;
    if (!handler) {
      response = {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      };
    } else {
      try {
        const result = await handler(msg.params);
        response = { jsonrpc: "2.0", id: msg.id, result: result ?? null };
      } catch (e: any) {
        response = {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32603, message: String(e?.message ?? e) },
        };
      }
    }
    this.write(response);
  }

  private handleResponse(msg: ResponseMessage): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result ?? null);
  }
}
