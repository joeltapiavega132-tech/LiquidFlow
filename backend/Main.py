"""
Backend LiquidFlow — puente entre la interfaz React y el Arduino.

Responsabilidades:
  1. Mantener abierto el puerto serial con el Arduino (pyserial).
  2. Interpretar las lineas de texto que manda el Arduino
     ("ADC: ... | Nivel: ... | Masa: ...", "=== DOSIFICACION FINALIZADA ===", etc.)
     y convertirlas en eventos estructurados (dict / JSON).
  3. Transmitir esos eventos en tiempo real a la interfaz via WebSocket.
  4. Exponer endpoints REST para iniciar una dosis, vaciar, y la parada
     de emergencia.

Requiere el .ino "Dosificador.ino" (version con volumen variable + comando S)
ya cargado en el Arduino.

Instalar dependencias:
    pip install fastapi uvicorn pyserial

Correr:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Variables de entorno opcionales:
    LIQUIDFLOW_PUERTO   (por defecto "COM4")
    LIQUIDFLOW_BAUDIOS  (por defecto 115200)
"""

import asyncio
import os
import re
import threading
import time
from typing import Optional

import serial
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

PUERTO = os.environ.get("LIQUIDFLOW_PUERTO", "COM4")
BAUDIOS = int(os.environ.get("LIQUIDFLOW_BAUDIOS", "115200"))
CAPACIDAD_ENVASE_ML = 1300.0
VOLUMEN_MINIMO_ML = 300.0   # por debajo de esto el sensor no distingue el cambio de nivel
VOLUMEN_MAXIMO_ML = 1000.0  # limite superior de una sola dosis

app = FastAPI(title="LiquidFlow Backend")

# Mientras se desarrolla, se permite cualquier origen. Restringir en produccion.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------
# PUENTE SERIAL (corre en un hilo aparte; pyserial es bloqueante)
# ------------------------------------------------------------------

