/*
  DOSIFICADOR DE AGUA - Arduino UNO
  (version modificada: acepta volumen variable + parada de emergencia real)

  Calibracion de bomba: 300 mL (aprox. 300 g de agua) en 71 778 ms.
  El tiempo determina el caudal de referencia y el sensor de nivel confirma
  el resultado. El recipiente se modela entre 0 y 1 300 mL.

  Comandos del monitor serial a 115200 baudios:
    <numero>  -> dosifica esa cantidad en mL (positivo = llenar, negativo = vaciar)
                 ej: "12.5" llena 12.5 mL, "-8" vacia 8 mL
    L         -> llenar 300 mL (atajo, igual que antes)
    V         -> vaciar 300 mL (atajo, igual que antes)
    S         -> PARADA DE EMERGENCIA: apaga la bomba de inmediato,
                 incluso si hay una dosificacion en curso

  CAMBIOS RESPECTO A LA VERSION ORIGINAL:
  - iniciarDosificacion() ahora recibe el volumen solicitado como parametro
    (dosisSolicitada_mL) en vez de usar siempre la constante dosisFija_mL.
  - procesarComando() ya no descarta el numero recibido: lo usa como volumen.
  - Se agrego el comando "S" que interrumpe la dosificacion en cualquier
    momento (antes, CUALQUIER comando se ignoraba mientras se dosificaba).

  IMPORTANTE: un solo pin no puede invertir por si mismo una bomba de CC.
  Para vaciar se necesita que la instalacion hidraulica/driver ya dirija la
  bomba para extraer agua (por ejemplo, otra bomba, una valvula, o un puente
  H). La funcion seleccionarSentido() es el unico punto que debe adaptarse a
  ese hardware. Nunca conectes una bomba directamente al pin del Arduino.
*/

#if defined(ESP32)
const int sensorPin = 35;
const int adcVacio = 1420;
const int adcLleno = 850;
#else
const int sensorPin = A0;
// Sustituye estos dos valores por la calibracion medida en tu Arduino UNO.
const int adcVacio = 800;
const int adcLleno = 450;
#endif

const int bombaPin = 8;

// --- Datos fisicos y calibracion solicitada ---
const float capacidadEnvase_mL = 1300.0;
const float dosisFija_mL = 300.0;          // usada solo por los atajos L/V
const float volumenMinimo_mL = 300.0;      // por debajo de esto el sensor no distingue el cambio de nivel
const float volumenMaximo_mL = 1000.0;     // limite superior de una sola dosis
const unsigned long tiempoCalibrado300_ms = 71778UL;
const float densidadAgua_g_mL = 1.0;

// 300 mL / 71.778 s = 4.1796 mL/s.
const float caudalInicial_mLs =
    dosisFija_mL * 1000.0 / (float)tiempoCalibrado300_ms;

// --- Filtro del sensor ---
const byte numMuestras = 9;
int muestras[numMuestras];
float valorFiltradoFinal = 0.0;
const float alpha = 0.25;

// --- Ajuste final ---
const float compensacionPostApagado_mL = 0.50;
const float margenPulso_mL = 1.20;
const float toleranciaFinal_mL = 0.15;
const unsigned long tiempoPulsoON_ms = 35;
const unsigned long tiempoPulsoOFF_ms = 150;
const unsigned long tiempoAsentamiento_ms = 700;
const float factorTiempoMaximo = 1.35;
const byte maxCorrecciones = 5;

enum Estado { ESPERA_COMANDO, DOSIFICANDO, ESPERANDO_ASENTAMIENTO, ERROR_SEGURIDAD };
enum Sentido { LLENAR = 1, VACIAR = -1 };

Estado estado = ESPERA_COMANDO;
Sentido sentido = LLENAR;

float volumenInicial_mL = 0.0;
float volumenObjetivo_mL = 0.0;
float dosisSolicitada_mL = dosisFija_mL;   // <-- NUEVO: volumen pedido en el comando actual
float caudalPromedio_mLs = caudalInicial_mLs;
float tiempoBombaObjetivo_ms = (float)tiempoCalibrado300_ms;
float tiempoBombaMaximo_ms = 0.0;

unsigned long tInicioProceso = 0;
unsigned long tApagado = 0;
unsigned long tUltimoCambioPulso = 0;
unsigned long tUltimoReporte = 0;
unsigned long tUltimaActualizacionBomba = 0;
unsigned long tiempoBombaEncendida_ms = 0;

bool bombaEncendida = false;
bool modoPulso = false;
byte correcciones = 0;

