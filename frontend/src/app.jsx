import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine
} from "recharts";
import {
  Wifi, WifiOff, Play, Square, Gauge, History, BarChart3, SlidersHorizontal,
  Settings, Droplets, CheckCircle2, AlertTriangle, Activity, Download,
  FileSpreadsheet, Plus, Trash2, ChevronRight, Cpu
} from "lucide-react";

/* ---------------------------------------------------------------
   CONEXION AL BACKEND (FastAPI + WebSocket)
   Cambia estas dos URLs si el backend corre en otra maquina/puerto.
----------------------------------------------------------------*/
const URL_API = "http://localhost:8000";
const URL_WS = "ws://localhost:8000/ws/liquidflow";

// Rango de dosis valido (debe coincidir con el firmware/backend)
const VOLUMEN_MINIMO_ML = 300;
const VOLUMEN_MAXIMO_ML = 1000;

/* ---------------------------------------------------------------
   COLORES — paleta institucional ESPE (verde / rojo / blanco)
----------------------------------------------------------------*/

const FUENTE_TITULO = "'Space Grotesk', 'Segoe UI', sans-serif";
const FUENTE_DATOS = "'JetBrains Mono', 'Roboto Mono', monospace";

const COLORES = {
  fondo: "#FFFFFF",
  panel: "#FFFFFF",
  panelSuave: "#F3F8F5",
  borde: "#D8E3DC",
  bordeSuave: "#E9F1EC",
  verde: "#1B7A43",
  verdeSuave: "#E3F5EA",
  rojo: "#C81E2C",
  rojoSuave: "#FBE4E6",
  exito: "#178C4E",
  peligro: "#C81E2C",
  texto: "#17231C",
  textoSuave: "#5B6B62",
  textoSuave2: "#8B968F",
};

const BARRA_FONDO = "#0F3D26";
const BARRA_BORDE = "#1B5238";
const BARRA_TEXTO = "#E7F3EC";
const BARRA_TEXTO_SUAVE = "#9FC5AE";
const BORDE_CHIP_VERDE = "#8FCBA6";
const BORDE_CHIP_ROJO = "#F0A8AE";

const ELEMENTOS_NAV = [
  { id: "dashboard", etiqueta: "Dashboard", icono: Gauge },
  { id: "nueva", etiqueta: "Nueva dosificación", icono: Droplets },
  { id: "historial", etiqueta: "Historial", icono: History },
  { id: "graficas", etiqueta: "Gráficas", icono: BarChart3 },
  { id: "calibracion", etiqueta: "Calibración", icono: SlidersHorizontal },
  { id: "config", etiqueta: "Configuración", icono: Settings },
];

const ETIQUETAS_ESTADO = {
  inactivo: "Preparado",
  preparado: "Preparado",
  llenando: "Llenando",
  estabilizando: "Estabilizando",
  completado: "Completado",
  detenido_manual: "Detenido",
  error_dispositivo: "Error",
};

const COLORES_ESTADO = {
  inactivo: COLORES.textoSuave,
  preparado: COLORES.verde,
  llenando: COLORES.rojo,
  estabilizando: COLORES.rojo,
  completado: COLORES.exito,
  detenido_manual: COLORES.rojo,
  error_dispositivo: COLORES.peligro,
};

const HISTORIAL_INICIAL = [
  { id: "#006", fecha: "18/07/2026", hora: "09:12", solicitado: 500.0, final: 508.0, error: 1.6, tLlenado: 121.5, tEstab: 2.4, estado: "Exitoso" },
  { id: "#005", fecha: "17/07/2026", hora: "16:47", solicitado: 1000.0, final: 992.0, error: 0.8, tLlenado: 237.4, tEstab: 3.1, estado: "Exitoso" },
  { id: "#004", fecha: "17/07/2026", hora: "16:20", solicitado: 300.0, final: 348.0, error: 16.0, tLlenado: 71.8, tEstab: 1.8, estado: "Fuera de rango" },
  { id: "#003", fecha: "16/07/2026", hora: "11:05", solicitado: 800.0, final: 794.0, error: 0.8, tLlenado: 191.4, tEstab: 2.6, estado: "Exitoso" },
  { id: "#002", fecha: "16/07/2026", hora: "10:58", solicitado: 600.0, final: 596.0, error: 0.7, tLlenado: 143.6, tEstab: 2.2, estado: "Exitoso" },
  { id: "#001", fecha: "16/07/2026", hora: "10:40", solicitado: 300.0, final: 305.0, error: 1.7, tLlenado: 71.8, tEstab: 2.4, estado: "Exitoso" },
];

const CALIBRACION_INICIAL = [
  { id: 1, lectura: 800, volumen: 0 },
  { id: 2, lectura: 715, volumen: 325 },
  { id: 3, lectura: 630, volumen: 650 },
  { id: 4, lectura: 540, volumen: 975 },
  { id: 5, lectura: 450, volumen: 1300 },
];

/* ---------------------------------------------------------------
   HOOK: puente en vivo con el backend (WebSocket + REST)
----------------------------------------------------------------*/