class PuenteArduino:
    def __init__(self, puerto: str, baudios: int):
        self.puerto = puerto
        self.baudios = baudios
        self.conexion: Optional[serial.Serial] = None
        self.conectado = False
        self.hilo_lectura: Optional[threading.Thread] = None
        self.detener_hilo = threading.Event()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.clientes_ws: set[WebSocket] = set()

        # Patrones para parsear las lineas de texto del Arduino
        self.patron_reporte = re.compile(
            r"ADC:\s*([\d.]+)\s*\|\s*Nivel:\s*([\d.]+)\s*/\s*([\d.]+)\s*mL\s*\|\s*Masa:\s*([\d.]+)\s*g"
        )
        self.patron_volumen_solicitado = re.compile(r"Volumen solicitado:\s*([\d.]+)\s*mL")
        self.patron_nivel_final = re.compile(r"Nivel final:\s*([\d.]+)\s*mL")
        self.patron_bomba_ms = re.compile(r"Bomba encendida realmente:\s*(\d+)\s*ms")

        # Estado acumulado del resultado que se esta armando linea a linea
        self._resultado_parcial = {}

    def conectar(self):
        try:
            self.conexion = serial.Serial(self.puerto, self.baudios, timeout=1)
            time.sleep(2)  # el Arduino se reinicia al abrir el puerto serial
            self.conectado = True
            print(f"[serial] conectado a {self.puerto} @ {self.baudios} baudios")
        except serial.SerialException as e:
            self.conectado = False
            print(f"[serial] ERROR al conectar: {e}")

    def iniciar_lectura(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        self.detener_hilo.clear()
        self.hilo_lectura = threading.Thread(target=self._bucle_lectura, daemon=True)
        self.hilo_lectura.start()

    def _bucle_lectura(self):
        while not self.detener_hilo.is_set():
            if not self.conectado or self.conexion is None:
                time.sleep(1)
                self.conectar()
                continue
            try:
                linea = self.conexion.readline().decode("utf-8", errors="ignore").strip()
            except serial.SerialException:
                self.conectado = False
                continue
            if not linea:
                continue
            evento = self._parsear_linea(linea)
            if evento:
                asyncio.run_coroutine_threadsafe(self._difundir(evento), self.loop)

    def _parsear_linea(self, linea: str) -> Optional[dict]:
        m = self.patron_reporte.search(linea)
        if m:
            adc, nivel, capacidad, masa = m.groups()
            return {
                "tipo": "lectura",
                "adc": float(adc),
                "volumen_mL": float(nivel),
                "capacidad_mL": float(capacidad),
                "masa_g": float(masa),
            }

        if "BOMBA DETENIDA" in linea:
            return {"tipo": "deteniendo"}

        if "DOSIFICACION FINALIZADA" in linea:
            self._resultado_parcial = {}
            return {"tipo": "finalizando"}

        m = self.patron_volumen_solicitado.search(linea)
        if m:
            self._resultado_parcial["volumen_solicitado_mL"] = float(m.group(1))
            return None

        m = self.patron_nivel_final.search(linea)
        if m:
            self._resultado_parcial["volumen_final_mL"] = float(m.group(1))
            return None

        m = self.patron_bomba_ms.search(linea)
        if m:
            self._resultado_parcial["tiempo_bomba_ms"] = int(m.group(1))
            solicitado = self._resultado_parcial.get("volumen_solicitado_mL")
            final = self._resultado_parcial.get("volumen_final_mL")
            if solicitado is not None and final is not None:
                error_abs = final - solicitado
                error_pct = abs(error_abs) / solicitado * 100 if solicitado else 0
                return {
                    "tipo": "resultado",
                    "volumen_solicitado_mL": solicitado,
                    "volumen_final_mL": final,
                    "error_abs_mL": round(error_abs, 2),
                    "error_pct": round(error_pct, 1),
                    "tiempo_bomba_ms": self._resultado_parcial["tiempo_bomba_ms"],
                    "exitoso": error_pct <= 5,
                }
            return None

        if "PARADA DE EMERGENCIA" in linea:
            return {"tipo": "detenido_manual"}

        if "ERROR" in linea:
            return {"tipo": "error", "mensaje": linea}

        return {"tipo": "log", "mensaje": linea}

    async def _difundir(self, evento: dict):
        muertos = []
        for ws in self.clientes_ws:
            try:
                await ws.send_json(evento)
            except Exception:
                muertos.append(ws)
        for ws in muertos:
            self.clientes_ws.discard(ws)

    def enviar_comando(self, texto: str) -> bool:
        if not self.conectado or self.conexion is None:
            return False
        try:
            self.conexion.write((texto + "\n").encode("utf-8"))
            return True
        except serial.SerialException:
            self.conectado = False
            return False


puente = PuenteArduino(PUERTO, BAUDIOS)


@app.on_event("startup")
async def al_iniciar():
    puente.conectar()
    puente.iniciar_lectura(asyncio.get_event_loop())


@app.on_event("shutdown")
async def al_cerrar():
    puente.detener_hilo.set()
    if puente.conexion:
        puente.conexion.close()


# ------------------------------------------------------------------
# MODELOS
# ------------------------------------------------------------------

class SolicitudDosis(BaseModel):
    volumen_mL: float
    modo: str = "llenar"  # "llenar" o "vaciar"


# ------------------------------------------------------------------
# ENDPOINTS REST
# ------------------------------------------------------------------

@app.get("/api/estado")
async def estado():
    return {
        "arduino_conectado": puente.conectado,
        "puerto": PUERTO,
        "baudios": BAUDIOS,
        "capacidad_envase_mL": CAPACIDAD_ENVASE_ML,
        "volumen_minimo_mL": VOLUMEN_MINIMO_ML,
        "volumen_maximo_mL": VOLUMEN_MAXIMO_ML,
    }


@app.post("/api/dosificar")
async def dosificar(solicitud: SolicitudDosis):
    if solicitud.volumen_mL < VOLUMEN_MINIMO_ML or solicitud.volumen_mL > VOLUMEN_MAXIMO_ML:
        return {
            "ok": False,
            "error": f"Volumen fuera de rango ({VOLUMEN_MINIMO_ML:.0f}-{VOLUMEN_MAXIMO_ML:.0f} mL)",
        }

    signo = 1 if solicitud.modo == "llenar" else -1
    comando = f"{signo * solicitud.volumen_mL:.2f}"
    enviado = puente.enviar_comando(comando)
    if not enviado:
        return {"ok": False, "error": "Arduino no conectado"}
    return {"ok": True, "comando_enviado": comando}


@app.post("/api/detener")
async def detener():
    enviado = puente.enviar_comando("S")
    if not enviado:
        return {"ok": False, "error": "Arduino no conectado"}
    return {"ok": True}


# ------------------------------------------------------------------
# WEBSOCKET — lecturas en tiempo real para la interfaz
# ------------------------------------------------------------------

@app.websocket("/ws/liquidflow")
async def websocket_liquidflow(websocket: WebSocket):
    await websocket.accept()
    puente.clientes_ws.add(websocket)
    try:
        while True:
            # No esperamos mensajes del cliente; solo mantenemos la conexion viva.
            await websocket.receive_text()
    except WebSocketDisconnect:
        puente.clientes_ws.discard(websocket)