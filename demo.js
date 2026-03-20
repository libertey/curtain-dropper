/**
 * Demo — 3er-Showcase: Desktop / Tablet / Mobile
 *
 * Testet gleichzeitig:
 *   - Drei parallele CurtainDropper-Instanzen
 *   - Verschiedene Containergrößen und Tuch-Formate
 *   - Landscape (Desktop/Tablet) und Portrait (Mobile)
 *   - Target-Modus (Modus B)
 *   - Restart / Destroy pro Instanz
 */
import { CurtainDropper } from "./src/index.js";

var configs = {
  desktop: {
    target: "#slot-desktop",
    banner: "/demo-assets/demo-desktop-1124x800.svg",
    size: { width: 1124, height: 800 },
    timing: { deploy: 2.2, hold: 8, fall: 2.5 },
  },
  tablet: {
    target: "#slot-tablet",
    banner: "/demo-assets/demo-tablet-900x600.svg",
    size: { width: 900, height: 600 },
    timing: { deploy: 2.0, hold: 8, fall: 2.0 },
  },
  mobile: {
    target: "#slot-mobile",
    banner: "/demo-assets/demo-mobile-390x560.svg",
    size: { width: 390, height: 560 },
    timing: { deploy: 1.8, hold: 8, fall: 1.8 },
  },
};

var instances = { desktop: null, tablet: null, mobile: null };

function start(key) {
  if (instances[key] && !instances[key].destroyed) {
    instances[key].destroy();
  }
  setTimeout(function() {
    var cfg = configs[key];
    instances[key] = CurtainDropper.init({
      target: cfg.target,
      banner: cfg.banner,
      size: cfg.size,
      timing: cfg.timing,
      onComplete: function() { console.log("[" + key + "] Animation fertig"); },
      onDestroy: function() { console.log("[" + key + "] Aufgeräumt"); },
    });
    console.log("[" + key + "] Gestartet — Tuch " + cfg.size.width + "×" + cfg.size.height);
  }, 150);
}

start("desktop");
setTimeout(function() { start("tablet"); }, 200);
setTimeout(function() { start("mobile"); }, 400);

window.actions = {
  desktop: {
    restart: function() { start("desktop"); },
    destroy: function() { if (instances.desktop && !instances.desktop.destroyed) instances.desktop.destroy(); },
  },
  tablet: {
    restart: function() { start("tablet"); },
    destroy: function() { if (instances.tablet && !instances.tablet.destroyed) instances.tablet.destroy(); },
  },
  mobile: {
    restart: function() { start("mobile"); },
    destroy: function() { if (instances.mobile && !instances.mobile.destroyed) instances.mobile.destroy(); },
  },
};

window.curtainInstances = instances;
console.log("🎭 Curtain Dropper Showcase — Desktop 1124×800, Tablet 900×600, Mobile 390×560 (Portrait)");
