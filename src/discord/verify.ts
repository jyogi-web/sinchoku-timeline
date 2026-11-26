/**
 * Discord Interactions の署名検証
 *
 * Discord はスラッシュコマンドが実行されるたびに、このエンドポイントへ POST する。
 * 本物の Discord から来たかを、ヘッダーの Ed25519 署名とアプリの公開鍵で確かめる。
 * （検証しないエンドポイントは、Discord の Developer Portal で URL を登録するときに拒否される）
 */

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function verifyDiscordRequest(publicKeyHex: string, signatureHex: string | null, timestamp: string | null, body: string): Promise<boolean> {
  if (!signatureHex || !timestamp || !/^[0-9a-f]+$/i.test(signatureHex)) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hexToBytes(signatureHex), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}
