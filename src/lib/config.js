/**
 * Modelos de Teachable Machine.
 * Para cambiar un modelo, edita solo MODELS.
 * La URL es la del modelo publicado (con o sin "/" final);
 * la app carga <url>model.json y <url>metadata.json.
 * Una cadena vacía deja el elemento fuera del cumplimiento
 * y lo muestra como "Sin modelo aún".
 */
export const MODELS = {
  casco: 'https://teachablemachine.withgoogle.com/models/CipT7kvYx/',
  lentes: 'https://teachablemachine.withgoogle.com/models/JpOoTGgap/',
  chaleco: 'https://teachablemachine.withgoogle.com/models/Lmhs4iwPb/',
  guantes: '',
}

// Una sola lectura no cambia el estado: ventana ~1.3 s y banda de histéresis.
export const SMOOTHING = {
  windowMs: 1300,
  onThreshold: 0.75,
  offThreshold: 0.4,
  loopMs: 200,
  malSinMargin: 0.15,
}

// Duración de cada fase del escaneo guiado.
export const SCAN = {
  latchMs: 1000,
  stepTimeoutMs: 10000,
  verifyMs: 2000,
  scanTimeoutMs: 30000,
  sinConfidence: 0.75,
}

export function hasModel(id) {
  return typeof MODELS[id] === 'string' && MODELS[id].trim().length > 0
}