char bufferSerial[20];
byte indiceBuffer = 0;

void setup() {
  Serial.begin(115200);
  pinMode(bombaPin, OUTPUT);
  apagarBomba();

  valorFiltradoFinal = analogRead(sensorPin);

  Serial.println(F("=== DOSIFICADOR / ENVASE 1.3 L ==="));
  Serial.print(F("Bomba calibrada: "));
  Serial.print(tiempoCalibrado300_ms);
  Serial.print(F(" ms por 300 mL; caudal inicial: "));
  Serial.print(caudalInicial_mLs, 4);
  Serial.println(F(" mL/s"));
  Serial.println(F("Comandos: <numero mL> para dosificar (neg. = vaciar); L/V = 300 mL; S = parada de emergencia."));
}

void loop() {
  actualizarTiempoBomba();
  leerComandoSerial();

  float adcEstable = leerSensorDobleFiltro();
  float volumenActual_mL = adcAVolumen(adcEstable);

  if (millis() - tUltimoReporte >= 1000) {
    tUltimoReporte = millis();
    reportarMedicion(adcEstable, volumenActual_mL);
  }

  switch (estado) {
    case DOSIFICANDO:
      controlarDosificacion(volumenActual_mL);
      break;
    case ESPERANDO_ASENTAMIENTO:
      controlarAsentamiento(volumenActual_mL);
      break;
    case ESPERA_COMANDO:
    case ERROR_SEGURIDAD:
      break;
  }
}

void leerComandoSerial() {
  while (Serial.available() > 0) {
    char c = Serial.read();

    if (c == '\n' || c == '\r') {
      if (indiceBuffer > 0) {
        bufferSerial[indiceBuffer] = '\0';
        procesarComando(bufferSerial);
        indiceBuffer = 0;
      }
    } else if (indiceBuffer < sizeof(bufferSerial) - 1) {
      bufferSerial[indiceBuffer++] = c;
    }
  }
}

void procesarComando(const char *comando) {
  // La parada de emergencia se atiende SIEMPRE, incluso a mitad de una dosificacion.
  if (comando[0] == 'S' || comando[0] == 's') {
    detenerEmergencia();
    return;
  }

  if (estado == DOSIFICANDO || estado == ESPERANDO_ASENTAMIENTO) {
    Serial.println(F("Hay una dosificacion en curso; comando ignorado (usa S para detener)."));
    return;
  }

  if (comando[0] == 'L' || comando[0] == 'l') {
    iniciarDosificacion(LLENAR, dosisFija_mL);
    return;
  }
  if (comando[0] == 'V' || comando[0] == 'v') {
    iniciarDosificacion(VACIAR, dosisFija_mL);
    return;
  }

  float cantidad = atof(comando);
  if (cantidad >= volumenMinimo_mL) {
    iniciarDosificacion(LLENAR, cantidad);
  } else if (cantidad <= -volumenMinimo_mL) {
    iniciarDosificacion(VACIAR, fabs(cantidad));
  } else {
    Serial.println(F("Comando invalido. Usa un numero entre 300 y 1000 mL (ej. 500 o -650), L, V o S."));
  }
}

void detenerEmergencia() {
  apagarBomba();
  modoPulso = false;
  estado = ESPERA_COMANDO;
  Serial.println(F("PARADA DE EMERGENCIA: bomba detenida manualmente por el usuario."));
}

