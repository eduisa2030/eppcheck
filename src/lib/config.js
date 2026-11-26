/**
 * Modelos de Teachable Machine.
 * Para cambiar un modelo, edita solo MODELS.
 * La URL es la carpeta del modelo (con o sin "/" final),
 * servida desde este mismo sitio en /models/<id>/;
 * la app carga <url>model.json y <url>metadata.json.
 * Una cadena vacía deja el elemento fuera del cumplimiento
 * y lo muestra como "Sin modelo aún".
 */
export const MODELS = {
  casco: './models/CipT7kvYx/',
  lentes: './models/JpOoTGgap/',
  chaleco: './models/Lmhs4iwPb/',
  guantes: './models/-r8T3LHey/',
}

// Una sola lectura no cambia el estado: ventana ~1.3 s y banda de histéresis.
export const SMOOTHING = {
  windowMs: 1300,
  onThreshold: 0.75,
  offThreshold: 0.4,
  loopMs: 200,
  malSinMargin: 0.15,
}

// Si el modelo dice "mal" pero "sin" está cerca y "bien" es bajo, se reporta sin.
export const CLASS_BIAS = {
  sinOverMal: 0.35,
  bienMaxWhenPreferSin: 0.3,
}

// Duración de cada fase del escaneo guiado.
export const SCAN = {
  latchMs: 1000,
  stepTimeoutMs: 10000,
  verifyMs: 2000,
  scanTimeoutMs: 60000,
  sinConfidence: 0.75,
}

export function hasModel(id) {
  return typeof MODELS[id] === 'string' && MODELS[id].trim().length > 0
}
