// Cargador de modelos Teachable Machine (TensorFlow.js).
// Versiones fijas: los modelos exportados usan tfjs-layers 1.7.4
// y @teachablemachine/image declara tfjs 1.3.1 como peer. 1.7.4 carga esos checkpoints.
const TFJS_SRC = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.7.4/dist/tf.min.js'
const TM_SRC = 'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js'

let tmImage = null

export async function loadTM() {
  if (tmImage) return tmImage
  await loadScript(TFJS_SRC)
  await loadScript(TM_SRC)
  tmImage = window.tmImage
  if (!tmImage) throw new Error('Teachable Machine (tmImage) no está cargado')
  return tmImage
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing?.dataset.loaded === '1') return resolve()
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), { once: true })
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.onload = () => {
      s.dataset.loaded = '1'
      resolve()
    }
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`))
    document.head.appendChild(s)
  })
}

export async function loadModel(url) {
  if (!url) return null
  const tm = await loadTM()
  const modelURL = url.endsWith('/') ? url + 'model.json' : url + '/model.json'
  const metadataURL = url.endsWith('/') ? url + 'metadata.json' : url + '/metadata.json'
  return await tm.load(modelURL, metadataURL)
}

export async function predict(model, imgElement) {
  if (!model) return null
  const predictions = await model.predict(imgElement)
  // Ordenar por probabilidad
  predictions.sort((a, b) => b.probability - a.probability)
  return predictions[0] // la clase más probable
}
