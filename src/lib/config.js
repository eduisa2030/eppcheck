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
  lentes: '',
  chaleco: 'https://teachablemachine.withgoogle.com/models/Em6vEGT1I/',
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

export function hasModel(id) {
  return typeof MODELS[id] === 'string' && MODELS[id].trim().length > 0
}