void iniciarDosificacion(Sentido nuevoSentido, float dosisRequerida_mL) {
  float volumenAhora_mL = adcAVolumen(leerSensorDobleFiltro());
  float objetivo = volumenAhora_mL + ((int)nuevoSentido * dosisRequerida_mL);

  if (dosisRequerida_mL < volumenMinimo_mL || dosisRequerida_mL > volumenMaximo_mL) {
    Serial.print(F("Volumen invalido. Debe estar entre "));
    Serial.print(volumenMinimo_mL, 0);
    Serial.print(F(" y "));
    Serial.print(volumenMaximo_mL, 0);
    Serial.println(F(" mL (el sensor no distingue cantidades menores a 300 mL)."));
    return;
  }
  if (objetivo > capacidadEnvase_mL + toleranciaFinal_mL) {
    Serial.print(F("No se puede llenar: se excede la capacidad de "));
    Serial.print(capacidadEnvase_mL, 0);
    Serial.println(F(" mL."));
    return;
  }
  if (objetivo < -toleranciaFinal_mL) {
    Serial.println(F("No se puede vaciar: el nivel actual es menor que el volumen solicitado."));
    return;
  }

  volumenInicial_mL = volumenAhora_mL;
  volumenObjetivo_mL = constrain(objetivo, 0.0, capacidadEnvase_mL);
  dosisSolicitada_mL = dosisRequerida_mL;
  sentido = nuevoSentido;
  tiempoBombaEncendida_ms = 0;
  tiempoBombaObjetivo_ms = dosisSolicitada_mL * 1000.0 / caudalPromedio_mLs;
  tiempoBombaMaximo_ms = tiempoBombaObjetivo_ms * factorTiempoMaximo + 3000.0;
  tInicioProceso = millis();
  tUltimoCambioPulso = tInicioProceso;
  correcciones = 0;
  modoPulso = false;
  estado = DOSIFICANDO;

  seleccionarSentido(sentido);

  Serial.println(F("-----------------------------------"));
  Serial.print(sentido == LLENAR ? F("Accion: LLENAR ") : F("Accion: VACIAR "));
  Serial.print(dosisSolicitada_mL, 2);
  Serial.println(F(" mL"));
  Serial.print(F("Nivel inicial: "));
  Serial.print(volumenInicial_mL, 2);
  Serial.print(F(" mL; objetivo: "));
  Serial.print(volumenObjetivo_mL, 2);
  Serial.println(F(" mL"));
  Serial.print(F("Tiempo de bomba esperado: "));
  Serial.print(tiempoBombaObjetivo_ms, 0);
  Serial.println(F(" ms"));

  encenderBomba();
}

void controlarDosificacion(float volumenActual_mL) {
  // Positivo significa que aun falta mover agua en el sentido solicitado.
  float restanteSensor_mL = (int)sentido * (volumenObjetivo_mL - volumenActual_mL);
  float entregadoPorTiempo_mL =
      caudalPromedio_mLs * ((float)tiempoBombaEncendida_ms / 1000.0);
  float restanteTiempo_mL = dosisSolicitada_mL - entregadoPorTiempo_mL;

  // Evita que una sonda desconectada o mal calibrada deje la bomba encendida.
  if ((float)tiempoBombaEncendida_ms >= tiempoBombaMaximo_ms) {
    apagarBomba();
    estado = ERROR_SEGURIDAD;
    Serial.println(F("ERROR: se alcanzo el tiempo maximo sin llegar al objetivo del sensor."));
    return;
  }

  // Se apaga antes del objetivo para compensar el agua que sigue en la tuberia.
  if (restanteSensor_mL <= compensacionPostApagado_mL) {
    apagarBomba();
    tApagado = millis();
    estado = ESPERANDO_ASENTAMIENTO;
    Serial.println(F("BOMBA DETENIDA - ESTABILIZANDO MEDICION"));
    return;
  }

  // El tiempo esperado es una segunda referencia: si el sensor tarda en
  // reaccionar, se entra a pulsos al acercarse por cualquiera de las dos vias.
  if (restanteSensor_mL <= margenPulso_mL || restanteTiempo_mL <= margenPulso_mL) {
    modoPulso = true;
    controlarPulsos();
    return;
  }

  modoPulso = false;
  if (!bombaEncendida) {
    encenderBomba();
  }
}

void controlarPulsos() {
  if (bombaEncendida) {
    if (millis() - tUltimoCambioPulso >= tiempoPulsoON_ms) {
      apagarBomba();
      tUltimoCambioPulso = millis();
    }
  } else if (millis() - tUltimoCambioPulso >= tiempoPulsoOFF_ms) {
    encenderBomba();
    tUltimoCambioPulso = millis();
  }
}

void controlarAsentamiento(float volumenActual_mL) {
  if (millis() - tApagado < tiempoAsentamiento_ms) {
    return;
  }

  float faltante_mL = (int)sentido * (volumenObjetivo_mL - volumenActual_mL);
  if (faltante_mL > toleranciaFinal_mL && correcciones < maxCorrecciones) {
    correcciones++;
    modoPulso = true;
    tUltimoCambioPulso = millis();
    estado = DOSIFICANDO;
    Serial.println(F("Correccion final: falta agua; reanudando con pulsos."));
    encenderBomba();
    return;
  }

  finalizarDosificacion(volumenActual_mL, faltante_mL);
}

