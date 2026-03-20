/**
 * curtain-dropper — Öffentliche API
 *
 * Drei Modi:
 *   A) Overlay (Standard) — kein target, kein wrapper
 *   B) Mount in bestehendes Element — target angegeben
 *   C) Wrapper-Modus — wrapper: { enabled: true }
 *
 * Methoden:
 *   close()   — Versteckt das Widget (Engine läuft weiter). Ohne Wrapper: ruft destroy() auf.
 *   open()    — Zeigt ein verstecktes Widget wieder an (nur Wrapper-Modus).
 *   destroy() — Stoppt die Engine, räumt GPU + DOM komplett auf. Endgültig.
 */

import { startEngine } from "./engine.js";
import { resolveTarget, createOverlay, mountInTarget, createWrapper } from "./dom.js";

var DEFAULT_WRAPPER = {
  enabled: false,
  closable: false,
  closeText: "\u00d7",
  className: "",
  innerClassName: "",
  mountClassName: "",
  closeClassName: "",
  position: "overlay",
  useBackdrop: false,
};

function initCurtainDropper(options) {
  if (!options || !options.banner) {
    console.error("[CurtainDropper] Kein Banner angegeben. Bitte { banner: '...' } übergeben.");
    return createNullInstance();
  }

  // Wrapper-Config: Nutzer-Werte überschreiben Defaults.
  // enabled wird NICHT hart überschrieben — wenn der Nutzer enabled: false sagt, bleibt es false.
  var wrapperConfig;
  if (options.wrapper && typeof options.wrapper === "object") {
    wrapperConfig = {};
    for (var key in DEFAULT_WRAPPER) {
      wrapperConfig[key] = DEFAULT_WRAPPER[key];
    }
    for (var key2 in options.wrapper) {
      wrapperConfig[key2] = options.wrapper[key2];
    }
  } else {
    wrapperConfig = {};
    for (var key3 in DEFAULT_WRAPPER) {
      wrapperConfig[key3] = DEFAULT_WRAPPER[key3];
    }
  }

  // DOM aufbauen je nach Modus
  var dom;
  var targetEl = resolveTarget(options.target);

  if (wrapperConfig.enabled) {
    // Modus C: Wrapper-Struktur
    dom = createWrapper(wrapperConfig, targetEl);
  } else if (targetEl) {
    // Modus B: In bestehendes Element
    dom = mountInTarget(targetEl);
  } else {
    // Modus A: Einfaches Overlay
    dom = createOverlay();
  }

  // State
  var engineHandle = null;
  var isDestroyed = false;
  var isClosed = false;
  var closeHandler = null;

  // Engine starten
  engineHandle = startEngine(dom.mount, {
    timing: options.timing,
    banner: options.banner,
    size: options.size,
    corsProxy: options.corsProxy,
    onComplete: options.onComplete || null,
    onCleanup: function() {
      // GPU aufgeräumt — DOM entfernen wenn nicht schon passiert
      if (!isDestroyed) {
        dom.teardown();
        isDestroyed = true;
        if (options.onDestroy) options.onDestroy();
      }
    },
  });

  // Close-Button Event verdrahten (und Referenz merken für Cleanup)
  if (dom.close) {
    closeHandler = function() { instance.close(); };
    dom.close.addEventListener("click", closeHandler);
  }

  var instance = {
    /**
     * close() — Versteckt das Widget.
     *
     * Wrapper-Modus: Setzt display:none, Engine läuft im Hintergrund weiter.
     *   → open() zeigt es wieder an.
     *   → destroy() räumt dann endgültig auf.
     *
     * Ohne Wrapper (Overlay/Target): Ruft destroy() auf, da es kein
     *   sinnvolles "verstecken und wieder zeigen" gibt.
     */
    close: function() {
      if (isDestroyed) return;
      if (wrapperConfig.enabled && dom.root) {
        dom.root.style.display = "none";
        isClosed = true;
        if (options.onClose) options.onClose();
      } else {
        // Ohne Wrapper: close = destroy
        instance.destroy();
      }
    },

    /**
     * open() — Zeigt ein per close() verstecktes Widget wieder an.
     * Nur im Wrapper-Modus relevant. Im Overlay-Modus: kein Effekt.
     */
    open: function() {
      if (isDestroyed) return;
      if (wrapperConfig.enabled && dom.root) {
        dom.root.style.display = "";
        isClosed = false;
      }
    },

    /**
     * destroy() — Räumt alles endgültig auf.
     * Stoppt die Engine, gibt GPU-Ressourcen frei, entfernt DOM-Elemente,
     * löst Event-Listener. Danach ist die Instanz tot.
     */
    destroy: function() {
      if (isDestroyed) return;
      isDestroyed = true;
      // Event-Listener sauber entfernen
      if (dom.close && closeHandler) {
        dom.close.removeEventListener("click", closeHandler);
        closeHandler = null;
      }
      // Engine stoppen
      if (engineHandle) engineHandle.destroy();
      // DOM entfernen (kurzer Delay damit Engine-Loop noch sauber aussteigen kann)
      setTimeout(function() {
        dom.teardown();
        if (options.onDestroy) options.onDestroy();
      }, 120);
    },

    /** True wenn destroy() aufgerufen wurde. */
    get destroyed() { return isDestroyed; },

    /** True wenn das Widget sichtbar ist (nicht closed und nicht destroyed). */
    get visible() { return !isClosed && !isDestroyed; },

    /** Direkter Zugriff auf die DOM-Elemente für fortgeschrittenes Customizing. */
    get elements() {
      return { root: dom.root, mount: dom.mount, close: dom.close || null };
    },
  };

  return instance;
}

/**
 * Dummy-Instanz bei Fehlkonfiguration.
 * Alle Methoden sind No-Ops, damit Consumer-Code nicht crasht.
 */
function createNullInstance() {
  return {
    close: function() {},
    open: function() {},
    destroy: function() {},
    get destroyed() { return true; },
    get visible() { return false; },
    get elements() { return { root: null, mount: null, close: null }; },
  };
}

export var CurtainDropper = {
  init: initCurtainDropper,
};

export { initCurtainDropper as createCurtainDropper };
