// Lo usa la tarea programada que resume el correo: cifra el resumen con la clave pública
// de la cuenta de servicio para que pase por GitHub (repositorio público) sin que nadie pueda leerlo.
// Uso: node cifrar.mjs resumen.json correo-publica.pem  → imprime el texto cifrado (base64)
import { readFileSync } from 'node:fs';
import { publicEncrypt, randomBytes, createCipheriv, constants } from 'node:crypto';

const [file, pem] = process.argv.slice(2);
const plain = readFileSync(file);
JSON.parse(plain); // falla aquí si el resumen no es JSON válido
const key = randomBytes(32), iv = randomBytes(12);
const c = createCipheriv('aes-256-gcm', key, iv);
const d = Buffer.concat([c.update(plain), c.final()]);
const k = publicEncrypt({ key: readFileSync(pem), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
const b = (x) => x.toString('base64');
process.stdout.write(Buffer.from(JSON.stringify({ k: b(k), iv: b(iv), t: b(c.getAuthTag()), d: b(d) })).toString('base64'));
