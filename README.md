# 🎭 Curtain Dropper

Ein animiertes Banner-Overlay mit Three.js Cloth-Simulation. Das Banner entrollt sich von oben ins Bild, hängt eine konfigurierbare Zeit sichtbar und fällt dann nach unten weg. Danach räumt sich alles selbst auf.

Flexibel einsetzbar als Overlay, in einem bestehenden DOM-Element, oder als eigenständiges Widget mit Wrapper-Struktur und Close-Button.

## Installation

```bash
npm install curtain-dropper
```

Three.js ist bereits enthalten — keine separate Installation nötig.

**Kompatibilität:** Der Build-Output ist ES2018-kompatibel und funktioniert auch in Projekten mit älteren Webpack-/Laravel-Mix-Setups.

## Schnellstart

```js
import { CurtainDropper } from 'curtain-dropper';

CurtainDropper.init({
  banner: '/images/mein-banner.jpg',
});
```

## Drei Modi

### A) Standard-Overlay (wie bisher)

Vollbild-Overlay über der gesamten Seite. Blockiert keine Klicks. Räumt sich nach der Animation selbst auf.

```js
CurtainDropper.init({
  banner: '/images/banner.jpg',
  timing: { deploy: 2, hold: 6, fall: 2 },
  onComplete: () => console.log('Animation fertig!'),
});
```

### B) Mount in bestehendes DOM-Element

Rendert die Animation innerhalb eines bestehenden Elements.

```html
<div id="promo-slot" style="width: 800px; height: 500px;"></div>
```

```js
CurtainDropper.init({
  target: '#promo-slot',
  banner: '/images/banner.jpg',
});
```

### C) Wrapper mit Close-Button

Das Paket erzeugt eine vollständige Widget-Struktur mit Close-Button.

```js
const instance = CurtainDropper.init({
  banner: '/images/banner.jpg',
  wrapper: {
    enabled: true,
    closable: true,
    closeText: '×',
    position: 'center',
    useBackdrop: true,
  },
  onClose: () => console.log('Nutzer hat geschlossen'),
});
```

## API

### `CurtainDropper.init(options)`

Gibt eine Instanz mit Steuerungsmethoden zurück.

#### Optionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `banner` | `string \| Object` | — | **Pflicht.** Bild-URL oder `{ type, imageUrl/videoUrls }` |
| `timing` | `Object` | `{ deploy: 2.2, hold: 6, fall: 2.5 }` | Animations-Zeiten in Sekunden |
| `target` | `string \| HTMLElement` | `null` | CSS-Selektor oder Element (Modus B) |
| `wrapper` | `Object` | `{ enabled: false }` | Wrapper-Konfiguration (Modus C) |
| `corsProxy` | `string` | `""` | CORS-Proxy für externe Bilder |
| `onComplete` | `Function` | — | Callback nach Animations-Ende |
| `onClose` | `Function` | — | Callback wenn `close()` aufgerufen wird |
| `onDestroy` | `Function` | — | Callback wenn `destroy()` aufgerufen wird |

#### Wrapper-Optionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Wrapper-Struktur aktivieren |
| `closable` | `boolean` | `false` | Close-Button anzeigen |
| `closeText` | `string` | `"×"` | Text/Symbol im Close-Button |
| `className` | `string` | `""` | Zusätzliche CSS-Klasse für Root |
| `innerClassName` | `string` | `""` | Zusätzliche CSS-Klasse für Inner |
| `mountClassName` | `string` | `""` | Zusätzliche CSS-Klasse für Mount |
| `closeClassName` | `string` | `""` | Zusätzliche CSS-Klasse für Close |
| `position` | `string` | `"overlay"` | `overlay`, `center`, `top-center`, `top-right`, `bottom-right`, `bottom-center` |
| `useBackdrop` | `boolean` | `false` | Backdrop-Element erzeugen |

**Hinweis zu `wrapper.enabled`:** Der Wert wird exakt so respektiert wie übergeben. `{ wrapper: { enabled: false, closable: true } }` erzeugt *keinen* Wrapper.

