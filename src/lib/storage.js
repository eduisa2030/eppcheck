const KEY = 'eppcheck_history'

export function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

export function saveScan(scan) {
  const history = getHistory()
  history.unshift({ ...scan, id: Date.now(), timestamp: new Date().toISOString() })
  localStorage.setItem(KEY, JSON.stringify(history.slice(0, 100)))
  return history
}
