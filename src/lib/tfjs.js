// TensorFlow.js empaquetado solo con lo que usa la app: núcleo, capas y WebGL.
import * as core from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-backend-webgl'
// Respaldo si el teléfono no tiene WebGL (mucho más lento).
import '@tensorflow/tfjs-backend-cpu'
import { loadLayersModel } from '@tensorflow/tfjs-layers'

export const tf = { ...core, loadLayersModel }
