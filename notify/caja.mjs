// Cifrado híbrido RSA-OAEP + AES-256-GCM. Con la clave pública de la cuenta de servicio se cifra lo que
// entra por GitHub (repositorio público); con una clave temporal de Claude, lo que sale (exportar.mjs).
import { privateDecrypt, publicEncrypt, createDecipheriv, createCipheriv, randomBytes, constants } from 'node:crypto';

const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };

export function cerrar(obj, publicKey) {
  const plain = Buffer.from(JSON.stringify(obj));
  const key = randomBytes(32), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const d = Buffer.concat([c.update(plain), c.final()]);
  const k = publicEncrypt({ key: publicKey, ...OAEP }, key);
  const b = (x) => x.toString('base64');
  return Buffer.from(JSON.stringify({ k: b(k), iv: b(iv), t: b(c.getAuthTag()), d: b(d) })).toString('base64');
}

export function abrir(raw, privateKey) {
  const box = JSON.parse(Buffer.from(raw, 'base64').toString());
  const b = (x) => Buffer.from(x, 'base64');
  const key = privateDecrypt({ key: privateKey, ...OAEP }, b(box.k));
  const dc = createDecipheriv('aes-256-gcm', key, b(box.iv));
  dc.setAuthTag(b(box.t));
  return JSON.parse(Buffer.concat([dc.update(b(box.d)), dc.final()]).toString());
}
