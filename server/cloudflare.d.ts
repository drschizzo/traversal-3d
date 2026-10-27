// Types de l'environnement Cloudflare, réduits à ce que worker.js utilise : `npm run typecheck` contrôle le
// serveur sans les ~16 000 lignes de `wrangler types` (dont les globales entreraient en conflit avec le DOM du jeu).
// À compléter quand worker.js se sert d'une nouvelle API.

/** WebSocket côté serveur : celle du DOM, plus la pièce jointe qui survit à l'hibernation. */
interface CfWebSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): any;
}

interface SqlCursor<T = Record<string, any>> {
  toArray(): T[];
  one(): T;
}

interface DurableObjectState {
  storage: {
    sql: { exec<T = Record<string, any>>(query: string, ...bindings: unknown[]): SqlCursor<T> };
    setAlarm(time: number): Promise<void>;
    deleteAlarm(): Promise<void>;
    deleteAll(): Promise<void>;
  };
  acceptWebSocket(ws: CfWebSocket): void;
  getWebSockets(): CfWebSocket[];
  setWebSocketAutoResponse(pair: WebSocketRequestResponsePair): void;
}

interface DurableObjectStub<T> {
  fetch(request: Request): Promise<Response>;
  create: T extends { create(...args: infer A): infer R } ? (...args: A) => R : never;
}

interface DurableObjectNamespace<T = any> {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub<T>;
}

interface Env {
  ROOMS: DurableObjectNamespace<import('./worker.js').Room>;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

declare class WebSocketPair {
  0: CfWebSocket;
  1: CfWebSocket;
}

declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string);
}

// une réponse 101 remet la WebSocket du client au runtime
interface ResponseInit {
  webSocket?: CfWebSocket;
}

declare module 'cloudflare:workers' {
  export class DurableObject {
    constructor(ctx: DurableObjectState, env: Env);
    ctx: DurableObjectState;
    env: Env;
  }
}
