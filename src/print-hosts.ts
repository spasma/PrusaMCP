import { createHash, randomBytes } from "node:crypto";

/**
 * Uploads to printers on the local network. Credentials come from the environment, never from
 * tool arguments, so they do not end up in a conversation transcript.
 *
 * PrusaLink (Buddy firmware: MK4/MK4S, CORE One, XL, MINI; or Prusa Link on a Raspberry Pi):
 *   PUT /api/v1/files/{storage}/{path}, headers Print-After-Upload / Overwrite-File (structured booleans ?1/?0).
 *   Auth: X-Api-Key, or HTTP Digest (user "maker" and the password shown on the printer).
 * OctoPrint: POST /api/files/local, multipart, X-Api-Key.
 */

export interface UploadRequest {
  fileName: string;
  data: Buffer;
  startPrint: boolean;
  overwrite: boolean;
}

export interface UploadResult {
  ok: boolean;
  status: number;
  message: string;
  storage?: string;
}

export interface PrusaLinkTarget {
  baseUrl: string;
  apiKey?: string;
  user?: string;
  password?: string;
  storage?: string;
}

export interface OctoPrintTarget {
  baseUrl: string;
  apiKey: string;
}

const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

// ─── Configuration ───────────────────────────────────────────

export function prusaLinkTargetFromEnv(env: NodeJS.ProcessEnv, urlOverride?: string): PrusaLinkTarget | string {
  const baseUrl = (urlOverride || env.PRUSALINK_URL || "").replace(/\/+$/, "");
  if (!baseUrl) return "Set PRUSALINK_URL (e.g. http://192.168.1.50) in the MCP server's env.";
  if (env.PRUSALINK_API_KEY) return { baseUrl, apiKey: env.PRUSALINK_API_KEY };
  if (env.PRUSALINK_PASSWORD) {
    return { baseUrl, user: env.PRUSALINK_USER || "maker", password: env.PRUSALINK_PASSWORD };
  }
  return "Set PRUSALINK_PASSWORD (and PRUSALINK_USER if it is not \"maker\"), or PRUSALINK_API_KEY, in the MCP server's env.";
}

export function octoPrintTargetFromEnv(env: NodeJS.ProcessEnv, urlOverride?: string): OctoPrintTarget | string {
  const baseUrl = (urlOverride || env.OCTOPRINT_URL || "").replace(/\/+$/, "");
  if (!baseUrl) return "Set OCTOPRINT_URL (e.g. http://octopi.local) in the MCP server's env.";
  if (!env.OCTOPRINT_API_KEY) return "Set OCTOPRINT_API_KEY in the MCP server's env.";
  return { baseUrl, apiKey: env.OCTOPRINT_API_KEY };
}

// ─── PrusaLink ───────────────────────────────────────────────

export async function uploadToPrusaLink(target: PrusaLinkTarget, req: UploadRequest): Promise<UploadResult> {
  const auth = new PrusaLinkAuth(target);
  const storage = target.storage ?? (await detectStorage(target.baseUrl, auth)) ?? "usb";
  const path = `/api/v1/files/${encodeURIComponent(storage)}/${encodePath(req.fileName)}`;

  const response = await auth.fetch(target.baseUrl, path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "Print-After-Upload": req.startPrint ? "?1" : "?0",
      "Overwrite-File": req.overwrite ? "?1" : "?0",
    },
    body: req.data,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });

  const ok = response.status >= 200 && response.status < 300;
  let message = ok ? "Uploaded." : await describeFailure(response);
  if (response.status === 409) message = "A file with this name already exists on the printer. Pass overwrite: true to replace it.";
  return { ok, status: response.status, message, storage };
}

/** The first writable storage the printer reports; null when the endpoint is missing or unreadable. */
async function detectStorage(baseUrl: string, auth: PrusaLinkAuth): Promise<string | null> {
  try {
    const response = await auth.fetch(baseUrl, "/api/v1/storage", { method: "GET", timeoutMs: REQUEST_TIMEOUT_MS });
    if (!response.ok) return null;
    const body = (await response.json()) as { storage_list?: Array<{ path?: string; name?: string; available?: boolean; read_only?: boolean }> };
    const usable = body.storage_list?.find((s) => s.available !== false && s.read_only !== true);
    const name = usable?.path?.replace(/^\/+/, "") || usable?.name;
    return name || null;
  } catch {
    return null;
  }
}

/** Sends requests with an API key, or with HTTP Digest after fetching a challenge. */
class PrusaLinkAuth {
  private challenge: DigestChallenge | null = null;
  private nonceCount = 0;

  constructor(private readonly target: PrusaLinkTarget) {}

