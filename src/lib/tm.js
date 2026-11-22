// Cargador de modelos Teachable Machine (TensorFlow.js)
let tmImage = null

export async function loadTM() {
  if (tmImage) return tmImage
  // Carga dinámica de la librería
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js')
  await loadScript('https://cdn.jsdelivr.net/npm/@teachablemachine/image@latest/dist/teachablemachine-image.min.js')
  tmImage = window.tmImage
  return tmImage
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = reject
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
