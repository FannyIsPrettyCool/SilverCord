import { errors, jwtVerify, SignJWT } from 'jose';
import { AppError } from '../../../http/app-error.ts';

export const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
export const MFA_TICKET_TTL_SECONDS = 5 * 60;
const ISSUER = 'silvercord';
const CLOCK_TOLERANCE_SECONDS = 30;

export interface AccessClaims {
  readonly userId: bigint;
  readonly sessionId: bigint;
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface TokenIssuer {
  issueAccessToken(claims: AccessClaims): Promise<IssuedAccessToken>;
  verifyAccessToken(token: string): Promise<AccessClaims>;
  issueMfaTicket(userId: bigint): Promise<string>;
  verifyMfaTicket(ticket: string): Promise<bigint>;
}

function parseId(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value)) {
    throw new AppError('TOKEN_INVALID', 'Invalid token');
  }
  return BigInt(value);
}

function mapJoseError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (error instanceof errors.JWTExpired) throw new AppError('TOKEN_EXPIRED', 'Token expired');
  throw new AppError('TOKEN_INVALID', 'Invalid token');
}

/** HS256 JWTs (threat model §Phase 1 decisions). Access and MFA tokens use distinct `typ`. */
export function createTokenIssuer(secret: string, now: () => Date = () => new Date()): TokenIssuer {
  const key = new TextEncoder().encode(secret);

  async function sign(payload: Record<string, string>, subject: string, typ: string, ttl: number) {
    const issuedAt = Math.floor(now().getTime() / 1000);
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ })
      .setIssuer(ISSUER)
      .setSubject(subject)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ttl)
      .sign(key);
    return { token, expiresAt: new Date((issuedAt + ttl) * 1000) };
  }

  async function verify(token: string, typ: string) {
    try {
      const { payload } = await jwtVerify(token, key, {
        issuer: ISSUER,
        typ,
        algorithms: ['HS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: now(),
      });
      return payload;
    } catch (error) {
      return mapJoseError(error);
    }
  }

  return {
    issueAccessToken: ({ userId, sessionId }) =>
      sign({ sid: sessionId.toString() }, userId.toString(), 'at+jwt', ACCESS_TOKEN_TTL_SECONDS),
    async verifyAccessToken(token) {
      const payload = await verify(token, 'at+jwt');
      return { userId: parseId(payload.sub), sessionId: parseId(payload['sid']) };
    },
    async issueMfaTicket(userId) {
      return (await sign({}, userId.toString(), 'mfa+jwt', MFA_TICKET_TTL_SECONDS)).token;
    },
    async verifyMfaTicket(ticket) {
      return parseId((await verify(ticket, 'mfa+jwt')).sub);
    },
  };
}
