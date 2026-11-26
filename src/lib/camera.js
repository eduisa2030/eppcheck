const STORAGE_KEY = 'eppcheck_camera_facing'

export function isLikelyMobile(ua = '', maxTouchPoints = 0, platform = '') {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true
  return platform === 'MacIntel' && maxTouchPoints > 1
}

function browserIsMobile() {
  if (typeof navigator === 'undefined') return false
  return isLikelyMobile(navigator.userAgent || '', navigator.maxTouchPoints || 0, navigator.platform || '')
}

function storageOr(storage) {
  if (storage) return storage
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

/** Última cámara elegida. En el celular, si no hay elección, la trasera. */
export function loadFacingPreference(storage, mobile = browserIsMobile()) {
  try {
    const value = storageOr(storage)?.getItem(STORAGE_KEY)
    if (value === 'user' || value === 'environment') return value
  } catch {}
  return mobile ? 'environment' : 'user'
}

export function saveFacingPreference(facing, storage) {
  if (facing !== 'user' && facing !== 'environment') return
  try {
    storageOr(storage)?.setItem(STORAGE_KEY, facing)
  } catch {}
}

export function flipFacing(facing) {
  return facing === 'environment' ? 'user' : 'environment'
}

/**
 * El facingMode a veces se ignora (un escritorio con una webcam devuelve
 * la misma cámara). En ese caso hay que pasar al siguiente deviceId.
 */
export function acceptFacingAttempt({ requested, reportedFacing, deviceId, previousDeviceId, switching }) {
  if (reportedFacing === requested) return true
  if (switching && previousDeviceId && deviceId && deviceId === previousDeviceId) return false
  if (reportedFacing && reportedFacing !== requested) return false
  // Sin facingMode reportado no sabemos si el cambio ocurrió: hay que ciclar deviceId.
  if (switching && !reportedFacing) return false
  return true
}

export function nextDeviceId(devices, { previousDeviceId, facing } = {}) {
  const inputs = (devices || []).filter(device => device?.deviceId)
  if (!inputs.length) return null
  if (previousDeviceId) {
    const current = inputs.findIndex(device => device.deviceId === previousDeviceId)
    if (current >= 0) return inputs[(current + 1) % inputs.length].deviceId
  }
  const hint = facing === 'environment'
    ? /back|rear|environment|trasera|posterior|world/i
    : /front|user|face|delantera|frontal|facetime/i
  const hinted = inputs.find(device => hint.test(device.label || ''))
  return (hinted || inputs[0]).deviceId
}

export function trackFacing(stream) {
  const track = stream?.getVideoTracks?.()[0]
  const settings = track?.getSettings?.() || {}
  return {
    deviceId: settings.deviceId || null,
    facingMode: settings.facingMode || null,
  }
}

export function stopStream(stream) {
  stream?.getTracks?.().forEach(track => {
    try { track.stop() } catch {}
  })
}

export async function videoInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter(device => device.kind === 'videoinput' && device.deviceId)
}

async function getFacingStream(facing) {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing },
    audio: false,
  })
}

async function getDeviceStream(deviceId) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    })
  } catch {
    return navigator.mediaDevices.getUserMedia({
      video: { deviceId },
      audio: false,
    })
  }
}

/**
 * Abre la cámara pedida. Si facingMode falla, recorre los videoinput por deviceId.
 */
export async function openCamera({ facing = 'user', previousDeviceId = null, switching = false } = {}) {
  const requested = facing === 'environment' ? 'environment' : 'user'
  let facingError = null

  try {
    const stream = await getFacingStream(requested)
    const info = trackFacing(stream)
    const ok = acceptFacingAttempt({
      requested,
      reportedFacing: info.facingMode,
      deviceId: info.deviceId,
      previousDeviceId,
      switching,
    })
    if (ok) return { stream, facing: info.facingMode || requested, deviceId: info.deviceId }
    stopStream(stream)
  } catch (err) {
    facingError = err
  }

  const inputs = await videoInputs()
  if (switching && inputs.length < 2) {
    throw facingError || new Error('Solo hay una cámara')
  }
  const deviceId = nextDeviceId(inputs, {
    previousDeviceId: switching ? previousDeviceId : null,
    facing: requested,
  })
  if (!deviceId) {
    if (switching) throw facingError || new Error('No se pudo cambiar de cámara')
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    const info = trackFacing(stream)
    return { stream, facing: info.facingMode || requested, deviceId: info.deviceId }
  }

  const stream = await getDeviceStream(deviceId)
  const info = trackFacing(stream)
  return { stream, facing: info.facingMode || requested, deviceId: info.deviceId || deviceId }
}

/** Foto JPEG del cuadro actual del <video>. */
export function captureVideoFrame(video, { mirrored = false, quality = 0.85 } = {}) {
  if (!video || !video.videoWidth || !video.videoHeight) return null
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (mirrored) {
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(video, 0, 0)
  return canvas.toDataURL('image/jpeg', quality)
}