### Instanz-Methoden

```js
const instance = CurtainDropper.init({ ... });
```

| Methode | Beschreibung |
|---|---|
| `close()` | **Wrapper-Modus:** Versteckt das Widget (display:none). Engine läuft weiter. `open()` zeigt es wieder an. **Ohne Wrapper:** Ruft `destroy()` auf. |
| `open()` | Zeigt ein per `close()` verstecktes Widget wieder an. Nur im Wrapper-Modus. |
| `destroy()` | Räumt **alles** auf — Engine stoppen, GPU freigeben, DOM entfernen, Events lösen. Endgültig. |
| `destroyed` | `true` wenn `destroy()` aufgerufen wurde. |
| `visible` | `true` wenn das Widget sichtbar ist. |
| `elements` | `{ root, mount, close }` — Zugriff auf DOM-Elemente für Customizing. |

## DOM-Struktur und CSS-Klassen

### IDs und Multi-Instanz

IDs werden pro Instanz eindeutig generiert: `curtain-dropper-root-1`, `curtain-dropper-mount-2` etc. Mehrere Instanzen auf derselben Seite sind dadurch problemlos möglich.

**Klassen sind stabil und global** — darüber wird gestylt:

| Element | Klasse | Beschreibung |
|---|---|---|
| Root/Outer | `.curtain-dropper-root` | Äußerster Container |
| Inner | `.curtain-dropper-inner` | Innerer Wrapper |
| Mount | `.curtain-dropper-mount` | Canvas-Renderbereich |
| Close | `.curtain-dropper-close` | Close-Button |
| Backdrop | `.curtain-dropper-backdrop` | Halbtransparenter Hintergrund |

### Wrapper-DOM (Modus C)

```html
<div class="curtain-dropper-root [custom]" id="curtain-dropper-root-1">
  <div class="curtain-dropper-backdrop"></div>            <!-- optional -->
  <div class="curtain-dropper-inner [custom]" id="curtain-dropper-inner-1">
    <button class="curtain-dropper-close [custom]">×</button>  <!-- optional -->
    <div class="curtain-dropper-mount [custom]" id="curtain-dropper-mount-1">
      <canvas></canvas>
    </div>
  </div>
</div>
```

### Styling-Philosophie

Die DOM-Elemente haben nur **funktionale Inline-Styles** (position, overflow, pointer-events, z-index). Alle optischen Styles (Farben, Größen, Abstände, Schatten) werden über die Klassen per CSS gesetzt. Der Close-Button hat bewusst kein vorgegebenes Design — nur `position: absolute`, `z-index: 10`, `cursor: pointer`.

```css
/* Beispiel: Close-Button stylen */
.curtain-dropper-close {
  top: 12px;
  right: 12px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  border: none;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  font-size: 20px;
}

/* Beispiel: Backdrop anpassen */
.curtain-dropper-backdrop {
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

/* Beispiel: Wrapper-Größe */
.curtain-dropper-root {
  width: 800px;
  height: 500px;
}
```

## Banner-Quelle

```js
// Als String (Bild)
{ banner: '/images/banner.jpg' }

// Als Bild-Objekt
{ banner: { type: 'image', imageUrl: 'https://example.com/banner.png' } }

// Als Video
{ banner: { type: 'video', videoUrls: ['/videos/ad.webm', '/videos/ad.mp4'] } }
```

## CORS und externe Bilder

Bilder von derselben Domain funktionieren immer. Für externe URLs muss der Server CORS erlauben. Für lokale Entwicklung: `corsProxy: 'https://corsproxy.io/?'`.

## Technische Details

- **Build-Target:** ES2018 — kompatibel mit älteren Webpack-/Laravel-Mix-Setups
- **Three.js:** Als `dependency` enthalten, wird mitgebündelt. Zero-Config für Consumer.
- **Multi-Instanz:** Eindeutige IDs pro Instanz, stabile Klassen zum Stylen
- **Cleanup:** `destroy()` gibt GPU-Ressourcen frei, entfernt DOM, löst Event-Listener

## Lizenz

MIT
