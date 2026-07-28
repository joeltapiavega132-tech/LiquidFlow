# Poner a funcionar el Arduino con la interfaz

Son 3 partes: subir el programa al Arduino, prender el backend en Python, y prender la interfaz. Los tres deben quedar corriendo **al mismo tiempo**.

---

## Antes de empezar

Necesitas tener instalado:
- **Arduino IDE** (para subir el sketch al Arduino)
- **Python** (para correr el backend)
- **Node.js** (para correr la interfaz)

Y necesitas 3 archivos que te voy a pasar:
por github ya en un repositorio solo para clonar 
---

## Paso 1 — Subir el programa al Arduino

1. Abre `Dosificador.ino` en el Arduino IDE.
2. Conecta el Arduino por USB a la computadora.
3. En **Herramientas > Puerto**, elige el puerto donde aparece el Arduino (algo como `COM4`, `COM5`, etc. — anótalo, lo vas a necesitar más adelante).
4. Dale clic en **Subir** (la flecha).
5. Espera a que diga "Subida completa".
6. **Muy importante:** cierra el Monitor Serial del Arduino IDE si lo abriste, y no lo vuelvas a abrir mientras uses la app. Si lo dejas abierto, bloquea el puerto y el siguiente paso va a fallar.

---

## Paso 2 — Prender el backend

1. Abre una terminal (CMD o PowerShell) en la carpeta donde están `main.py` y `requirements.txt`.
2. Instala lo necesario (solo la primera vez):
   ```
   pip install -r requirements.txt
   ```
3. Revisa qué puerto le tocó a tu Arduino (lo anotaste en el paso 1). Si es distinto de `COM4`, en esa misma terminal escribe primero (cambia `COM5` por el tuyo):
   ```
   $env:LIQUIDFLOW_PUERTO='COM5'
   ```
   Si es `COM4`, te puedes saltar este paso.
4. Prende el backend:
   ```
   uvicorn main:app --reload
   ```
5. Debe salir un mensaje como:
   ```
   [serial] conectado a COM4 @ 115200 baudios
   ```
   Si en vez de eso ves un `ERROR al conectar`, revisa que el Arduino esté enchufado y que el puerto sea el correcto.
6. Deja esta terminal abierta y corriendo. No la cierres.

---

## Paso 3 — Prender la interfaz

1. Abre **otra** terminal (no cierres la del paso 2), en la carpeta `frontend`.
2. Escribe:
   ```
   npm run dev
   ```
3. Te va a dar un link, algo como `http://localhost:5173/`. Ábrelo en el navegador.

---

## Paso 4 — Verificar que todo esté conectado

En la barra lateral izquierda de la app, abajo, debe decir **"Arduino conectado"** en verde, con el puerto y los baudios reales (no signos de `—`).

- Si dice **"Arduino desconectado"**: revisa la terminal del backend (paso 2) — probablemente el puerto COM está mal o el Arduino se desconectó.
- Si la pantalla queda **en blanco**: abre la consola del navegador (tecla F12 → pestaña "Console") y manda captura de cualquier error en rojo.

---

## Resumen rápido (para cuando ya sepas los pasos)

1. Subir `Dosificador.ino` al Arduino (una sola vez, o cuando cambie el código).
2. Terminal 1: `uvicorn main:app --reload`
3. Terminal 2 (carpeta `frontend`): `npm run dev`
4. Verificar "Arduino conectado" en la interfaz.
