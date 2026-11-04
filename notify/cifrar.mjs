// Lo usa la tarea programada que resume el correo: cifra el resumen con la clave pública
// de la cuenta de servicio para que pase por GitHub (repositorio público) sin que nadie pueda leerlo.
// Uso: node cifrar.mjs resumen.json correo-publica.pem  → imprime el texto cifrado (base64)
import { readFileSync } from 'node:fs';
import { cerrar } from './caja.mjs';

const [file, pem] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, 'utf8')); // falla aquí si el resumen no es JSON válido
process.stdout.write(cerrar(data, readFileSync(pem)));
