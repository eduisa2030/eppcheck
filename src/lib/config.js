/**
 * Modelos de Teachable Machine.
 * Para cambiar un modelo: copia la carpeta exportada (model.json, metadata.json,
 * model.weights.bin) a models-src/<id>/, pon el id en models-src/models.json
 * y corre npm run build. scripts/split-models.mjs separa el extractor común
 * de la cabeza de cada pieza y genera src/lib/modelManifest.json.
 */

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
  // Tiempo seguido en «bien» para que la pieza quede validada sola.
  latchMs: 1000,
}

