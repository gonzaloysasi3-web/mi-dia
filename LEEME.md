# Mi día

Dashboard diario (tareas con hora y prioridad, citas, exámenes con cuenta atrás, vista semanal y hábitos). Es una PWA: una sola web que funciona en ordenador y móvil y se instala como app. No necesita compilar nada.

## Probar en local

```bash
python -m http.server 8080
```

Abre http://localhost:8080. Sin configurar nada, los datos se guardan solo en ese dispositivo.

## Publicarla gratis

Cualquier hosting estático gratuito sirve: Firebase Hosting (recomendado, porque encaja con la sincronización), GitHub Pages o Netlify. Hace falta HTTPS para instalarla en el móvil.

- Android (Chrome): menú ⋮ → "Instalar aplicación".
- iPhone (Safari): Compartir → "Añadir a pantalla de inicio".
- Ordenador (Chrome/Edge): icono de instalar en la barra de direcciones.

## Sincronizar móvil y ordenador (gratis)

Usa Firebase con el plan gratuito Spark (sin tarjeta). Cada persona entra con su cuenta de Google y solo ve sus datos.

1. Crea un proyecto en https://console.firebase.google.com (puedes desactivar Analytics).
2. En "Compilación → Authentication → Método de acceso" activa **Google**.
3. En "Compilación → Firestore Database" crea la base de datos en modo producción.
4. En la pestaña "Reglas" de Firestore pega esto y publica:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

5. En "Configuración del proyecto → Tus apps" añade una app web y copia el objeto `firebaseConfig`.
6. Pégalo en `firebase-config.js` (hay un ejemplo comentado).
7. En Authentication → Configuración → Dominios autorizados añade el dominio donde publiques la app.
8. Abre la app y pulsa el icono de la nube arriba a la derecha para iniciar sesión.

Si editas el mismo elemento en dos dispositivos sin conexión, gana el cambio más reciente. Los borrados se recuerdan 30 días para que se propaguen.

## Archivos

- `index.html`, `styles.css`, `app.js`: la aplicación.
- `sync.js`, `firebase-config.js`: sincronización opcional.
- `sw.js`, `manifest.webmanifest`, `icons/`: funcionamiento sin conexión e instalación.
