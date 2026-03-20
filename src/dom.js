/**
 * dom.js — DOM / Mount Layer
 *
 * Verantwortlich für:
 *   - Ziel-Element ermitteln (target-Selektor oder body)
 *   - Overlay-DIV erzeugen (Modus A: wie bisher)
 *   - Wrapper-Struktur erzeugen (Modus C: mit Close-Button etc.)
 *   - Mount-Bereich bereitstellen, in den die Engine rendert
 *   - Alles sauber wieder entfernen ohne DOM-Leichen
 *
 * Styling-Philosophie:
 *   Inline-Styles werden nur für funktional nötige Dinge gesetzt
 *   (position, overflow, pointer-events). Alles Optische läuft
 *   über Klassen — der Nutzer stylt per CSS.
 *
 * Multi-Instanz:
 *   IDs werden pro Instanz eindeutig generiert (Zähler-Suffix).
 *   Klassen bleiben stabil und global — darüber wird gestylt.
 *
 * @internal — nicht direkt importieren, wird von index.js genutzt
 */

// Instanz-Zähler für eindeutige IDs bei Mehrfach-Nutzung
let instanceCounter = 0;

// ─── Standard-Klassennamen (stabil, zum Stylen) ──────────────────
const CLASS = {
  root: "curtain-dropper-root",
  inner: "curtain-dropper-inner",
  mount: "curtain-dropper-mount",
  close: "curtain-dropper-close",
  backdrop: "curtain-dropper-backdrop",
};

// ─── Position-Presets (nur funktionale CSS-Werte) ────────────────
var POSITION_STYLES = {
  center: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
  },
  "top-center": {
    position: "fixed",
    top: "0",
    left: "50%",
    transform: "translateX(-50%)",
  },
  "top-right": {
    position: "fixed",
    top: "0",
    right: "0",
  },
  "bottom-right": {
    position: "fixed",
    bottom: "0",
    right: "0",
  },
  "bottom-center": {
    position: "fixed",
    bottom: "0",
    left: "50%",
    transform: "translateX(-50%)",
  },
  overlay: {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
  },
};

/**
 * Generiert eine eindeutige ID pro Instanz.
 * Format: "curtain-dropper-root-1", "curtain-dropper-mount-2" etc.
 */
function uid(base) {
  return base + "-" + instanceCounter;
}

/**
 * Baut eine Klassen-Liste aus Standard-Klasse + optionaler Custom-Klasse.
 */
function cls(standard, custom) {
  return [standard, custom].filter(Boolean).join(" ");
}

/**
 * Löst das Ziel-Element auf.
 *
 * @param {string|HTMLElement|null} target — CSS-Selektor, Element oder null
 * @returns {HTMLElement|null}
 */
export function resolveTarget(target) {
  if (!target) return null;
  if (typeof target === "string") {
    var el = document.querySelector(target);
    if (!el) {
      console.warn('[CurtainDropper] Ziel-Element nicht gefunden: "' + target + '"');
    }
    return el;
  }
  if (target instanceof HTMLElement) return target;
  return null;
}

/**
 * Modus A: Erzeugt ein einfaches Overlay-DIV (wie bisher).
 * Vollbild, fixed, transparent, pointer-events: none, z-index hoch.
 *
 * @returns {{ root: HTMLElement, mount: HTMLElement, close: null, teardown: Function }}
 */
export function createOverlay() {
  instanceCounter++;
  var root = document.createElement("div");
  root.id = uid("curtain-dropper-root");
  root.className = CLASS.root;
  Object.assign(root.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "999999",
    pointerEvents: "none",
    overflow: "hidden",
  });
  document.body.appendChild(root);

  return {
    root: root,
    mount: root,
    close: null,
    teardown: function() {
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/**
 * Modus B: Nutzt ein bestehendes DOM-Element als Mount-Punkt.
 *
 * @param {HTMLElement} targetEl
 * @returns {{ root: HTMLElement, mount: HTMLElement, close: null, teardown: Function }}
 */
export function mountInTarget(targetEl) {
  instanceCounter++;
  var mount = document.createElement("div");
  mount.id = uid("curtain-dropper-mount");
  mount.className = CLASS.mount;
  Object.assign(mount.style, {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    position: "relative",
  });
  targetEl.appendChild(mount);

  return {
    root: targetEl,
    mount: mount,
    close: null,
    teardown: function() {
      if (mount.parentNode) mount.parentNode.removeChild(mount);
    },
  };
}

/**
 * Modus C: Erzeugt eine vollständige Wrapper-Struktur.
 *
 * DOM-Struktur:
 *   <div class="curtain-dropper-root [custom]" id="curtain-dropper-root-N">
 *     <div class="curtain-dropper-backdrop"></div>          (optional)
 *     <div class="curtain-dropper-inner [custom]" id="curtain-dropper-inner-N">
 *       <button class="curtain-dropper-close [custom]">×</button>  (optional)
 *       <div class="curtain-dropper-mount [custom]" id="curtain-dropper-mount-N"></div>
 *     </div>
 *   </div>
 *
 * Inline-Styles: nur funktional (position, overflow, pointer-events, z-index).
 * Optik (Farben, Größen, Abstände) kommt über die Klassen per CSS.
 *
 * @param {Object} config — Wrapper-Konfiguration
 * @param {HTMLElement|null} parentEl — Eltern-Element (null = body)
 * @returns {{ root, mount, close, teardown }}
 */
export function createWrapper(config, parentEl) {
  instanceCounter++;
  var cfg = config || {};

  // ── Root ──
  var root = document.createElement("div");
  root.id = uid("curtain-dropper-root");
  root.className = cls(CLASS.root, cfg.className);
  var posStyles = POSITION_STYLES[cfg.position] || POSITION_STYLES.overlay;
  Object.assign(root.style, posStyles, {
    zIndex: "999999",
    overflow: "hidden",
  });

  // ── Backdrop (optional, VOR inner, OHNE negatives z-index) ──
  if (cfg.useBackdrop) {
    var backdrop = document.createElement("div");
    backdrop.className = CLASS.backdrop;
    Object.assign(backdrop.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
    });
    root.appendChild(backdrop);
  }

  // ── Inner ──
  var inner = document.createElement("div");
  inner.id = uid("curtain-dropper-inner");
  inner.className = cls(CLASS.inner, cfg.innerClassName);
  Object.assign(inner.style, {
    position: "relative",
    width: "100%",
    height: "100%",
  });
  root.appendChild(inner);

  // ── Close-Button (optional) ──
  var closeBtn = null;
  if (cfg.closable) {
    closeBtn = document.createElement("button");
    closeBtn.className = cls(CLASS.close, cfg.closeClassName);
    closeBtn.textContent = cfg.closeText || "\u00d7";
    closeBtn.setAttribute("aria-label", "Schließen");
    closeBtn.setAttribute("type", "button");
    // Nur funktionale Styles — Optik per CSS (.curtain-dropper-close)
    Object.assign(closeBtn.style, {
      position: "absolute",
      zIndex: "10",
      cursor: "pointer",
      pointerEvents: "auto",
    });
    inner.appendChild(closeBtn);
  }

  // ── Mount-Bereich ──
  var mount = document.createElement("div");
  mount.id = uid("curtain-dropper-mount");
  mount.className = cls(CLASS.mount, cfg.mountClassName);
  Object.assign(mount.style, {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    pointerEvents: "none",
  });
  inner.appendChild(mount);

  // ── Ins DOM hängen ──
  var parent = parentEl || document.body;
  parent.appendChild(root);

  return {
    root: root,
    mount: mount,
    close: closeBtn,
    teardown: function() {
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
