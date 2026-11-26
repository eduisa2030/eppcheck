// Carga TensorFlow.js 4 (núcleo + capas + WebGL) como un trozo aparte del bundle,
// para que la pantalla aparezca sin esperarlo.
// Con WEBGL_USE_SHAPES_UNIFORMS los shaders no dependen del tamaño de cada capa,
// así que se compilan muchos menos al preparar el modelo.
let tfPromise = null

export function loadTf() {
  if (!tfPromise) {
    tfPromise = import('./tfjs.js').then(({ tf }) => {
      try { tf.env().set('WEBGL_USE_SHAPES_UNIFORMS', true) } catch {}
      return tf
    }).catch(err => {
      tfPromise = null
      throw err
    })
  }
  return tfPromise
}
