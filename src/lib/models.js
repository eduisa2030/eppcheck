// Configuración de clases por elemento
export const ITEM_CLASSES = {
  casco:   { bien: 'Bien puesto', mal: 'Mal puesto', sin: 'Sin casco' },
  lentes:  { bien: 'Bien puestos', mal: 'En mal estado', sin: 'Sin lentes' },
  chaleco: { bien: 'Bien puesto', mal: 'Mal puesto', sin: 'Sin chaleco' },
  guantes: { bien: 'Bien puestos', mal: 'Mal puestos', sin: 'Sin guantes' },
}

export const BODY_ITEMS = ['casco', 'lentes', 'chaleco']
export const HAND_ITEMS = ['guantes']
export const ITEMS = [...BODY_ITEMS, ...HAND_ITEMS]