function usePuenteArduino() {
  const [conectado, setConectado] = useState(false);
  const [ultimaLectura, setUltimaLectura] = useState(null);
  const [ultimoEvento, setUltimoEvento] = useState(null);
  const [infoDispositivo, setInfoDispositivo] = useState({ puerto: "—", baudios: "—" });
  const wsRef = useRef(null);

  useEffect(() => {
    let activo = true;

    fetch(`${URL_API}/api/estado`)
      .then((r) => r.json())
      .then((d) => { if (activo) setInfoDispositivo({ puerto: d.puerto, baudios: d.baudios }); })
      .catch(() => {});

    function conectar() {
      const ws = new WebSocket(URL_WS);
      wsRef.current = ws;
      ws.onopen = () => { if (activo) setConectado(true); };
      ws.onclose = () => {
        if (activo) {
          setConectado(false);
          setTimeout(conectar, 2000);
        }
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (msg) => {
        if (!activo) return;
        try {
          const evento = JSON.parse(msg.data);
          if (evento.tipo === "lectura") setUltimaLectura(evento);
          setUltimoEvento(evento);
        } catch (e) { /* linea no-JSON, se ignora */ }
      };
    }
    conectar();

    return () => {
      activo = false;
      wsRef.current?.close();
    };
  }, []);

  async function dosificar(volumenML, modo = "llenar") {
    try {
      const resp = await fetch(`${URL_API}/api/dosificar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volumen_mL: volumenML, modo }),
      });
      return await resp.json();
    } catch (e) {
      return { ok: false, error: "No se pudo contactar al backend" };
    }
  }

  async function detener() {
    try {
      const resp = await fetch(`${URL_API}/api/detener`, { method: "POST" });
      return await resp.json();
    } catch (e) {
      return { ok: false, error: "No se pudo contactar al backend" };
    }
  }

  return { conectado, ultimaLectura, ultimoEvento, infoDispositivo, dosificar, detener };
}

/* ---------------------------------------------------------------
   PIEZAS BASE
----------------------------------------------------------------*/

function Panel({ titulo, prefijo, extra, children, estilo, estiloCuerpo }) {
  return (
    <div style={{
      background: COLORES.panel, border: `1px solid ${COLORES.borde}`,
      borderRadius: 10, display: "flex", flexDirection: "column", ...estilo,
    }}>
      {(titulo || extra) && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: `1px solid ${COLORES.bordeSuave}`,
        }}>
          <div>
            {prefijo && (
              <div style={{
                fontFamily: FUENTE_DATOS, fontSize: 10.5, letterSpacing: 1.5,
                color: COLORES.textoSuave2, textTransform: "uppercase", marginBottom: 3,
              }}>{prefijo}</div>
            )}
            {titulo && <div style={{ fontFamily: FUENTE_TITULO, fontWeight: 600, fontSize: 15, color: COLORES.texto }}>{titulo}</div>}
          </div>
          {extra}
        </div>
      )}
      <div style={{ padding: 18, flex: 1, ...estiloCuerpo }}>{children}</div>
    </div>
  );
}

function ChipEstado({ ok, etiqueta, textoOk, textoMal }) {
  const bien = ok;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
      background: bien ? COLORES.verdeSuave : COLORES.rojoSuave,
      border: `1px solid ${bien ? BORDE_CHIP_VERDE : BORDE_CHIP_ROJO}`,
      borderRadius: 7,
    }}>
      <div style={{
        width: 7, height: 7, borderRadius: "50%",
        background: bien ? COLORES.verde : COLORES.peligro,
        boxShadow: `0 0 6px ${bien ? COLORES.verde : COLORES.peligro}`,
      }} />
      <span style={{ fontFamily: FUENTE_DATOS, fontSize: 12, color: COLORES.texto, flex: 1 }}>{etiqueta}</span>
      <span style={{ fontFamily: FUENTE_DATOS, fontSize: 11.5, fontWeight: 600, color: bien ? COLORES.verde : COLORES.peligro }}>
        {bien ? textoOk : textoMal}
      </span>
    </div>
  );
}

function InsigniaEstado({ estado }) {
  const color = COLORES_ESTADO[estado] || COLORES.textoSuave;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px",
      borderRadius: 20, background: color + "20", border: `1px solid ${color}55`,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", background: color,
        boxShadow: `0 0 5px ${color}`,
      }} />
      <span style={{ fontFamily: FUENTE_DATOS, fontSize: 11.5, fontWeight: 600, color, letterSpacing: 0.5 }}>
        {(ETIQUETAS_ESTADO[estado] || estado)?.toUpperCase()}
      </span>
    </div>
  );
}

function Metrica({ etiqueta, valor, unidad, color, tamano = 22 }) {
  return (
    <div>
      <div style={{ fontFamily: FUENTE_DATOS, fontSize: 10.5, color: COLORES.textoSuave2, letterSpacing: 1, textTransform: "uppercase", marginBottom: 5 }}>
        {etiqueta}
      </div>
      <div style={{ fontFamily: FUENTE_DATOS, fontSize: tamano, fontWeight: 600, color: color || COLORES.texto }}>
        {valor}<span style={{ fontSize: tamano * 0.5, color: COLORES.textoSuave, marginLeft: 4 }}>{unidad}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   ELEMENTO DE FIRMA: probeta graduada con líquido en vivo
----------------------------------------------------------------*/

function MedidorCilindro({ actual, objetivo, fase }) {
  const escalaMaxima = Math.max(objetivo * 1.15, 1);
  const porcentaje = Math.max(0, Math.min(1, actual / escalaMaxima));
  const alto = 260, ancho = 120;
  const topeLiquido = alto - porcentaje * (alto - 20) - 10;
  const yObjetivo = alto - (objetivo / escalaMaxima) * (alto - 20) - 10;

  const marcas = [];
  const numMarcas = 6;
  for (let i = 0; i <= numMarcas; i++) {
    const v = (escalaMaxima / numMarcas) * i;
    const y = alto - (v / escalaMaxima) * (alto - 20) - 10;
    marcas.push({ v, y });
  }

  const colorBrillo = fase === "llenando" ? COLORES.rojo : fase === "completado" ? COLORES.exito : COLORES.verde;

  return (
    <svg viewBox={`0 0 ${ancho} ${alto + 30}`} width="100%" height="100%" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="gradienteLiquido" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colorBrillo} stopOpacity="0.95" />
          <stop offset="100%" stopColor={colorBrillo} stopOpacity="0.55" />
        </linearGradient>
        <clipPath id="recorteCilindro">
          <rect x="30" y="10" width="60" height={alto - 10} rx="6" />
        </clipPath>
      </defs>

      <rect x="30" y="10" width="60" height={alto - 10} rx="6" fill="#FAFCFB" stroke={COLORES.borde} strokeWidth="1.5" />

      {marcas.map((m, i) => (
        <g key={i}>
          <line x1="22" y1={m.y} x2="30" y2={m.y} stroke={COLORES.textoSuave2} strokeWidth="1" />
          <text x="16" y={m.y + 3} fontFamily={FUENTE_DATOS} fontSize="8" fill={COLORES.textoSuave2} textAnchor="end">
            {m.v.toFixed(0)}
          </text>
        </g>
      ))}

      <g clipPath="url(#recorteCilindro)">
        <rect x="30" y={topeLiquido} width="60" height={alto - topeLiquido} fill="url(#gradienteLiquido)">
          {fase === "llenando" && (
            <animate attributeName="y" values={`${topeLiquido};${topeLiquido - 1.5};${topeLiquido}`} dur="0.9s" repeatCount="indefinite" />
          )}
        </rect>
        <rect x="30" y={topeLiquido} width="60" height="2.5" fill={colorBrillo} opacity="0.9" />
      </g>

      <line x1="28" y1={yObjetivo} x2="92" y2={yObjetivo} stroke={COLORES.texto} strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />
      <text x="94" y={yObjetivo + 3} fontFamily={FUENTE_DATOS} fontSize="8.5" fill={COLORES.texto} opacity="0.7">obj.</text>

      <rect x="30" y="10" width="60" height={alto - 10} rx="6" fill="none" stroke={COLORES.borde} strokeWidth="1.5" />
      <rect x="24" y={alto} width="72" height="10" rx="2" fill={COLORES.panelSuave} stroke={COLORES.borde} />
    </svg>
  );
}

/* ---------------------------------------------------------------
   NUEVA DOSIFICACIÓN — conectada al backend real
----------------------------------------------------------------*/

function NuevaDosificacion({ conectado, ultimaLectura, ultimoEvento, dosificar, detener }) {
  const [fase, setFase] = useState("inactivo");
  const [objetivo, setObjetivo] = useState(500);
  const [valorEntrada, setValorEntrada] = useState("500.00");
  const [actual, setActual] = useState(0);
  const [lecturaSensor, setLecturaSensor] = useState(0);
  const [tiempoTranscurrido, setTiempoTranscurrido] = useState(0);
  const [serie, setSerie] = useState([]);
  const [resultado, setResultado] = useState(null);
  const [mensajeError, setMensajeError] = useState(null);

  const nivelInicioRef = useRef(0);
  const tInicioRef = useRef(0);
  const tLlenadoRef = useRef(0);

  // Reacciona a lecturas continuas del sensor mientras se dosifica
  useEffect(() => {
    if (!ultimaLectura) return;
    setLecturaSensor(Math.round(ultimaLectura.adc));
    if (fase === "llenando" || fase === "estabilizando") {
      const dosificado = Math.max(0, ultimaLectura.volumen_mL - nivelInicioRef.current);
      setActual(dosificado);
      const t = (Date.now() - tInicioRef.current) / 1000;
      setTiempoTranscurrido(t);
      setSerie((s) => [...s, { t: Number(t.toFixed(2)), v: Number(dosificado.toFixed(2)) }]);
    }
  }, [ultimaLectura]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reacciona a eventos puntuales: bomba detenida, resultado final, parada manual, error
  useEffect(() => {
    if (!ultimoEvento) return;
    if (ultimoEvento.tipo === "deteniendo") {
      tLlenadoRef.current = (Date.now() - tInicioRef.current) / 1000;
      setFase("estabilizando");
    } else if (ultimoEvento.tipo === "resultado") {
      const tLlenadoBomba = ultimoEvento.tiempo_bomba_ms / 1000;
      const tEstab = Math.max(0, tiempoTranscurrido - tLlenadoRef.current);
      setResultado({
        solicitado: ultimoEvento.volumen_solicitado_mL,
        final: ultimoEvento.volumen_final_mL,
        errorAbs: ultimoEvento.error_abs_mL,
        errorPct: ultimoEvento.error_pct,
        tLlenado: Number(tLlenadoBomba.toFixed(1)),
        tEstab: Number(tEstab.toFixed(1)),
        tTotal: Number((tLlenadoBomba + tEstab).toFixed(1)),
        ok: ultimoEvento.exitoso,
      });
      setFase("completado");
    } else if (ultimoEvento.tipo === "detenido_manual") {
      setFase("detenido_manual");
    } else if (ultimoEvento.tipo === "error") {
      setMensajeError(ultimoEvento.mensaje);
      setFase("error_dispositivo");
    }
  }, [ultimoEvento]); // eslint-disable-line react-hooks/exhaustive-deps

  async function iniciarLlenado() {
    nivelInicioRef.current = ultimaLectura ? ultimaLectura.volumen_mL : 0;
    tInicioRef.current = Date.now();
    tLlenadoRef.current = 0;
    setSerie([{ t: 0, v: 0 }]);
    setActual(0);
    setTiempoTranscurrido(0);
    setMensajeError(null);
    setFase("llenando");
    const resp = await dosificar(objetivo, "llenar");
    if (!resp.ok) {
      setMensajeError(resp.error || "No se pudo iniciar la dosificación");
      setFase("preparado");
    }
  }

  async function detenerManualmente() {
    await detener();
    // el cambio de fase real llega por WebSocket (evento "detenido_manual")
  }

  function reiniciar() {
    setFase("inactivo");
    setActual(0);
    setSerie([]);
    setTiempoTranscurrido(0);
    setResultado(null);
    setMensajeError(null);
  }

  const numeroEntrada = parseFloat(valorEntrada);
  const volumenValido = !isNaN(numeroEntrada) && numeroEntrada >= VOLUMEN_MINIMO_ML && numeroEntrada <= VOLUMEN_MAXIMO_ML;

  if (fase === "inactivo") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 18 }}>
        <Panel prefijo="Control de dosificación" titulo="Nueva dosificación">
          <div style={{ marginBottom: 22 }}>
            <label style={{ fontFamily: FUENTE_TITULO, fontSize: 13.5, color: COLORES.textoSuave, display: "block", marginBottom: 10 }}>
              ¿Cuánto líquido deseas dosificar?
            </label>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              background: COLORES.panelSuave, border: `1px solid ${volumenValido ? COLORES.borde : COLORES.peligro}`,
              borderRadius: 8, padding: "14px 18px",
            }}>
              <input
                value={valorEntrada}
                onChange={(e) => setValorEntrada(e.target.value)}
                inputMode="decimal"
                style={{
                  background: "transparent", border: "none", outline: "none", flex: 1,
                  fontFamily: FUENTE_DATOS, fontSize: 34, fontWeight: 600, color: COLORES.texto, width: "100%",
                }}
              />
              <span style={{ fontFamily: FUENTE_DATOS, fontSize: 18, color: COLORES.textoSuave }}>mL</span>
            </div>
            {!volumenValido && (
              <div style={{ marginTop: 8, color: COLORES.peligro, fontFamily: FUENTE_DATOS, fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={13} /> Ingresa un volumen válido entre {VOLUMEN_MINIMO_ML} y {VOLUMEN_MAXIMO_ML} mL
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            <ChipEstado ok={conectado} etiqueta="Arduino" textoOk="Conectado" textoMal="Desconectado" />
            <ChipEstado ok={conectado} etiqueta="Sensor" textoOk="Listo" textoMal="Sin datos" />
            <ChipEstado ok={conectado} etiqueta="Bomba" textoOk="Detenida" textoMal="Sin datos" />
            <ChipEstado ok={volumenValido && conectado} etiqueta="Sistema" textoOk="Preparado" textoMal="Esperando" />
          </div>

          <button
            disabled={!volumenValido || !conectado}
            onClick={() => { setObjetivo(numeroEntrada); setFase("preparado"); }}
            style={{
              width: "100%", padding: "14px 0", borderRadius: 8, border: "none",
              background: (volumenValido && conectado) ? COLORES.verde : COLORES.bordeSuave,
              color: (volumenValido && conectado) ? "#FFFFFF" : COLORES.textoSuave2,
              fontFamily: FUENTE_TITULO, fontWeight: 700, fontSize: 14.5, letterSpacing: 0.5,
              cursor: (volumenValido && conectado) ? "pointer" : "not-allowed",
            }}
          >
            {conectado ? "CONFIGURAR DOSIFICACIÓN" : "ESPERANDO CONEXIÓN AL ARDUINO"}
          </button>
        </Panel>

        <Panel prefijo="Vista previa" titulo="Recipiente">
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ width: 130 }}>
              <MedidorCilindro actual={0} objetivo={volumenValido ? numeroEntrada : VOLUMEN_MINIMO_ML} fase="inactivo" />
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  if (fase === "preparado") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 18 }}>
        <Panel prefijo="Resumen" titulo="Dosificación configurada" extra={<InsigniaEstado estado="preparado" />}>
          {mensajeError && (
            <div style={{
              marginBottom: 16, padding: "10px 14px", borderRadius: 7,
              background: COLORES.rojoSuave, border: `1px solid ${BORDE_CHIP_ROJO}`,
              color: COLORES.peligro, fontFamily: FUENTE_DATOS, fontSize: 12,
            }}>{mensajeError}</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 22 }}>
            <Metrica etiqueta="Volumen solicitado" valor={objetivo.toFixed(2)} unidad="mL" color={COLORES.verde} tamano={30} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
              <ChipEstado ok={conectado} etiqueta="Sensor" textoOk="Listo" textoMal="Sin datos" />
              <ChipEstado ok={conectado} etiqueta="Bomba" textoOk="Lista" textoMal="Sin datos" />
              <ChipEstado ok={conectado} etiqueta="Conexión Arduino" textoOk="Activa" textoMal="Perdida" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={reiniciar} style={{
              padding: "13px 18px", borderRadius: 8, border: `1px solid ${COLORES.borde}`,
              background: "transparent", color: COLORES.textoSuave, fontFamily: FUENTE_TITULO, fontWeight: 600, cursor: "pointer",
            }}>Cancelar</button>
            <button onClick={iniciarLlenado} disabled={!conectado} style={{
              flex: 1, padding: "13px 0", borderRadius: 8, border: "none",
              background: conectado ? COLORES.verde : COLORES.bordeSuave,
              color: conectado ? "#FFFFFF" : COLORES.textoSuave2, fontFamily: FUENTE_TITULO, fontWeight: 700,
              fontSize: 14.5, letterSpacing: 0.5, cursor: conectado ? "pointer" : "not-allowed", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 8,
            }}>
              <Play size={16} fill={conectado ? "#FFFFFF" : COLORES.textoSuave2} /> INICIAR
            </button>
          </div>
        </Panel>
        <Panel prefijo="Vista previa" titulo="Recipiente">
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ width: 130 }}>
              <MedidorCilindro actual={0} objetivo={objetivo} fase="preparado" />
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  if (fase === "llenando" || fase === "estabilizando") {
    const estaLlenando = fase === "llenando";
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Panel
            titulo={estaLlenando ? "PROCESO: LLENANDO" : "BOMBA DETENIDA · ESTABILIZANDO MEDICIÓN"}
            prefijo="Estado del sistema"
            extra={<InsigniaEstado estado={fase} />}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 18 }}>
              <Metrica etiqueta="Solicitado" valor={objetivo.toFixed(2)} unidad="mL" />
              <Metrica etiqueta="Volumen actual" valor={actual.toFixed(2)} unidad="mL" color={estaLlenando ? COLORES.rojo : COLORES.verde} />
              <Metrica etiqueta="Lectura sensor" valor={lecturaSensor} unidad="raw" />
              <Metrica etiqueta={!estaLlenando ? "Estabilizando" : "Tiempo"} valor={(!estaLlenando ? Math.max(0, tiempoTranscurrido - tLlenadoRef.current) : tiempoTranscurrido).toFixed(1)} unidad="s" color={!estaLlenando ? COLORES.rojo : undefined} />
            </div>

            <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", fontFamily: FUENTE_DATOS, fontSize: 11.5, color: COLORES.textoSuave }}>
              <span>{actual.toFixed(2)} mL / {objetivo.toFixed(2)} mL</span>
              <span>{Math.min(100, (actual / objetivo) * 100).toFixed(0)}%</span>
            </div>
            <div style={{ height: 10, background: COLORES.panelSuave, borderRadius: 6, overflow: "hidden", border: `1px solid ${COLORES.borde}` }}>
              <div style={{
                height: "100%", width: `${Math.min(100, (actual / objetivo) * 100)}%`,
                background: estaLlenando ? `linear-gradient(90deg, ${COLORES.rojo}, ${COLORES.verde})` : COLORES.verde,
                transition: "width 0.12s linear",
              }} />
            </div>

            {!estaLlenando && (
              <div style={{
                marginTop: 16, padding: "10px 14px", borderRadius: 7,
                background: COLORES.rojoSuave, border: `1px solid ${BORDE_CHIP_ROJO}`,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <Activity size={15} color={COLORES.rojo} />
                <span style={{ fontFamily: FUENTE_DATOS, fontSize: 12, color: COLORES.rojo }}>
                  Estabilizando... {Math.max(0, tiempoTranscurrido - tLlenadoRef.current).toFixed(1)} s
                </span>
              </div>
            )}

            {estaLlenando && (
              <button onClick={detenerManualmente} style={{
                marginTop: 18, width: "100%", padding: "14px 0", borderRadius: 8, border: `1px solid ${COLORES.peligro}`,
                background: COLORES.rojoSuave, color: COLORES.peligro, fontFamily: FUENTE_TITULO, fontWeight: 700,
                fontSize: 14, letterSpacing: 0.5, cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", gap: 8,
              }}>
                <Square size={15} fill={COLORES.peligro} /> DETENER BOMBA
              </button>
            )}
          </Panel>

          <Panel prefijo="Datos en tiempo real" titulo="Evolución del volumen en tiempo real">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={serie}>
                <CartesianGrid stroke={COLORES.bordeSuave} vertical={false} />
                <XAxis dataKey="t" tick={{ fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} label={{ value: "Tiempo (s)", position: "insideBottom", offset: -4, fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} stroke={COLORES.borde} />
                <YAxis tick={{ fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} label={{ value: "Volumen (mL)", angle: -90, position: "insideLeft", fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} stroke={COLORES.borde} />
                <Tooltip contentStyle={{ background: COLORES.panelSuave, border: `1px solid ${COLORES.borde}`, borderRadius: 6, fontFamily: FUENTE_DATOS, fontSize: 11 }} labelStyle={{ color: COLORES.textoSuave }} />
                <ReferenceLine y={objetivo} stroke={COLORES.texto} strokeDasharray="4 4" strokeOpacity={0.5} />
                <Line type="monotone" dataKey="v" stroke={COLORES.verde} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        </div>

        <Panel prefijo="Recipiente" titulo="Nivel en vivo">
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ width: 130 }}>
              <MedidorCilindro actual={actual} objetivo={objetivo} fase={fase} />
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  if (fase === "completado" && resultado) {
    const indiceParada = serie.findIndex((p) => p.t >= resultado.tLlenado);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Panel
          titulo="DOSIFICACIÓN COMPLETADA"
          prefijo="Resultado final"
          extra={
            <div style={{
              display: "flex", alignItems: "center", gap: 7, padding: "6px 14px", borderRadius: 20,
              background: resultado.ok ? COLORES.verdeSuave : COLORES.rojoSuave, border: `1px solid ${resultado.ok ? BORDE_CHIP_VERDE : BORDE_CHIP_ROJO}`,
            }}>
              {resultado.ok ? <CheckCircle2 size={14} color={COLORES.exito} /> : <AlertTriangle size={14} color={COLORES.peligro} />}
              <span style={{ fontFamily: FUENTE_DATOS, fontSize: 12, fontWeight: 700, color: resultado.ok ? COLORES.exito : COLORES.peligro }}>
                {resultado.ok ? "Dosificación exitosa" : "Fuera del rango esperado"}
              </span>
            </div>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, marginBottom: 18 }}>
            {[
              ["Volumen solicitado", resultado.solicitado.toFixed(2), "mL"],
              ["Volumen final", resultado.final.toFixed(2), "mL"],
              ["Error absoluto", resultado.errorAbs.toFixed(2), "mL"],
              ["Porcentaje de error", resultado.errorPct.toFixed(1), "%"],
            ].map(([l, v, u], i) => (
              <div key={i} style={{ padding: "0 20px", borderLeft: i > 0 ? `1px solid ${COLORES.bordeSuave}` : "none" }}>
                <Metrica etiqueta={l} valor={v} unidad={u} color={i >= 2 ? (resultado.ok ? COLORES.exito : COLORES.peligro) : COLORES.texto} tamano={24} />
              </div>
            ))}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FUENTE_DATOS, fontSize: 12.5 }}>
            <tbody>
              {[
                ["Tiempo de bomba (llenado)", resultado.tLlenado + " s"],
                ["Tiempo de estabilización", resultado.tEstab + " s"],
                ["Tiempo total", resultado.tTotal + " s"],
              ].map(([k, v], i) => (
                <tr key={i} style={{ borderTop: `1px solid ${COLORES.bordeSuave}` }}>
                  <td style={{ padding: "9px 4px", color: COLORES.textoSuave }}>{k}</td>
                  <td style={{ padding: "9px 4px", color: COLORES.texto, textAlign: "right", fontWeight: 600 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={reiniciar} style={{
              flex: 1, padding: "13px 0", borderRadius: 8, border: "none",
              background: COLORES.verde, color: "#FFFFFF", fontFamily: FUENTE_TITULO, fontWeight: 700,
              fontSize: 14, cursor: "pointer",
            }}>Nueva dosificación</button>
            <button style={{
              padding: "13px 18px", borderRadius: 8, border: `1px solid ${COLORES.borde}`,
              background: "transparent", color: COLORES.textoSuave, fontFamily: FUENTE_TITULO, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 8,
            }}><FileSpreadsheet size={15} /> Guardar en historial</button>
          </div>
        </Panel>

        <Panel prefijo="Gráfica final del proceso" titulo="Volumen respecto al tiempo">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={serie}>
              <CartesianGrid stroke={COLORES.bordeSuave} vertical={false} />
              <XAxis dataKey="t" tick={{ fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} label={{ value: "Tiempo (s)", position: "insideBottom", offset: -4, fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} stroke={COLORES.borde} />
              <YAxis tick={{ fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} label={{ value: "Volumen (mL)", angle: -90, position: "insideLeft", fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} stroke={COLORES.borde} />
              <Tooltip contentStyle={{ background: COLORES.panelSuave, border: `1px solid ${COLORES.borde}`, borderRadius: 6, fontFamily: FUENTE_DATOS, fontSize: 11 }} labelStyle={{ color: COLORES.textoSuave }} />
              {indiceParada > -1 && (
                <ReferenceLine x={serie[indiceParada]?.t} stroke={COLORES.rojo} strokeDasharray="4 4" label={{ value: "Bomba detenida", fill: COLORES.rojo, fontFamily: FUENTE_DATOS, fontSize: 10, position: "top" }} />
              )}
              <ReferenceLine y={objetivo} stroke={COLORES.texto} strokeOpacity={0.4} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="v" stroke={COLORES.verde} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    );
  }

  if (fase === "detenido_manual" || fase === "error_dispositivo") {
    const esError = fase === "error_dispositivo";
    return (
      <Panel
        titulo={esError ? "ERROR DE SEGURIDAD" : "DOSIFICACIÓN DETENIDA MANUALMENTE"}
        prefijo="Estado del sistema"
        extra={<InsigniaEstado estado={fase} />}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <AlertTriangle size={18} color={COLORES.peligro} />
          <span style={{ fontFamily: FUENTE_DATOS, fontSize: 13, color: COLORES.texto }}>
            {esError
              ? (mensajeError || "El Arduino reportó un error de seguridad (tiempo máximo excedido sin alcanzar el objetivo).")
              : "El usuario detuvo la bomba antes de completar la dosificación. El firmware no calcula error/volumen final en este caso."}
          </span>
        </div>
        <Metrica etiqueta="Último volumen dosificado (aprox.)" valor={actual.toFixed(2)} unidad="mL" color={COLORES.rojo} tamano={26} />
        <button onClick={reiniciar} style={{
          marginTop: 20, width: "100%", padding: "13px 0", borderRadius: 8, border: "none",
          background: COLORES.verde, color: "#FFFFFF", fontFamily: FUENTE_TITULO, fontWeight: 700,
          fontSize: 14, cursor: "pointer",
        }}>Nueva dosificación</button>
      </Panel>
    );
  }

  return null;
}

/* ---------------------------------------------------------------
   DASHBOARD
----------------------------------------------------------------*/

function Dashboard({ irANueva, conectado, infoDispositivo }) {
  const ultima = HISTORIAL_INICIAL[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <Panel prefijo="Conexión" titulo="Arduino">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {conectado ? <Wifi size={20} color={COLORES.verde} /> : <WifiOff size={20} color={COLORES.peligro} />}
            <div>
              <div style={{ fontFamily: FUENTE_DATOS, fontSize: 13, color: conectado ? COLORES.verde : COLORES.peligro, fontWeight: 700 }}>
                {conectado ? "Conectado" : "Desconectado"}
              </div>
              <div style={{ fontFamily: FUENTE_DATOS, fontSize: 10.5, color: COLORES.textoSuave2 }}>{infoDispositivo.puerto} · {infoDispositivo.baudios} baud</div>
            </div>
          </div>
        </Panel>
        <Panel prefijo="Última dosificación" titulo={ultima.id}>
          <Metrica etiqueta="Error" valor={ultima.error} unidad="%" color={COLORES.exito} tamano={24} />
        </Panel>
        <Panel prefijo="Hoy" titulo="Dosificaciones">
          <Metrica etiqueta="Completadas" valor="1" unidad="" tamano={24} />
        </Panel>
        <Panel prefijo="Sensor" titulo="Estado">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Cpu size={20} color={COLORES.verde} />
            <div style={{ fontFamily: FUENTE_DATOS, fontSize: 13, color: COLORES.texto }}>Calibrado · 5 puntos</div>
          </div>
        </Panel>
      </div>

      <Panel prefijo="Acción rápida" titulo="Iniciar una nueva dosificación">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: FUENTE_TITULO, color: COLORES.textoSuave, fontSize: 13.5 }}>
            Configura un volumen objetivo (entre {VOLUMEN_MINIMO_ML} y {VOLUMEN_MAXIMO_ML} mL) y monitorea el proceso en tiempo real.
          </span>
          <button onClick={irANueva} style={{
            padding: "12px 20px", borderRadius: 8, border: "none", background: COLORES.verde,
            color: "#FFFFFF", fontFamily: FUENTE_TITULO, fontWeight: 700, fontSize: 13.5, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 8,
          }}>Nueva dosificación <ChevronRight size={15} /></button>
        </div>
      </Panel>

      <Panel prefijo="Historial reciente" titulo="Últimas pruebas">
        <TablaHistorial filas={HISTORIAL_INICIAL.slice(0, 4)} compacto />
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------
   HISTORIAL
----------------------------------------------------------------*/

function TablaHistorial({ filas, compacto }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FUENTE_DATOS, fontSize: 12 }}>
      <thead>
        <tr>
          {["ID", "Fecha", "Hora", "Solicitado", "Final", "Error %", "T. llenado", "T. estab.", "Estado"].map((h) => (
            <th key={h} style={{
              textAlign: "left", padding: "8px 10px", color: COLORES.textoSuave2, fontWeight: 500,
              borderBottom: `1px solid ${COLORES.borde}`, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase",
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((r) => (
          <tr key={r.id}>
            <td style={{ padding: "9px 10px", borderBottom: `1px solid ${COLORES.bordeSuave}`, color: COLORES.verde }}>{r.id}</td>
            <td style={{ padding: "9px 10px", borderBottom: `1px solid ${COLORES.bordeSuave}`, color: COLORES.textoSuave }}>{r.fecha}</td>
            <td style={{ padding: "9px 10px", borderBottom: `1px solid ${COLORES.bordeSuave}`, color: COLORES.textoSuave }}>{r.hora}</td>
            <td style={{ padding: "9px 10px", borderBottom: `1px solid ${COLORES.bordeSuave}`, color: COLORES.texto }}>{r.solicitado.toFixed(2)} mL</td>
            <td style={{ padding: "9px 10px", borderBottom: `1px solid ${COLORES.bordeSuave}`, color: COLORES.texto }}>{r.final.toFixed(2)} mL</td>
            <td style={{ padding: "9px 10px", borderBottom: `1px solid ${COLORES.bordeSuave}`, color: r.error <= 5 ? COLORES.exito : COLORES.peligro, fontWeight: 700 }}>{r.error.toFixed(1)}%</td>
            {!compacto && <td style={{ padding: "9px 10px", borderBottom: `1px solid ${COLORES.bordeSuave}`, color: COLORES.textoSuave }}>{r.tLlenado.toFixed(1)} s</td>}
            {!compacto && <td style={{ padding: "9px 10px", borderBottom: `1px solid ${COLORES.bordeSuave}`, color: COLORES.textoSuave }}>{r.tEstab.toFixed(1)} s</td>}
            {compacto && <td style={{ padding: "9px 10px", borderBottom: `1px solid ${COLORES.bordeSuave}` }}></td>}
            {compacto && <td style={{ padding: "9px 10px", borderBottom: `1px solid ${COLORES.bordeSuave}` }}></td>}
            <td style={{ padding: "9px 10px", borderBottom: `1px solid ${COLORES.bordeSuave}` }}>
              <span style={{
                padding: "2.5px 9px", borderRadius: 20, fontSize: 10.5, fontWeight: 700,
                background: r.estado === "Exitoso" ? COLORES.verdeSuave : COLORES.rojoSuave,
                color: r.estado === "Exitoso" ? COLORES.exito : COLORES.peligro,
              }}>{r.estado}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Historial() {
  return (
    <Panel
      prefijo={`${HISTORIAL_INICIAL.length} registros`}
      titulo="Historial de dosificaciones"
      extra={
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 7,
            border: `1px solid ${COLORES.borde}`, background: "transparent", color: COLORES.textoSuave,
            fontFamily: FUENTE_DATOS, fontSize: 11.5, cursor: "pointer",
          }}><Download size={13} /> CSV</button>
          <button style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 7,
            border: `1px solid ${COLORES.borde}`, background: "transparent", color: COLORES.textoSuave,
            fontFamily: FUENTE_DATOS, fontSize: 11.5, cursor: "pointer",
          }}><FileSpreadsheet size={13} /> XLSX</button>
        </div>
      }
    >
      <TablaHistorial filas={HISTORIAL_INICIAL} />
    </Panel>
  );
}

/* ---------------------------------------------------------------
   GRÁFICAS
----------------------------------------------------------------*/

function Graficas() {
  const [seleccionado, setSeleccionado] = useState(HISTORIAL_INICIAL[0].id);
  const fila = HISTORIAL_INICIAL.find((r) => r.id === seleccionado);

  const datos = useMemo(() => {
    const puntos = [];
    const tLlenado = fila.tLlenado, tEstab = fila.tEstab;
    for (let t = 0; t <= tLlenado; t += tLlenado / 14) {
      puntos.push({ t: Number(t.toFixed(2)), v: Number((fila.final * (t / tLlenado) * (0.9 + 0.1 * Math.random())).toFixed(3)) });
    }
    puntos.push({ t: Number(tLlenado.toFixed(2)), v: fila.solicitado * 0.985 });
    for (let t = 0; t <= tEstab; t += tEstab / 10) {
      const progreso = t / tEstab;
      puntos.push({ t: Number((tLlenado + t).toFixed(2)), v: Number((fila.solicitado * 0.985 + (fila.final - fila.solicitado * 0.985) * progreso).toFixed(3)) });
    }
    return puntos;
  }, [fila]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel
        prefijo="Selecciona una prueba"
        titulo="Gráficas históricas"
        extra={
          <select value={seleccionado} onChange={(e) => setSeleccionado(e.target.value)} style={{
            background: COLORES.panelSuave, border: `1px solid ${COLORES.borde}`, borderRadius: 6,
            color: COLORES.texto, fontFamily: FUENTE_DATOS, fontSize: 12, padding: "7px 10px",
          }}>
            {HISTORIAL_INICIAL.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.solicitado.toFixed(2)} mL</option>)}
          </select>
        }
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={datos}>
            <CartesianGrid stroke={COLORES.bordeSuave} vertical={false} />
            <XAxis dataKey="t" tick={{ fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} label={{ value: "Tiempo (s)", position: "insideBottom", offset: -4, fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} stroke={COLORES.borde} />
            <YAxis tick={{ fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} label={{ value: "Volumen (mL)", angle: -90, position: "insideLeft", fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} stroke={COLORES.borde} />
            <Tooltip contentStyle={{ background: COLORES.panelSuave, border: `1px solid ${COLORES.borde}`, borderRadius: 6, fontFamily: FUENTE_DATOS, fontSize: 11 }} labelStyle={{ color: COLORES.textoSuave }} />
            <ReferenceLine x={fila.tLlenado} stroke={COLORES.rojo} strokeDasharray="4 4" label={{ value: "Bomba detenida", fill: COLORES.rojo, fontFamily: FUENTE_DATOS, fontSize: 10, position: "top" }} />
            <ReferenceLine y={fila.solicitado} stroke={COLORES.texto} strokeOpacity={0.4} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="v" stroke={COLORES.verde} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        <Metrica etiqueta="Solicitado" valor={fila.solicitado.toFixed(2)} unidad="mL" />
        <Metrica etiqueta="Final" valor={fila.final.toFixed(2)} unidad="mL" />
        <Metrica etiqueta="Error" valor={fila.error.toFixed(1)} unidad="%" color={fila.error <= 5 ? COLORES.exito : COLORES.peligro} />
        <Metrica etiqueta="Tiempo total" valor={(fila.tLlenado + fila.tEstab).toFixed(1)} unidad="s" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   CALIBRACIÓN
----------------------------------------------------------------*/

function Calibracion() {
  const [puntos, setPuntos] = useState(CALIBRACION_INICIAL);

  function agregarPunto() {
    const nuevoId = Math.max(...puntos.map((p) => p.id)) + 1;
    setPuntos([...puntos, { id: nuevoId, lectura: 600, volumen: 500 }]);
  }
  function eliminarPunto(id) {
    setPuntos(puntos.filter((p) => p.id !== id));
  }
  function actualizarPunto(id, campo, valor) {
    setPuntos(puntos.map((p) => (p.id === id ? { ...p, [campo]: Number(valor) } : p)));
  }

  const ordenados = [...puntos].sort((a, b) => a.volumen - b.volumen);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      <Panel
        prefijo="Puntos de calibración"
        titulo="Lectura del sensor vs volumen real"
        extra={
          <button onClick={agregarPunto} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 7,
            border: `1px solid ${COLORES.borde}`, background: "transparent", color: COLORES.verde,
            fontFamily: FUENTE_DATOS, fontSize: 11.5, cursor: "pointer",
          }}><Plus size={13} /> Agregar punto</button>
        }
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FUENTE_DATOS, fontSize: 12.5 }}>
          <thead>
            <tr>
              {["Lectura sensor", "Volumen real (mL)", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 6px", color: COLORES.textoSuave2, fontSize: 10.5, borderBottom: `1px solid ${COLORES.borde}`, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {puntos.map((p) => (
              <tr key={p.id}>
                <td style={{ padding: "7px 6px", borderBottom: `1px solid ${COLORES.bordeSuave}` }}>
                  <input value={p.lectura} onChange={(e) => actualizarPunto(p.id, "lectura", e.target.value)} style={{
                    width: 70, background: COLORES.panelSuave, border: `1px solid ${COLORES.borde}`, borderRadius: 5,
                    color: COLORES.texto, fontFamily: FUENTE_DATOS, fontSize: 12, padding: "5px 8px",
                  }} />
                </td>
                <td style={{ padding: "7px 6px", borderBottom: `1px solid ${COLORES.bordeSuave}` }}>
                  <input value={p.volumen} onChange={(e) => actualizarPunto(p.id, "volumen", e.target.value)} style={{
                    width: 70, background: COLORES.panelSuave, border: `1px solid ${COLORES.borde}`, borderRadius: 5,
                    color: COLORES.texto, fontFamily: FUENTE_DATOS, fontSize: 12, padding: "5px 8px",
                  }} />
                </td>
                <td style={{ padding: "7px 6px", borderBottom: `1px solid ${COLORES.bordeSuave}`, textAlign: "right" }}>
                  <button onClick={() => eliminarPunto(p.id)} style={{ background: "transparent", border: "none", color: COLORES.peligro, cursor: "pointer" }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel prefijo="Curva de calibración" titulo="Lectura vs volumen">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={ordenados}>
            <CartesianGrid stroke={COLORES.bordeSuave} vertical={false} />
            <XAxis dataKey="volumen" tick={{ fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} label={{ value: "Volumen real (mL)", position: "insideBottom", offset: -4, fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} stroke={COLORES.borde} />
            <YAxis dataKey="lectura" tick={{ fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} label={{ value: "Lectura sensor", angle: -90, position: "insideLeft", fill: COLORES.textoSuave2, fontFamily: FUENTE_DATOS, fontSize: 10 }} stroke={COLORES.borde} />
            <Tooltip contentStyle={{ background: COLORES.panelSuave, border: `1px solid ${COLORES.borde}`, borderRadius: 6, fontFamily: FUENTE_DATOS, fontSize: 11 }} labelStyle={{ color: COLORES.textoSuave }} />
            <Line type="monotone" dataKey="lectura" stroke={COLORES.verde} strokeWidth={2} dot={{ r: 4, fill: COLORES.verde }} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------
   CONFIGURACIÓN
----------------------------------------------------------------*/

function CampoConfig({ etiqueta, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: FUENTE_DATOS, fontSize: 11, color: COLORES.textoSuave2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 7 }}>{etiqueta}</div>
      {children}
    </div>
  );
}

function Configuracion({ infoDispositivo }) {
  const estiloEntrada = {
    width: "100%", background: COLORES.panelSuave, border: `1px solid ${COLORES.borde}`, borderRadius: 7,
    color: COLORES.texto, fontFamily: FUENTE_DATOS, fontSize: 13, padding: "10px 12px", boxSizing: "border-box",
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      <Panel prefijo="Comunicación" titulo="Conexión serial">
        <CampoConfig etiqueta="Puerto"><input key={infoDispositivo.puerto} defaultValue={infoDispositivo.puerto} style={estiloEntrada} readOnly /></CampoConfig>
        <CampoConfig etiqueta="Baud rate"><input key={infoDispositivo.baudios} defaultValue={infoDispositivo.baudios} style={estiloEntrada} readOnly /></CampoConfig>
        <CampoConfig etiqueta="Reconexión automática">
          <div style={{ display: "flex", gap: 10 }}>
            <ChipEstado ok etiqueta="Activada" textoOk="Sí" />
          </div>
        </CampoConfig>
      </Panel>
      <Panel prefijo="Proceso" titulo="Parámetros de dosificación">
        <CampoConfig etiqueta="Volumen mínimo permitido"><input defaultValue={`${VOLUMEN_MINIMO_ML} mL`} style={estiloEntrada} readOnly /></CampoConfig>
        <CampoConfig etiqueta="Volumen máximo permitido"><input defaultValue={`${VOLUMEN_MAXIMO_ML} mL`} style={estiloEntrada} readOnly /></CampoConfig>
        <CampoConfig etiqueta="Umbral de error aceptable"><input defaultValue="5.0 %" style={estiloEntrada} /></CampoConfig>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------
   APLICACIÓN PRINCIPAL
----------------------------------------------------------------*/

export default function AplicacionLiquidFlow() {
  const [vista, setVista] = useState("nueva");
  const { conectado, ultimaLectura, ultimoEvento, infoDispositivo, dosificar, detener } = usePuenteArduino();

  return (
    <div style={{
      display: "flex", width: "100%", minHeight: "100vh", background: COLORES.fondo, color: COLORES.texto,
      fontFamily: FUENTE_TITULO,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        html, body, #root { margin: 0; padding: 0; height: 100%; width: 100%; }
        * { box-sizing: border-box; }
        input:focus { outline: 1px solid ${COLORES.verde}; }
        select:focus { outline: 1px solid ${COLORES.verde}; }
      `}</style>

      {/* BARRA LATERAL */}
      <div style={{
        width: 232, flexShrink: 0, background: BARRA_FONDO, borderRight: `1px solid ${BARRA_BORDE}`,
        display: "flex", flexDirection: "column", padding: "20px 14px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px", marginBottom: 28 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7, background: COLORES.verdeSuave,
            display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${BORDE_CHIP_VERDE}`,
          }}>
            <Droplets size={16} color={COLORES.verde} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.3, color: BARRA_TEXTO }}>LiquidFlow</div>
            <div style={{ fontFamily: FUENTE_DATOS, fontSize: 9, color: BARRA_TEXTO_SUAVE, letterSpacing: 0.5 }}>SISTEMA DE DOSIFICACIÓN</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
          {ELEMENTOS_NAV.map((elemento) => {
            const Icono = elemento.icono;
            const activo = vista === elemento.id;
            return (
              <button
                key={elemento.id}
                onClick={() => setVista(elemento.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 7,
                  border: "none", cursor: "pointer", textAlign: "left",
                  background: activo ? COLORES.verdeSuave : "transparent",
                  color: activo ? COLORES.verde : BARRA_TEXTO_SUAVE,
                  fontFamily: FUENTE_TITULO, fontSize: 13, fontWeight: activo ? 600 : 500,
                }}
              >
                <Icono size={16} />
                {elemento.etiqueta}
              </button>
            );
          })}
        </div>

        <div style={{
          marginTop: 12, padding: "11px 12px", borderRadius: 8,
          background: conectado ? COLORES.verdeSuave : COLORES.rojoSuave,
          border: `1px solid ${conectado ? BORDE_CHIP_VERDE : BORDE_CHIP_ROJO}`,
          display: "flex", alignItems: "center", gap: 9,
        }}>
          {conectado ? <Wifi size={15} color={COLORES.verde} /> : <WifiOff size={15} color={COLORES.peligro} />}
          <div>
            <div style={{ fontFamily: FUENTE_DATOS, fontSize: 11.5, fontWeight: 700, color: conectado ? COLORES.verde : COLORES.peligro }}>
              {conectado ? "Arduino conectado" : "Arduino desconectado"}
            </div>
            <div style={{ fontFamily: FUENTE_DATOS, fontSize: 9.5, color: COLORES.textoSuave2 }}>{infoDispositivo.puerto} · {infoDispositivo.baudios} baud</div>
          </div>
        </div>
      </div>

      {/* CONTENIDO PRINCIPAL */}
      <div style={{ flex: 1, padding: "22px 26px", overflow: "auto" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: FUENTE_DATOS, fontSize: 11, color: COLORES.textoSuave2, letterSpacing: 1, textTransform: "uppercase" }}>
            LiquidFlow / {ELEMENTOS_NAV.find((n) => n.id === vista)?.etiqueta}
          </div>
        </div>

        {vista === "dashboard" && <Dashboard irANueva={() => setVista("nueva")} conectado={conectado} infoDispositivo={infoDispositivo} />}
        {vista === "nueva" && (
          <NuevaDosificacion
            conectado={conectado}
            ultimaLectura={ultimaLectura}
            ultimoEvento={ultimoEvento}
            dosificar={dosificar}
            detener={detener}
          />
        )}
        {vista === "historial" && <Historial />}
        {vista === "graficas" && <Graficas />}
        {vista === "calibracion" && <Calibracion />}
        {vista === "config" && <Configuracion infoDispositivo={infoDispositivo} />}
      </div>
    </div>
  );
}