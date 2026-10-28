// Descifra lo que cifra notify/cifrar.mjs (RSA-OAEP + AES-256-GCM) con la clave privada de la cuenta de servicio.
import { privateDecrypt, createDecipheriv, constants } from 'node:crypto';

export function abrir(raw, privateKey) {
  const box = JSON.parse(Buffer.from(raw, 'base64').toString());
  const b = (x) => Buffer.from(x, 'base64');
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, b(box.k));
  const dc = createDecipheriv('aes-256-gcm', key, b(box.iv));
  dc.setAuthTag(b(box.t));
  return JSON.parse(Buffer.concat([dc.update(b(box.d)), dc.final()]).toString());
}