  async fetch(
    baseUrl: string,
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: Buffer; timeoutMs: number },
  ): Promise<Response> {
    // A plain Uint8Array copy: fetch's BodyInit typing does not accept Node's Buffer.
    const body = init.body ? Uint8Array.from(init.body) : undefined;
    const send = (authorization?: string) =>
      fetch(baseUrl + path, {
        method: init.method,
        headers: {
          ...init.headers,
          ...(this.target.apiKey ? { "X-Api-Key": this.target.apiKey } : {}),
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body,
        signal: AbortSignal.timeout(init.timeoutMs),
      });

    if (this.target.apiKey) return send();

    // Digest: get a challenge with a cheap request first, so a large upload is sent only once.
    if (!this.challenge) await this.fetchChallenge(baseUrl);
    let response = await send(this.challenge ? this.authorization(init.method, path) : undefined);

    if (response.status === 401) {
      // Expired (stale) nonce, or the first challenge came from this response: answer it once.
      const challenge = parseDigestChallenge(response.headers.get("www-authenticate"));
      if (challenge) {
        this.challenge = challenge;
        this.nonceCount = 0;
        response = await send(this.authorization(init.method, path));
      }
    }
    return response;
  }

  private async fetchChallenge(baseUrl: string): Promise<void> {
    try {
      const response = await fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      this.challenge = parseDigestChallenge(response.headers.get("www-authenticate"));
    } catch {
      this.challenge = null;
    }
  }

  private authorization(method: string, uri: string): string {
    const c = this.challenge!;
    return digestAuthorization({
      ...c,
      method,
      uri,
      user: this.target.user ?? "maker",
      password: this.target.password ?? "",
      nonceCount: ++this.nonceCount,
      cnonce: randomBytes(8).toString("hex"),
    });
  }
}

// ─── HTTP Digest (RFC 7616, MD5) ─────────────────────────────

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

export function parseDigestChallenge(header: string | null): DigestChallenge | null {
  if (!header || !/^\s*Digest\s/i.test(header)) return null;
  const params: Record<string, string> = {};
  for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) {
    params[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  if (!params.nonce) return null;
  return {
    realm: params.realm ?? "",
    nonce: params.nonce,
    qop: params.qop,
    opaque: params.opaque,
    algorithm: params.algorithm,
  };
}

export function digestAuthorization(p: DigestChallenge & {
  method: string;
  uri: string;
  user: string;
  password: string;
  nonceCount: number;
  cnonce: string;
}): string {
  const md5 = (s: string) => createHash("md5").update(s).digest("hex");
  const ha1 = md5(`${p.user}:${p.realm}:${p.password}`);
  const ha2 = md5(`${p.method}:${p.uri}`);
  const useQop = p.qop?.split(",").map((q) => q.trim()).includes("auth");
  const nc = p.nonceCount.toString(16).padStart(8, "0");
  const response = useQop
    ? md5(`${ha1}:${p.nonce}:${nc}:${p.cnonce}:auth:${ha2}`)
    : md5(`${ha1}:${p.nonce}:${ha2}`);

  const fields = [
    `username="${p.user}"`,
    `realm="${p.realm}"`,
    `nonce="${p.nonce}"`,
    `uri="${p.uri}"`,
    `response="${response}"`,
    `algorithm=MD5`,
  ];
  if (useQop) fields.push(`qop=auth`, `nc=${nc}`, `cnonce="${p.cnonce}"`);
  if (p.opaque) fields.push(`opaque="${p.opaque}"`);
  return `Digest ${fields.join(", ")}`;
}

// ─── OctoPrint ───────────────────────────────────────────────

export async function uploadToOctoPrint(target: OctoPrintTarget, req: UploadRequest): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(req.data)]), req.fileName);
  if (req.startPrint) {
    form.append("select", "true");
    form.append("print", "true");
  }

  const response = await fetch(`${target.baseUrl}/api/files/local`, {
    method: "POST",
    headers: { "X-Api-Key": target.apiKey },
    body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });

  const ok = response.status >= 200 && response.status < 300;
  return { ok, status: response.status, message: ok ? "Uploaded." : await describeFailure(response) };
}

// ─── Helpers ─────────────────────────────────────────────────

/** Encodes each path segment; keeps the slashes of a subfolder path. */
function encodePath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

async function describeFailure(response: Response): Promise<string> {
  const body = (await response.text().catch(() => "")).trim().slice(0, 500);
  const hint =
    response.status === 401 ? " Check the credentials in the env (PRUSALINK_PASSWORD / PRUSALINK_API_KEY / OCTOPRINT_API_KEY)." :
    response.status === 404 ? " Wrong storage or URL?" : "";
  return `HTTP ${response.status}${body ? `: ${body}` : ""}.${hint}`;
}