void finalizarDosificacion(float volumenFinal_mL, float faltante_mL) {
  float movidoReal_mL = (int)sentido * (volumenFinal_mL - volumenInicial_mL);
  float segundosBomba = (float)tiempoBombaEncendida_ms / 1000.0;

  Serial.println(F("=== DOSIFICACION FINALIZADA ==="));
  Serial.print(F("Volumen solicitado: "));
  Serial.print(dosisSolicitada_mL, 2);
  Serial.println(F(" mL"));
  Serial.print(F("Nivel final: "));
  Serial.print(volumenFinal_mL, 2);
  Serial.println(F(" mL"));
  Serial.print(F("Agua movida segun sensor: "));
  Serial.print(movidoReal_mL, 2);
  Serial.println(F(" mL (g aproximadamente)"));
  Serial.print(F("Bomba encendida realmente: "));
  Serial.print(tiempoBombaEncendida_ms);
  Serial.println(F(" ms"));

  if (faltante_mL < -toleranciaFinal_mL) {
    Serial.print(F("Aviso: se sobrepaso el objetivo por "));
    Serial.print(-faltante_mL, 2);
    Serial.println(F(" mL."));
  } else if (faltante_mL > toleranciaFinal_mL) {
    Serial.print(F("Aviso: faltaron "));
    Serial.print(faltante_mL, 2);
    Serial.println(F(" mL despues de las correcciones."));
  }

  // El sensor corrige la siguiente estimacion de caudal con el resultado observado.
  if (segundosBomba > 0.1 && movidoReal_mL > 1.0) {
    float caudalReal_mLs = movidoReal_mL / segundosBomba;
    caudalPromedio_mLs = 0.85 * caudalPromedio_mLs + 0.15 * caudalReal_mLs;
    Serial.print(F("Caudal medido: "));
    Serial.print(caudalReal_mLs, 4);
    Serial.print(F(" mL/s; nuevo caudal: "));
    Serial.print(caudalPromedio_mLs, 4);
    Serial.println(F(" mL/s"));
  }

  Serial.println(F("-----------------------------------"));
  estado = ESPERA_COMANDO;
}

float leerSensorDobleFiltro() {
  for (byte i = 0; i < numMuestras; i++) {
    muestras[i] = analogRead(sensorPin);
    delay(2);
  }

  for (byte i = 0; i < numMuestras - 1; i++) {
    for (byte j = i + 1; j < numMuestras; j++) {
      if (muestras[i] > muestras[j]) {
        int temporal = muestras[i];
        muestras[i] = muestras[j];
        muestras[j] = temporal;
      }
    }
  }

  int mediana = muestras[numMuestras / 2];
  valorFiltradoFinal = alpha * mediana + (1.0 - alpha) * valorFiltradoFinal;
  return valorFiltradoFinal;
}

float adcAVolumen(float adcEstable) {
  float denominador = (float)(adcLleno - adcVacio);
  if (fabs(denominador) < 0.0001) {
    return 0.0;
  }

  float volumen = (adcEstable - adcVacio) * capacidadEnvase_mL / denominador;
  return constrain(volumen, 0.0, capacidadEnvase_mL);
}

void actualizarTiempoBomba() {
  if (bombaEncendida) {
    unsigned long ahora = millis();
    tiempoBombaEncendida_ms += ahora - tUltimaActualizacionBomba;
    tUltimaActualizacionBomba = ahora;
  }
}

void encenderBomba() {
  if (!bombaEncendida) {
    tUltimaActualizacionBomba = millis();
    digitalWrite(bombaPin, HIGH);  // Cambia a LOW si tu rele/MOSFET es activo en LOW.
    bombaEncendida = true;
  }
}

void apagarBomba() {
  if (bombaEncendida) {
    actualizarTiempoBomba();
  }
  digitalWrite(bombaPin, LOW);     // Cambia a HIGH si tu rele/MOSFET es activo en LOW.
  bombaEncendida = false;
}

void seleccionarSentido(Sentido nuevoSentido) {
  // Con una sola bomba de sentido fijo no hay nada que conmutar aqui.
  // Para vaciar, adapta esta funcion para activar tu valvula, segunda bomba
  // o pines de direccion del puente H. Mantiene la logica de seguridad comun.
  (void)nuevoSentido;
}

void reportarMedicion(float adcEstable, float volumenActual_mL) {
  Serial.print(F("ADC: "));
  Serial.print(adcEstable, 1);
  Serial.print(F(" | Nivel: "));
  Serial.print(volumenActual_mL, 1);
  Serial.print(F(" / "));
  Serial.print(capacidadEnvase_mL, 0);
  Serial.print(F(" mL | Masa: "));
  Serial.print(volumenActual_mL * densidadAgua_g_mL, 1);
  Serial.println(F(" g"));
}
