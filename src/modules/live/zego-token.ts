import { createCipheriv, randomBytes } from 'crypto';

/**
 * ZEGO Token04 generator (server-side only).
 * Based on https://github.com/ZEGOCLOUD/zego_server_assistant
 */
export function generateZegoToken04(
  appId: number,
  userId: string,
  secret: string,
  effectiveTimeInSeconds: number,
  payload = '',
): string {
  if (!appId || typeof appId !== 'number') {
    throw new Error('ZEGO appID invalid');
  }
  if (!userId || typeof userId !== 'string') {
    throw new Error('ZEGO userId invalid');
  }
  if (!secret || secret.length !== 32) {
    throw new Error('ZEGO ServerSecret must be a 32-byte string');
  }
  if (!effectiveTimeInSeconds || effectiveTimeInSeconds <= 0) {
    throw new Error('ZEGO token TTL invalid');
  }

  const createTime = Math.floor(Date.now() / 1000);
  const tokenInfo = {
    app_id: appId,
    user_id: userId,
    nonce: Math.ceil(Math.random() * 0xffffffff) - 0x80000000,
    ctime: createTime,
    expire: createTime + effectiveTimeInSeconds,
    payload: payload || '',
  };

  const iv = randomBytes(16);
  const key = Buffer.from(secret, 'utf8');
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(tokenInfo), 'utf8'),
    cipher.final(),
  ]);

  const expireBuf = Buffer.alloc(8);
  expireBuf.writeBigInt64BE(BigInt(tokenInfo.expire));
  const ivLenBuf = Buffer.alloc(2);
  ivLenBuf.writeUInt16BE(iv.length);
  const encLenBuf = Buffer.alloc(2);
  encLenBuf.writeUInt16BE(encrypted.length);

  const packed = Buffer.concat([expireBuf, ivLenBuf, iv, encLenBuf, encrypted]);
  return `04${packed.toString('base64')}`;
}
