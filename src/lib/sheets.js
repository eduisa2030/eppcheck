export const USERS = [
  { user: 'safe_id_dereck', pass: 'dereck12345', name: 'Dereck', rol: 'operador' },
  { user: 'safe_id_elena', pass: 'elena12345', name: 'Elena', rol: 'operador' },
  { user: 'safe_id_eduardo', pass: 'eduardo12345', name: 'Eduardo', rol: 'operador' },
  { user: 'safe_id_samuel', pass: 'samuel12345', name: 'Samuel', rol: 'operador' },
  { user: 'safe_id_gustavo', pass: 'gustavo12345', name: 'Gustavo', rol: 'operador' },
  { user: 'safe_id_luz', pass: 'luz12345', name: 'Luz', rol: 'operador' },
]

export function validateUser(username, password) {
  return USERS.find(u => u.user === username && u.pass === password) || null
}
