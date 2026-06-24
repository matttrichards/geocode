// SPDX-License-Identifier: Apache-2.0
// Minimal i18n for Geoloc — English + Spanish, auto-detected from the device
// language with a manual override persisted in localStorage. No framework.

const STR = {
  en: {
    search_ph: "Search a place or tap the map",
    layer_title: "Map / satellite",
    locate_title: "My location",
    shared_with_you: "Shared with you",
    get_directions: "Get directions",
    opens_no_app: "Opens in Google Maps or Waze — no app needed",
    send_feedback: "Send feedback",
    offline_kicker: "Location ready · offline",
    notfound_title: "We couldn't open that link",
    notfound_detail: "The code may be mistyped, expired, or outside a supported area. Double-check it with whoever shared it.",
    enter_manually: "Enter a code manually",
    share_own: "Or share my own location",
    enter_code: "Enter a code",
    empty_helper: "Most Geoloc links open straight to the place. Type a code here if you got it on a sign, a card, or by phone.",
    or: "OR",
    share_code: "Share my location as a code",
    mine_kicker: "Your current location",
    link_caption: "Send the link — it opens the place in any browser, no app required.",
    share_link: "Share link",
    copy_link: "Copy link",
    copy_code: "Copy code",
    install_text: "Share spots often? Add Geoloc to your home screen.",
    install_add: "Add",
    share: "Share",
    entry_kicker: "Enter a Geoloc code",
    region: "Region",
    entry_helper: "Type the 6 characters from the code you were sent.",
    handoff_title: "Open directions in…",
    handoff_web: "Open in browser maps instead",
    remember_label: "Always use this app on this phone",
    not_now: "Not now",
    default: "Default",
    whats_here: "What's here?",
    directions_here: "Directions to here",
    share_location: "Share this location",
    dropped_pin: "Dropped pin",
    search_result: "Search result",
    your_location: "Your location",
    note_tag: "Add a private note (optional)",
    note_ph: "e.g. Gate on the left, past the blue house",
    note_save: "Save for reuse",
    note_help: "Saved on this device — pick a different note per person.",
    note_del_aria: "Delete saved note",
    toast_loc_unavailable: "Location isn't available on this device",
    toast_locating: "Locating you…",
    toast_outside_area: "You're outside a supported area",
    toast_cant_code_here: "Couldn't make a code here",
    toast_enable_share: "Enable location to share your spot",
    toast_enable_use: "Enable location to use this",
    toast_spot_unsupported: "That spot isn't in a supported area yet",
    toast_cant_code_there: "Couldn't make a code there",
    toast_outside_supported: "Outside supported area",
    toast_coords_copied: "Coordinates copied",
    toast_cant_copy: "Couldn't copy",
    toast_code_copied: "Code copied",
    toast_link_copied: "Link copied",
    toast_cant_copy_link: "Couldn't copy link",
    toast_type_note: "Type a note first",
    toast_already_saved: "Already saved",
    toast_note_saved: "Note saved",
    toast_opening_waze: "Opening Waze…",
    toast_opening_web: "Opening maps in browser…",
    toast_opening_google: "Opening Google Maps…",
    precision_full: "Pinpoint · ~{m} m precision · {coords}",
    precision_meta: "~{m} m precision",
    precision_meta_title: "{title} · ~{m} m precision",
    offline_explainer: "Couldn't load the place name, but the pin is exact ({coords}). You can still get directions.",
    entry_err_chars: "That code has characters Geoloc doesn't use.",
    entry_err_invalid: "That code isn't valid here. Check it and try again.",
    dest_set: "{code} · destination set",
    share_title: "Geoloc location",
  },
  es: {
    search_ph: "Busca un lugar o toca el mapa",
    layer_title: "Mapa / satélite",
    locate_title: "Mi ubicación",
    shared_with_you: "Compartido contigo",
    get_directions: "Cómo llegar",
    opens_no_app: "Se abre en Google Maps o Waze — sin instalar nada",
    send_feedback: "Enviar comentarios",
    offline_kicker: "Ubicación lista · sin conexión",
    notfound_title: "No pudimos abrir ese enlace",
    notfound_detail: "El código puede estar mal escrito, vencido o fuera de un área compatible. Verifícalo con quien te lo compartió.",
    enter_manually: "Ingresar un código manualmente",
    share_own: "O compartir mi propia ubicación",
    enter_code: "Ingresa un código",
    empty_helper: "La mayoría de los enlaces de Geoloc abren directo en el lugar. Escribe un código aquí si lo recibiste en un rótulo, una tarjeta o por teléfono.",
    or: "O",
    share_code: "Compartir mi ubicación como código",
    mine_kicker: "Tu ubicación actual",
    link_caption: "Envía el enlace — abre el lugar en cualquier navegador, sin instalar nada.",
    share_link: "Compartir enlace",
    copy_link: "Copiar enlace",
    copy_code: "Copiar código",
    install_text: "¿Compartes lugares seguido? Agrega Geoloc a tu pantalla de inicio.",
    install_add: "Agregar",
    share: "Compartir",
    entry_kicker: "Ingresa un código Geoloc",
    region: "Región",
    entry_helper: "Escribe los 6 caracteres del código que te enviaron.",
    handoff_title: "Abrir indicaciones en…",
    handoff_web: "Mejor abrir en mapas del navegador",
    remember_label: "Usar siempre esta app en este teléfono",
    not_now: "Ahora no",
    default: "Predeterminado",
    whats_here: "¿Qué hay aquí?",
    directions_here: "Cómo llegar aquí",
    share_location: "Compartir esta ubicación",
    dropped_pin: "Pin colocado",
    search_result: "Resultado de búsqueda",
    your_location: "Tu ubicación",
    note_tag: "Agrega una nota privada (opcional)",
    note_ph: "ej. Portón a la izquierda, pasando la casa azul",
    note_save: "Guardar para reusar",
    note_help: "Se guarda en este dispositivo — elige una nota distinta por persona.",
    note_del_aria: "Eliminar nota guardada",
    toast_loc_unavailable: "La ubicación no está disponible en este dispositivo",
    toast_locating: "Ubicándote…",
    toast_outside_area: "Estás fuera de un área compatible",
    toast_cant_code_here: "No se pudo crear un código aquí",
    toast_enable_share: "Activa la ubicación para compartir tu lugar",
    toast_enable_use: "Activa la ubicación para usar esto",
    toast_spot_unsupported: "Ese lugar aún no está en un área compatible",
    toast_cant_code_there: "No se pudo crear un código ahí",
    toast_outside_supported: "Fuera del área compatible",
    toast_coords_copied: "Coordenadas copiadas",
    toast_cant_copy: "No se pudo copiar",
    toast_code_copied: "Código copiado",
    toast_link_copied: "Enlace copiado",
    toast_cant_copy_link: "No se pudo copiar el enlace",
    toast_type_note: "Escribe una nota primero",
    toast_already_saved: "Ya está guardada",
    toast_note_saved: "Nota guardada",
    toast_opening_waze: "Abriendo Waze…",
    toast_opening_web: "Abriendo mapas en el navegador…",
    toast_opening_google: "Abriendo Google Maps…",
    precision_full: "Exacto · ~{m} m de precisión · {coords}",
    precision_meta: "~{m} m de precisión",
    precision_meta_title: "{title} · ~{m} m de precisión",
    offline_explainer: "No se pudo cargar el nombre del lugar, pero el pin es exacto ({coords}). Aún puedes obtener indicaciones.",
    entry_err_chars: "Ese código tiene caracteres que Geoloc no usa.",
    entry_err_invalid: "Ese código no es válido aquí. Revísalo e intenta de nuevo.",
    dest_set: "{code} · destino fijado",
    share_title: "Ubicación de Geoloc",
  },
};

const LANG_KEY = "geoloc-lang";

function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "en" || saved === "es") return saved;
  } catch {}
  const nav = (navigator.language || (navigator.languages && navigator.languages[0]) || "en").toLowerCase();
  return nav.startsWith("es") ? "es" : "en";
}

// English-only: the app ships a single language and lets users' own device /
// browser translators handle anything else (no in-app toggle, no auto-detect).
let LANG = "en";

function getLang() { return LANG; }

function setLang(l) {
  LANG = (l === "es") ? "es" : "en";
  try { localStorage.setItem(LANG_KEY, LANG); } catch {}
  return LANG;
}

// Translate a key, interpolating {vars}. Falls back to English, then the key.
function t(key, vars) {
  let s = (STR[LANG] && STR[LANG][key]);
  if (s == null) s = (STR.en[key] != null ? STR.en[key] : key);
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}

// Apply translations to static DOM nodes carrying data-i18n* attributes.
function applyStaticI18n(root) {
  root = root || document;
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const v = t(el.getAttribute("data-i18n-title"));
    el.setAttribute("title", v);
    el.setAttribute("aria-label", v);
  });
  document.documentElement.lang = LANG;
}

export { t, getLang, setLang, applyStaticI18n, LANG_KEY };
