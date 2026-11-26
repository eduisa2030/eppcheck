const KEY = 'eppcheck_history'
const PLEDGES = 'eppcheck_declaraciones'

export function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

/** Guarda el escaneo. Si el teléfono se queda sin espacio, primero quita fotos viejas. */
export function saveScan(scan) {
  const history = getHistory()
  history.unshift({ ...scan, id: Date.now(), timestamp: scan.timestamp || new Date().toISOString() })
  let list = history.slice(0, 100)
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list))
      return list
    } catch {
      const keepPhotos = [20, 5, 1, 0][attempt]
      list = list.map((item, i) => (i < keepPhotos ? item : { ...item, foto: undefined }))
    }
  }
  return list
}

export function getPledges() {
  try {
    return JSON.parse(localStorage.getItem(PLEDGES) || '[]')
  } catch {
    return []
  }
}

/** Registro aparte de cada declaración aceptada (aunque el escaneo no se termine). */
export function savePledge(pledge) {
  const list = getPledges()
  list.unshift(pledge)
  try {
    localStorage.setItem(PLEDGES, JSON.stringify(list.slice(0, 500)))
  } catch {}
}
