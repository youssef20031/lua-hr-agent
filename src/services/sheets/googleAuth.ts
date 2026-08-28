/**
 * Google service-account authentication, with no dependencies beyond Node
 * built-ins and `fetch`.
 *
 * The `googleapis` package would do this in one line, but it is a very large
 * dependency and the Lua tool runtime does not document which npm packages
 * survive bundling. Signing the JWT by hand is about eighty lines and removes
 * that risk entirely.
 *
 * Flow: build a JWT asserting "I am this service account and I want this
 * scope", sign it RS256 with the account's private key, exchange it at
 * Google's token endpoint for a bearer token, cache the token until shortly
 * before it expires.
 */
import { createSign } from 'node:crypto';

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  /** Always https://oauth2.googleapis.com/token in practice. */
  token_uri?: string;
  /** Optional; sent as the JWT `kid` so key rotation is unambiguous. */
  private_key_id?: string;
  project_id?: string;
}

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const SCOPE_SHEETS_RW = 'https://www.googleapis.com/auth/spreadsheets';
export const SCOPE_SHEETS_RO = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** Refresh this far ahead of real expiry, to absorb clock skew and flight time. */
const EXPIRY_SKEW_SECONDS = 120;

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input as never).toString('base64url');
}

/**
 * Repairs a PEM that has been through an environment variable.
 *
 * A private key stored in `.env` or a hosting dashboard arrives with literal
 * backslash-n two-character sequences instead of newlines, and OpenSSL then
 * refuses to parse it. This is the single most common reason a working
 * integration breaks on deployment, so it is handled explicitly rather than
 * left to bite later.
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();

  // Some secret managers keep the surrounding quotes.
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }

  key = key
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!key.includes('-----BEGIN')) {
    throw new Error(
      'GOOGLE private key does not look like PEM. Expected a "-----BEGIN PRIVATE KEY-----" block. ' +
        'If it came from an environment variable, check that newlines survived.',
    );
  }

  // OpenSSL wants a trailing newline after the footer.
  return `${key}\n`;
}

type EnvLike = Record<string, string | undefined>;

/**
 * Loads credentials from the environment, preferring the base64 form because
 * no newline can survive to be mangled in it.
 */
export function loadServiceAccount(env: EnvLike = process.env): ServiceAccountKey {
  let key: ServiceAccountKey;

  if (env.GOOGLE_SERVICE_ACCOUNT_B64) {
    key = JSON.parse(
      Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'),
    ) as ServiceAccountKey;
  } else if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccountKey;
  } else if (env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY) {
    key = {
      client_email: env.GOOGLE_CLIENT_EMAIL,
      private_key: env.GOOGLE_PRIVATE_KEY,
      private_key_id: env.GOOGLE_PRIVATE_KEY_ID,
      token_uri: env.GOOGLE_TOKEN_URI,
    };
  } else {
    throw new Error(
      'No Google service account credentials found. Set GOOGLE_SERVICE_ACCOUNT_B64 ' +
        '(base64 of the whole key.json, recommended), or GOOGLE_SERVICE_ACCOUNT_JSON, ' +
        'or GOOGLE_CLIENT_EMAIL together with GOOGLE_PRIVATE_KEY.',
    );
  }

  if (!key.client_email) throw new Error('Service account key is missing client_email.');
  if (!key.private_key) throw new Error('Service account key is missing private_key.');
  key.private_key = normalizePrivateKey(key.private_key);
  return key;
}

export function buildSignedJwt(
  key: ServiceAccountKey,
  scope: string,
  opts: { lifetimeSeconds?: number } = {},
): string {
  const aud = key.token_uri || DEFAULT_TOKEN_URI;
  const iat = Math.floor(Date.now() / 1000);
  // Google rejects any assertion valid for more than an hour.
  const lifetime = Math.min(opts.lifetimeSeconds ?? 3600, 3600);

  const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (key.private_key_id) header.kid = key.private_key_id;

  const claims = {
    iss: key.client_email,
    scope,
    aud,
    exp: iat + lifetime,
    iat,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();

  return `${signingInput}.${base64url(signer.sign(key.private_key))}`;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/** Keyed by account and scope so a scope change can never reuse a token. */
const tokenCache = new Map<string, CachedToken>();
/** De-dupes concurrent refreshes: fifty parallel calls mint one token, not fifty. */
const inFlight = new Map<string, Promise<string>>();

export async function getAccessToken(
  opts: { key?: ServiceAccountKey; scope?: string; forceRefresh?: boolean } = {},
): Promise<string> {
  const key = opts.key ?? loadServiceAccount();
  const scope = opts.scope ?? SCOPE_SHEETS_RW;
  const cacheKey = `${key.client_email}|${scope}`;

  if (!opts.forceRefresh) {
    const hit = tokenCache.get(cacheKey);
    if (hit && hit.expiresAtMs > Date.now()) return hit.accessToken;
    const pending = inFlight.get(cacheKey);
    if (pending) return pending;
  }

  const request = (async (): Promise<string> => {
    const tokenUri = key.token_uri || DEFAULT_TOKEN_URI;
    const body = new URLSearchParams({
      grant_type: JWT_BEARER_GRANT,
      assertion: buildSignedJwt(key, scope),
    });

    const res = await fetch(tokenUri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    const text = await res.text();
    if (!res.ok) {
      // The token endpoint uses the OAuth2 error shape, not the google.rpc one.
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { error?: string; error_description?: string };
        detail = `${parsed.error ?? res.status}: ${parsed.error_description ?? text}`;
      } catch {
        // Non-JSON body; the raw text is the best we have.
      }
      throw new GoogleAuthError(
        `Google token exchange failed (HTTP ${res.status}). ${detail}`,
        res.status,
        text,
      );
    }

    const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new GoogleAuthError('Token endpoint returned no access_token.', res.status, text);
    }

    const ttl = Math.max(0, (json.expires_in ?? 3600) - EXPIRY_SKEW_SECONDS);
    tokenCache.set(cacheKey, {
      accessToken: json.access_token,
      expiresAtMs: Date.now() + ttl * 1000,
    });
    return json.access_token;
  })();

  inFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/** Drops a cached token. Call once after a 401 before retrying. */
export function invalidateAccessToken(clientEmail: string, scope = SCOPE_SHEETS_RW): void {
  tokenCache.delete(`${clientEmail}|${scope}`);
}

/** Test seam: clears all cached tokens. */
export function resetTokenCache(): void {
  tokenCache.clear();
  inFlight.clear();
}
