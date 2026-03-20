import * as THREE from "three";

/**
 * Curtain Dropper Engine — wird von der öffentlichen API aufgerufen.
 * Nicht direkt importieren, stattdessen: import { CurtainDropper } from 'curtain-dropper'
 * @internal
 */

// Defaults die mit Nutzer-Optionen gemergt werden
const DEFAULT_TIMING = {
  deploy: 2.2,
  hold: 6.0,
  fall: 2.5,
};

const DEFAULT_BANNER = {
  type: "image",
  imageUrl: "",
  videoUrls: [],
};

/**
 * Startet die Curtain-Dropper-Animation.
 * @param {Object} options — Konfiguration (siehe README)
 * @returns {{ destroy: Function }} — Handle zum manuellen Abbrechen
 */

// Zentrale Tuning-Stelle fuer Cloth, Licht, Timings, Pins und Texturquellen.
/**
 * Pin-Voreinstellungen — bestimmen wie das Tuch oben befestigt wird.
 * topEdge:    Jeder Partikel der obersten Reihe wird festgehalten (Standard für Hold)
 * topCorners: Nur die zwei Eckpunkte oben links/rechts
 * topThirds:  Vier Ankerpunkte gleichmäßig verteilt (0%, 33%, 66%, 100%)
 * none:       Keine Pins, Tuch fällt frei
 */
const PIN_PRESETS = {
  topEdge: "topEdge",
  topCorners: "topCorners",
  topThirds: "topThirds",
  none: "none",
};

/**
 * Nachbar-Offsets für das Spatial-Hashing bei der Self-Collision.
 * Jeder Partikel prüft seine eigene Zelle plus alle 26 Nachbarzellen
 * im 3D-Gitter — ergibt 27 Offsets insgesamt. Wird einmal beim Start
 * generiert und danach nur noch gelesen.
 */
const HASH_NEIGHBOR_OFFSETS = [];
for (let x = -1; x <= 1; x += 1) {
  for (let y = -1; y <= 1; y += 1) {
    for (let z = -1; z <= 1; z += 1) {
      HASH_NEIGHBOR_OFFSETS.push([x, y, z]);
    }
  }
}

/**
 * DEMO_CONFIG — Hauptkonfiguration für die gesamte Simulation.
 *
 * Hier steckt alles drin: Physik, Kamera, Material, Phasen-Timings,
 * Pin-Verhalten, Kollision und Texturquellen. Die meisten Werte sind
 * durch viel Trial-and-Error entstanden — änder sie mit Bedacht.
 *
 * Wichtigste Sektionen:
 *   camera   — Blickwinkel, Position, sanfte Kamerabewegung
 *   cloth    — Physik-Parameter (Steifigkeit, Dämpfung, Gravitation)
 *   deploy   — Wie sich das Tuch von der gerollten Form entfaltet
 *   phases   — Dauer jeder Animationsphase (wird von TIMING gesteuert)
 *   pins     — Wie die Oberkante befestigt wird (Anker, Breite, Stärke)
 *   release  — Verhalten beim Loslassen und Fallen
 *   material — Stoff-Optik (Rauheit, Glanz, Umgebungslicht)
 *   collision — Self-Collision Parameter (Performance-kritisch!)
 */
// Module-level State — wird von createCurtainDropper() gesetzt
let DEMO_CONFIG;
let CORS_PROXY = "";

function buildDemoConfig(timing, banner, size) {
  // Tuch-Dimensionen aus Pixel-Größe berechnen.
  // Wir halten die Fläche konstant (~35 Einheiten²) und passen das
  // Seitenverhältnis an. Segmente werden proportional verteilt.
  var baseArea = 35;
  var pixelW = (size && size.width) || 1124;
  var pixelH = (size && size.height) || 800;
  var aspect = pixelW / pixelH;
  var clothH = Math.sqrt(baseArea / aspect);
  var clothW = clothH * aspect;
  // Segmente: ~6 pro World-Unit, min 12, max 48
  var segX = Math.min(48, Math.max(12, Math.round(clothW * 6)));
  var segY = Math.min(48, Math.max(12, Math.round(clothH * 6)));

  return {

  // — Hintergrund (immer transparent im Overlay-Modus) —
  background: {
    transparent: true,
    clearColor: "#07090f",
    clearAlpha: 1,
  },
  // — Kamera: Position, FOV und die subtile Wackelbewegung —
  camera: {
    fov: 34,
    near: 0.1,
    far: 120,
    position: new THREE.Vector3(0, 0.3, 9.5),
    target: new THREE.Vector3(0, 0.0, 0),
    motionAmplitude: new THREE.Vector3(0.02, 0.015, 0.08),
    motionSpeed: new THREE.Vector2(0.08, 0.11),
  },
  // — Tuch-Physik: Steifigkeit, Dämpfung, Masse, Solver —
  // structuralStiffness: Zugfestigkeit längs/quer (0-1, höher = steifer)
  // shearStiffness:      Schersteifigkeit diagonal (verhindert Rauten-Verformung)
  // bendStiffness:       Biegesteifigkeit (verhindert scharfe Knicke)
  // damping:             Geschwindigkeitsdämpfung pro Frame (0.99 = wenig, 0.95 = viel)
  // solverIterations:    Constraint-Solver Durchläufe (mehr = stabiler, langsamer)
  cloth: {
    width: clothW,
    height: clothH,
    segmentsX: segX,
    segmentsY: segY,
    gravity: 14.4,
    damping: 0.992,
    mass: 0.3,
    structuralStiffness: 0.88,
    shearStiffness: 0.62,
    bendStiffness: 0.18,
    solverIterations: 6,
    timeStep: 1 / 90,
    maxFrameDelta: 1 / 30,
    initialDropVelocity: 0,
    releaseBoost: 0,
    releaseDepthPush: 0,
    edgeDepthCurve: 0.08,
    lateralDrift: 0.03,
    startOffsetAboveView: 0.42,
    maxConstraintCorrection: 0.12,
  },
  // — Spawn: Verzögerung und Startposition bevor die Entrollung beginnt —
  spawn: {
    entryDelay: 0.3,
    depthCurve: 0.028,
    lateralDrift: 0.01,
    initialVelocityY: 0,
  },
  // — Deployment: Steuert die Entroll-Animation —
  // guideStrength:   Wie stark die Führung die Partikel zur Zielposition zieht (0-1)
  // leadSoftness:    Breite der Entroll-Kante (kleiner = schärfer, weniger Flattern)
  // compactWidth:    Wie breit der gerollte Zustand relativ zur vollen Breite ist
  deploy: {
    compactBandHeight: 0.38,
    compactWidth: 0.94,
    leadSoftness: 0.06,
    guideStrength: 0.95,
    releasedGuideStrength: 0.06,
    constraintSoftness: 0.09,
    gravityScaleStart: 0.06,
    gravityScaleEnd: 0.5,
    windScale: 0,
    foldDepth: 0.18,
    deployedLean: 0.03,
  },
  // — Wind: Subtile Luftbewegung für natürlicheres Aussehen —
  wind: {
    strength: 0.025,
    gustStrength: 0.06,
    swirl: 0.015,
    enabled: true,
  },
  // — Self-Collision: Verhindert dass das Tuch durch sich selbst geht —
  // ACHTUNG: Performance-kritisch! Weniger Iterations = schneller, aber ungenauer.
  // topologyRadius: Nachbarn innerhalb dieses Radius werden ignoriert (sonst
  //                 würden direkt verbundene Partikel als Kollision erkannt)
  collision: {
    selfCollisionEnabled: true,
    particleRadius: 0.1,
    clothThickness: 0.24,
    cellSize: 0.48,
    selfCollisionIterations: 2,
    collisionStiffness: 0.65,
    topologyRadius: 6,
    maxPairsPerParticle: 6,
  },
  // — Phasen-Dauern: Werden von TIMING oben gesteuert —
  // settleDuration:      Beruhigungsphase nach dem Entrollen (Tuch pendelt aus)
  // releaseBlendDuration: Übergang beim Loslassen der Pins (weich, nicht abrupt)
  phases: {
    deployDuration: timing.deploy,
    settleDuration: 0.8,
    holdDuration: timing.hold,
    collapseDuration: 0,
    releaseBlendDuration: 0.4,
    finishAfterRelease: timing.fall,
  },
  // — Pin-Konfiguration: Wie die Oberkante befestigt wird —
  // holdFullTop:  Alle Punkte der oberen Reihe sind fest (für Entrollung + Hold)
  // holdReduced:  Nur noch wenige Ankerpunkte (nicht aktiv genutzt, Reserveconfig)
  // anchorSpread: 1.0 = volle Breite, kleiner = Tuch wird zusammengezogen
  // pullIn:       Wie stark die Anker das Tuch zur Mitte ziehen (0 = gar nicht)
  pins: {
    holdFullTop: {
      preset: PIN_PRESETS.topEdge,
      pullIn: 0,
      dropOffset: 0,
      supportRows: 0,
      supportStrength: 0,
      anchorSpread: 1.0,
      profileRadius: 1,
    },
    holdReduced: {
      preset: PIN_PRESETS.topThirds,
      pullIn: 0.14,
      dropOffset: 0.54,
      supportRows: 0,
      supportStrength: 0,
      anchorSpread: 0.76,
      profileRadius: 0.22,
    },
  },
  // — Release: Verhalten beim Loslassen und Fallen —
  // gravityScale: Beschleunigte Gravitation beim Fall (>1 = schneller als normal)
  // velocityKeep: Wie viel Restbewegung die oberen Reihen behalten (weniger = ruhiger)
  release: {
    gravityScale: 1.3,
    windScale: 0,
    resetMargin: 0.42,
    topRowsVelocityDamping: 2,
    velocityKeep: 0.12,
  },
  // — Staging: Wo das Banner im Viewport positioniert wird —
  // anchorInsetTop:  Abstand der Oberkante vom oberen Viewport-Rand
  // anchorWidthScale: Breite relativ zur Tuch-Geometrie (0.96 = leicht schmaler)
  staging: {
    anchorInsetTop: 0.35,
    anchorWidthScale: 0.96,
  },
  // — Material: Optik des Stoffs (MeshPhysicalMaterial) —
  // roughness:   Wie rau die Oberfläche wirkt (0 = Spiegel, 1 = matt)
  // sheen:       Stoffglanz an den Kanten (niedrig halten, sonst weiße Blitzer!)
  // envStrength: Wie stark Umgebungslicht reflektiert wird
  material: {
    color: "#ffffff",
    roughness: 0.62,
    metalness: 0.0,
    sheen: 0.02,
    sheenRoughness: 0.99,
    clearcoat: 0,
    envStrength: 0.3,
  },
  texture: {
    type: banner.type,
    imageUrl: banner.imageUrl || "",
    videoSources: banner.videoUrls || [],
    fallbackColorA: "#1b2336",
    fallbackColorB: "#d8b37b",
  },
};
}

// Wiederverwendbare Vektoren — werden in heißen Schleifen genutzt statt
// jedes Mal neue zu erzeugen. Spart den Garbage Collector.
const tempVecA = new THREE.Vector3();
const tempVecB = new THREE.Vector3();
const tempVecD = new THREE.Vector3();
const windNormal = new THREE.Vector3();
const gravityStep = new THREE.Vector3();
const phaseVelocity = new THREE.Vector3();

/**
 * Particle — ein einzelner Punkt des Tuchgitters.
 *
 * Nutzt Verlet-Integration: Die Geschwindigkeit wird nicht explizit
 * gespeichert sondern aus (position - previous) abgeleitet. Das ist
 * numerisch stabiler als Euler und reicht für Stoff-Simulation locker.
 *
 * @property {Vector3} position  — Aktuelle Position im 3D-Raum
 * @property {Vector3} previous  — Position im letzten Frame (für Verlet)
 * @property {Vector3} original  — Startposition (wird beim Reset genutzt)
 * @property {number}  invMass   — 1/Masse (0 = unendlich schwer = fixiert)
 */
class Particle {
  constructor(position, mass) {
    this.position = position.clone();
    this.previous = position.clone();
    this.original = position.clone();
    this.acceleration = new THREE.Vector3();
    this.invMass = mass > 0 ? 1 / mass : 0;
  }

  addForce(force) {
    this.acceleration.addScaledVector(force, this.invMass);
  }

  addAcceleration(acceleration) {
    this.acceleration.add(acceleration);
  }

  /**
   * Verlet-Integrationsschritt: Berechnet die neue Position aus der
   * aktuellen, der vorherigen und der angesammelten Beschleunigung.
   * Danach wird die Beschleunigung zurückgesetzt für den nächsten Frame.
   */
  integrate(timeStepSq, damping) {
    const velocity = tempVecA
      .subVectors(this.position, this.previous)
      .multiplyScalar(damping);
    const next = tempVecB
      .copy(this.position)
      .add(velocity)
      .addScaledVector(this.acceleration, timeStepSq);

    this.previous.copy(this.position);
    this.position.copy(next);
    this.acceleration.set(0, 0, 0);
  }
}

/**
 * ClothSimulation — das Herzstück der ganzen Animation.
 *
 * Verwaltet ein Gitter aus Partikeln (41×29 = 1189 Stück bei Standard-Settings),
 * verbunden durch Constraints (Federn) in drei Typen:
 *   - Structural: Direkte Nachbarn horizontal/vertikal (Zugfestigkeit)
 *   - Shear:      Diagonale Nachbarn (verhindert Scherverformung)
 *   - Bend:       Übernächste Nachbarn (verhindert scharfe Knicke)
 *
 * Pro Frame passiert folgendes (in dieser Reihenfolge):
 *   1. Wind-Kräfte auf Dreiecke anwenden
 *   2. Gravitation + Verlet-Integration
 *   3. Constraint-Solver (mehrere Durchläufe)
 *   4. Pins anwenden (fixierte Oberkante)
 *   5. Deployment-Guidance (Zielposition-Führung während Entrollung)
 *   6. Self-Collision (Spatial-Hash basiert)
 *   7. Pins nochmal anwenden (damit sie wirklich halten)
 *
 * @property {Particle[]}    particles   — Alle Partikel im Gitter
 * @property {Array[]}       constraints — Federn: [indexA, indexB, Ruhelänge, Steifigkeit, Aktivierung]
 * @property {Array[]}       triangles   — Dreiecke für Wind-Berechnung
 * @property {Map}           activePins  — Aktuell aktive Pin-Anker (Index → Anker-Daten)
 * @property {Object}        anchorLine  — Y-Position und Breite der oberen Aufhängung
 */
class ClothSimulation {
  constructor(config) {
    this.config = config;
    this.cols = config.segmentsX + 1;
    this.rows = config.segmentsY + 1;
    this.particles = [];
    this.constraints = [];
    this.triangles = [];
    this.activePins = new Map();
    this.anchorLine = {
      y: 0,
      width: config.width,
    };
    this.wasReleased = false;
    this.tmpForce = new THREE.Vector3();
    this.collisionCells = new Map();
    this.collisionPairCounts = new Uint8Array(this.particles.length || 0);

    this.buildParticles();
    this.collisionPairCounts = new Uint8Array(this.particles.length);
  }

  index(x, y) {
    return x + y * this.cols;
  }

  /**
   * Erzeugt das Partikelgitter und alle Constraints (Federn).
   * Wird einmal im Konstruktor aufgerufen. Baut ein flaches Rechteck
   * mit leichter Z-Krümmung an den Rändern (edgeDepthCurve) auf.
   *
   * Constraint-Typen die hier erstellt werden:
   *   Structural (dx/dy)       — direkte Nachbarn, höchste Steifigkeit
   *   Shear (diagonal)         — verhindert Parallelogramm-Verformung
   *   Bend (2× dx/dy Abstand)  — verhindert scharfe Falten
   */
  buildParticles() {
    const { width, height, segmentsX, segmentsY, mass, edgeDepthCurve, lateralDrift } =
      this.config;
    const dx = width / segmentsX;
    const dy = height / segmentsY;

    for (let y = 0; y <= segmentsY; y += 1) {
      for (let x = 0; x <= segmentsX; x += 1) {
        const u = x / segmentsX;
        const v = y / segmentsY;
        const pos = new THREE.Vector3(
          u * width - width * 0.5 + Math.sin(v * Math.PI) * lateralDrift * 0.18,
          -v * height,
          Math.sin(u * Math.PI) * edgeDepthCurve - v * 0.08
        );

        const particle = new Particle(pos, mass);
        this.particles.push(particle);
      }
    }

    for (let y = 0; y <= segmentsY; y += 1) {
      for (let x = 0; x <= segmentsX; x += 1) {
        if (x < segmentsX) {
          this.constraints.push([
            this.index(x, y),
            this.index(x + 1, y),
            dx,
            this.config.structuralStiffness,
            Math.max(y / segmentsY, y / segmentsY),
          ]);
        }

        if (y < segmentsY) {
          this.constraints.push([
            this.index(x, y),
            this.index(x, y + 1),
            dy,
            this.config.structuralStiffness,
            (y + 1) / segmentsY,
          ]);
        }

        if (x < segmentsX && y < segmentsY) {
          const diagonal = Math.hypot(dx, dy);
          this.constraints.push([
            this.index(x, y),
            this.index(x + 1, y + 1),
            diagonal,
            this.config.shearStiffness,
            (y + 1) / segmentsY,
          ]);
          this.constraints.push([
            this.index(x + 1, y),
            this.index(x, y + 1),
            diagonal,
            this.config.shearStiffness,
            (y + 1) / segmentsY,
          ]);

          this.triangles.push([
            this.index(x, y),
            this.index(x, y + 1),
            this.index(x + 1, y),
          ]);
          this.triangles.push([
            this.index(x + 1, y),
            this.index(x, y + 1),
            this.index(x + 1, y + 1),
          ]);
        }

        if (x < segmentsX - 1) {
          this.constraints.push([
            this.index(x, y),
            this.index(x + 2, y),
            dx * 2,
            this.config.bendStiffness,
            y / segmentsY,
          ]);
        }

        if (y < segmentsY - 1) {
          this.constraints.push([
            this.index(x, y),
            this.index(x, y + 2),
            dy * 2,
            this.config.bendStiffness,
            (y + 2) / segmentsY,
          ]);
        }
      }
    }
  }

  /**
   * Berechnet welche Partikel der obersten Reihe als Pins dienen sollen
   * und wie stark jeder einzelne gehalten wird (Gewichtung).
   * Bei topEdge kriegen alle Gewicht 1.0, bei topThirds nur Partikel
   * in der Nähe der Ankerpunkte (Gaußsche Glockenkurve, profileRadius).
   */
  getPinTargets(preset, profileRadius = 0.12) {
    if (preset === PIN_PRESETS.none) {
      return [];
    }

    if (preset === PIN_PRESETS.topEdge) {
      return Array.from({ length: this.cols }, (_, x) => ({
        index: this.index(x, 0),
        weight: 1,
      }));
    }

    const anchors =
      preset === PIN_PRESETS.topCorners ? [0, 1] : [0, 0.33, 0.66, 1];

    const targets = [];
    for (let x = 0; x < this.cols; x += 1) {
      const u = this.cols === 1 ? 0.5 : x / (this.cols - 1);
      let weight = 0;

      for (const anchor of anchors) {
        const distance = Math.abs(u - anchor);
        const local = 1 - distance / profileRadius;
        if (local > 0) {
          const smoothed = local * local * (3 - 2 * local);
          weight = Math.max(weight, smoothed);
        }
      }

      if (weight > 0.02) {
        targets.push({
          index: this.index(x, 0),
          weight,
        });
      }
    }

    return targets;
  }

  /**
   * Setzt alle Partikel in den "gerollten" Startzustand zurück.
   *
   * Die Partikel werden als flaches Bündel OBERHALB des sichtbaren
   * Bereichs platziert, bei Z = -0.30 (hinter der Tuchebene).
   * So ist beim Seitenstart nichts sichtbar — die Entrollung bringt
   * die Reihen dann eine nach der anderen ins Bild.
   *
   * @param {number} viewTopY — Obere Kante des Viewports in World-Koordinaten
   */
  resetCloth(viewTopY) {
    const startTop = viewTopY + this.config.startOffsetAboveView + this.config.height;
    const compactWidth =
      this.anchorLine.width *
      DEMO_CONFIG.staging.anchorWidthScale *
      DEMO_CONFIG.pins.holdFullTop.anchorSpread;

    // Flat-stack: all packed rows sit ABOVE viewport and BEHIND the cloth plane.
    // During unroll rows slide down into view and transition Z: -depth → 0.
    const packDepth = -0.30;              // Z offset behind cloth plane (increased for safety)
    const packBandHeight = 0.30;          // total Y extent of packed rows
    const packAboveOffset = 0.5;          // push packed state above anchor line
    const anchorY = this.anchorLine.y - DEMO_CONFIG.pins.holdFullTop.dropOffset + packAboveOffset;

    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const idx = this.index(x, y);
        const particle = this.particles[idx];
        const u = x / (this.cols - 1);
        const v = y / (this.rows - 1);

        const compactPose = new THREE.Vector3(
          (u - 0.5) * compactWidth * DEMO_CONFIG.deploy.compactWidth,
          anchorY - packBandHeight * Math.pow(v, 0.7),
          packDepth + Math.sin(u * Math.PI) * 0.02
        );

        const fallbackPose = new THREE.Vector3(
          u * this.config.width - this.config.width * 0.5 +
            Math.sin(v * Math.PI) * DEMO_CONFIG.spawn.lateralDrift * 0.08,
          startTop - v * this.config.height,
          Math.sin(u * Math.PI) * DEMO_CONFIG.spawn.depthCurve - v * 0.02
        );
        const start =
          y === 0 || compactPose.y <= viewTopY + packBandHeight
            ? compactPose
            : fallbackPose;

        particle.original.copy(start);
        particle.position.copy(start);
        particle.previous.copy(start);
        particle.previous.y += DEMO_CONFIG.spawn.initialVelocityY;
        particle.acceleration.set(0, 0, 0);
      }
    }

    this.wasReleased = false;
  }

  setAnchorLine(y, width) {
    this.anchorLine.y = y;
    this.anchorLine.width = width;
  }

  getParticleMobility(index) {
    const pin = this.activePins.get(index);
    if (!pin) {
      return 1;
    }

    if (pin.locked || pin.strength >= 0.999) {
      return 0;
    }

    return Math.max(0.05, 1 - pin.strength * 0.92);
  }

  /**
   * Aktualisiert die Pin-Anker basierend auf dem aktuellen Phasen-Zustand.
   * Berechnet für jeden Pin seine Zielposition (anchor), Stärke und ob
   * er "locked" ist (= Partikel wird hart auf Position gesetzt statt
   * sanft hingezogen).
   */
  updatePins(state) {
    this.activePins.clear();
    const pinTargets = this.getPinTargets(
      state.pinPreset,
      state.profileRadius ?? 0.12
    );
    const anchorWidth = this.anchorLine.width * (state.anchorSpread ?? 1);
    const rowSpacing = this.config.height / this.config.segmentsY;

    pinTargets.forEach(({ index, weight }) => {
      const x = index % this.cols;
      const u = this.cols === 1 ? 0.5 : x / (this.cols - 1);
      const anchor = new THREE.Vector3(
        (u - 0.5) * anchorWidth * (1 - state.pullIn),
        this.anchorLine.y - state.dropOffset,
        Math.sin(u * Math.PI) * 0.1
      );

      this.activePins.set(index, {
        anchor,
        strength: state.pinStrength * weight,
        locked: state.locked && weight > 0.96,
      });

      for (let row = 1; row <= (state.supportRows ?? 0); row += 1) {
        const supportIndex = index + row * this.cols;
        if (supportIndex >= this.particles.length) {
          break;
        }

        const supportStrength =
          state.pinStrength *
          weight *
          (state.supportStrength ?? 0) *
          Math.pow(0.66, row - 1);
        if (supportStrength <= 0) {
          continue;
        }

        const supportAnchor = new THREE.Vector3(
          (u - 0.5) * anchorWidth * (1 - state.pullIn * 0.72),
          this.anchorLine.y - state.dropOffset - rowSpacing * row * 0.88,
          Math.sin(u * Math.PI) * 0.07
        );

        this.activePins.set(supportIndex, {
          anchor: supportAnchor,
          strength: supportStrength,
          locked: false,
        });
      }
    });
  }

  /**
   * Löst einen einzelnen Constraint (Feder) zwischen zwei Partikeln.
   * Wenn der Abstand zu groß oder zu klein ist, werden beide Partikel
   * symmetrisch korrigiert. Während der Entrollung werden Constraints
   * erst "aktiviert" wenn die Deployment-Welle sie erreicht hat
   * (gesteuert über activation + constraintSoftness).
   */
  solveConstraint(constraint, deployState) {
    const [indexA, indexB, distance, baseStiffness, activation] = constraint;
    const pA = this.particles[indexA];
    const pB = this.particles[indexB];
    const correction = tempVecA.subVectors(pB.position, pA.position);
    const currentDistance = correction.length();

    if (!currentDistance) {
      return;
    }

    let stiffness = baseStiffness;
    if (deployState?.active) {
      const activationBlend = THREE.MathUtils.smoothstep(
        deployState.amount,
        activation - deployState.constraintSoftness,
        activation + deployState.constraintSoftness
      );

      if (activationBlend <= 0) {
        return;
      }

      stiffness *= activationBlend;
    }

    const delta = THREE.MathUtils.clamp(
      1 - distance / currentDistance,
      -this.config.maxConstraintCorrection,
      this.config.maxConstraintCorrection
    );
    correction.multiplyScalar(delta * 0.5 * stiffness);
    pA.position.add(correction);
    pB.position.sub(correction);
  }

  areTopologicalNeighbors(indexA, indexB, topologyRadius) {
    const ax = indexA % this.cols;
    const ay = (indexA - ax) / this.cols;
    const bx = indexB % this.cols;
    const by = (indexB - bx) / this.cols;

    return (
      Math.abs(ax - bx) <= topologyRadius &&
      Math.abs(ay - by) <= topologyRadius
    );
  }

  makeCellKey(x, y, z) {
    return ((x * 92837111) ^ (y * 689287499) ^ (z * 283923481)) | 0;
  }

  /**
   * Self-Collision via Spatial Hashing.
   *
   * Teilt den 3D-Raum in Zellen (cellSize) und prüft nur Partikel
   * in benachbarten Zellen gegeneinander — O(n) statt O(n²).
   * Topologische Nachbarn (Partikel die im Gitter nah beieinander
   * liegen) werden übersprungen, sonst würde jede Falte als
   * Kollision erkannt.
   *
   * Wird während der Entrollung über collisionScale gedrosselt
   * um Performance zu sparen und Artefakte zu vermeiden.
   */
  resolveSelfCollision(collisionConfig) {
    if (!collisionConfig?.selfCollisionEnabled) {
      return;
    }

    this.collisionCells.clear();
    this.collisionPairCounts.fill(0);

    const inverseCellSize = 1 / collisionConfig.cellSize;
    const minDistance = collisionConfig.clothThickness;
    const minDistanceSq = minDistance * minDistance;

    for (let i = 0; i < this.particles.length; i += 1) {
      const position = this.particles[i].position;
      const cellX = Math.floor(position.x * inverseCellSize);
      const cellY = Math.floor(position.y * inverseCellSize);
      const cellZ = Math.floor(position.z * inverseCellSize);
      const key = this.makeCellKey(cellX, cellY, cellZ);

      if (!this.collisionCells.has(key)) {
        this.collisionCells.set(key, []);
      }

      this.collisionCells.get(key).push(i);
    }

    for (let i = 0; i < this.particles.length; i += 1) {
      if (this.collisionPairCounts[i] >= collisionConfig.maxPairsPerParticle) {
        continue;
      }

      const particleA = this.particles[i];
      const posA = particleA.position;
      const cellX = Math.floor(posA.x * inverseCellSize);
      const cellY = Math.floor(posA.y * inverseCellSize);
      const cellZ = Math.floor(posA.z * inverseCellSize);

      for (const [offsetX, offsetY, offsetZ] of HASH_NEIGHBOR_OFFSETS) {
        const key = this.makeCellKey(
          cellX + offsetX,
          cellY + offsetY,
          cellZ + offsetZ
        );
        const bucket = this.collisionCells.get(key);

        if (!bucket) {
          continue;
        }

        for (const j of bucket) {
          if (j <= i) {
            continue;
          }

          if (
            this.collisionPairCounts[i] >= collisionConfig.maxPairsPerParticle ||
            this.collisionPairCounts[j] >= collisionConfig.maxPairsPerParticle
          ) {
            continue;
          }

          if (
            this.areTopologicalNeighbors(i, j, collisionConfig.topologyRadius)
          ) {
            continue;
          }

          const particleB = this.particles[j];
          const delta = tempVecA.subVectors(particleB.position, particleA.position);
          let distSq = delta.lengthSq();

          if (distSq >= minDistanceSq) {
            continue;
          }

          if (distSq < 1e-8) {
            const ax = i % this.cols;
            const bx = j % this.cols;
            delta.set(ax <= bx ? -1 : 1, 0, (i & 1) === 0 ? 0.35 : -0.35).normalize();
            distSq = 1e-8;
          }

          const distance = Math.sqrt(distSq);
          const overlap = minDistance - distance;
          if (overlap <= 0) {
            continue;
          }

          const mobilityA = this.getParticleMobility(i);
          const mobilityB = this.getParticleMobility(j);
          const totalMobility = mobilityA + mobilityB;

          if (totalMobility <= 0) {
            continue;
          }

          const correctionScale =
            (overlap / Math.max(distance, 1e-4)) * collisionConfig.collisionStiffness;
          const moveA = (mobilityA / totalMobility) * correctionScale;
          const moveB = (mobilityB / totalMobility) * correctionScale;

          particleA.position.addScaledVector(delta, -moveA);
          particleB.position.addScaledVector(delta, moveB);
          this.collisionPairCounts[i] += 1;
          this.collisionPairCounts[j] += 1;
        }
      }
    }
  }

  /**
   * Das Kernstück der Entroll-Animation.
   *
   * Jeder Partikel hat zwei Zielpositionen:
   *   packed:   Flach zusammengefaltet hinter der Tuchebene (Z = -0.30)
   *   deployed: Frei hängend an der richtigen Stelle im Banner
   *
   * Die Variable "amount" (0→1) bestimmt den Fortschritt. Über
   * smoothstep + leadSoftness entsteht eine saubere Entroll-Kante
   * die von oben nach unten wandert. Partikel die noch nicht
   * "released" sind bleiben in der packed-Position, bereits
   * freigegebene wandern zur deployed-Position.
   *
   * Die Stärke (influence) nimmt ab sobald ein Partikel deployed ist,
   * damit die Physik übernehmen kann und natürliche Bewegung entsteht.
   */
  applyDeploymentGuidance(deployState) {
    if (!deployState?.active || deployState.strength <= 0) {
      return;
    }

    const anchorWidth = this.anchorLine.width * (deployState.anchorSpread ?? 1);

    // Flat-stack parameters - must match resetCloth
    const packDepth = -0.30;
    const packBandHeight = 0.30;
    const packAboveOffset = 0.5;
    const deployedAnchorY = this.anchorLine.y - (deployState.dropOffset ?? 0);
    const packedAnchorY = deployedAnchorY + packAboveOffset;

    for (let y = 1; y < this.rows; y += 1) {
      const v = y / (this.rows - 1);
      const release = THREE.MathUtils.smoothstep(
        deployState.amount,
        v - deployState.leadSoftness,
        v + deployState.leadSoftness
      );

      for (let x = 0; x < this.cols; x += 1) {
        const index = this.index(x, y);
        if (this.activePins.has(index)) {
          continue;
        }

        const u = this.cols === 1 ? 0.5 : x / (this.cols - 1);
        const deployedX = (u - 0.5) * anchorWidth * (1 - deployState.pullIn);
        const packedX = deployedX * deployState.compactWidth;

        // Packed: flat band ABOVE viewport and BEHIND cloth plane
        const packedY = packedAnchorY - packBandHeight * Math.pow(v, 0.7);
        const packedZ = packDepth + Math.sin(u * Math.PI) * 0.02;

        // Deployed: flat hanging, front face visible
        const deployedY = deployedAnchorY - v * this.config.height;
        const deployedZ = Math.sin(u * Math.PI) * 0.04;

        const target = tempVecD.set(
          THREE.MathUtils.lerp(packedX, deployedX, release),
          THREE.MathUtils.lerp(packedY, deployedY, release),
          THREE.MathUtils.lerp(packedZ, deployedZ, release)
        );
        const influence =
          deployState.strength *
          THREE.MathUtils.lerp(1, deployState.releasedGuideStrength, release);
        const particle = this.particles[index];

        particle.position.lerp(target, Math.min(0.65, influence * 0.58));
        particle.previous.lerp(target, Math.min(0.4, influence * 0.28));
      }
    }
  }

  /**
   * Aerodynamische Windkraft auf alle Dreiecke des Tuchs.
   * Berechnet die Normale jedes Dreiecks und wendet Kraft proportional
   * zum Winkel zwischen Normale und Windrichtung an — Dreiecke die
   * frontal zum Wind stehen bekommen volle Kraft, parallele keine.
   */
  applyWind(force) {
    if (!force.lengthSq()) {
      return;
    }

    // Einfache aerodynamische Kraft: Dreiecksnormalen werden gegen die Windrichtung getestet.
    for (const [a, b, c] of this.triangles) {
      const particleA = this.particles[a].position;
      const particleB = this.particles[b].position;
      const particleC = this.particles[c].position;

      windNormal
        .subVectors(particleC, particleB)
        .cross(tempVecD.subVectors(particleA, particleB))
        .normalize();

      const strength = windNormal.dot(force);
      if (strength > 0) {
        this.tmpForce.copy(windNormal).multiplyScalar(strength);
        this.particles[a].addForce(this.tmpForce);
        this.particles[b].addForce(this.tmpForce);
        this.particles[c].addForce(this.tmpForce);
      }
    }
  }

  /**
   * Haupt-Simulationsschritt — wird pro Physics-Substep aufgerufen.
   *
   * Reihenfolge ist wichtig:
   *   1. Wind                  (Kräfte sammeln)
   *   2. Gravitation + Verlet  (Positionen updaten)
   *   3. Constraints lösen     (Abstände korrigieren, mehrere Durchläufe)
   *   4. Deployment-Guidance   (geführte Entrollung)
   *   5. Self-Collision        (Durchdringung verhindern)
   *   6. Pins nochmal          (damit die Oberkante wirklich hält)
   */
  integrate(delta, external) {
    const timeStepSq = delta * delta;

    if (external.windEnabled) {
      this.applyWind(external.windForce);
    }

    for (const particle of this.particles) {
      particle.addAcceleration(external.gravity);
      particle.integrate(timeStepSq, this.config.damping);
    }

    for (let i = 0; i < this.config.solverIterations; i += 1) {
      for (const constraint of this.constraints) {
        this.solveConstraint(constraint, external.deployState);
      }
      this.applyActivePins();
    }

    this.applyDeploymentGuidance(external.deployState);

    for (let collisionPass = 0; collisionPass < external.collision.selfCollisionIterations; collisionPass += 1) {
      this.resolveSelfCollision(external.collision);
    }

    this.applyActivePins();
  }

  /**
   * Erzwingt Pin-Positionen. Gelockte Pins setzen den Partikel hart
   * auf die Anker-Position, weiche Pins ziehen ihn sanft hin (lerp).
   * Wird mehrfach pro Frame aufgerufen — einmal nach jedem Solver-Durchlauf
   * und einmal ganz am Ende.
   */
  applyActivePins() {
    // Pins koennen weich einblenden oder voll verriegeln, damit der Uebergang cineastischer wirkt.
    for (const [index, pin] of this.activePins.entries()) {
      const particle = this.particles[index];
      if (pin.locked || pin.strength >= 0.999) {
        particle.position.copy(pin.anchor);
        particle.previous.copy(pin.anchor);
      } else {
        particle.position.lerp(pin.anchor, Math.min(0.38, pin.strength * 0.34));
        particle.previous.lerp(pin.anchor, Math.min(0.22, pin.strength * 0.18));
      }
    }
  }

  /**
   * Einmaliger Impuls wenn die Pins losgelassen werden.
   * Verschiebt previous leicht damit das Tuch nicht einfach
   * stehenbleibt sondern einen kleinen Anstoß nach unten bekommt.
   * Wird nur einmal ausgelöst (wasReleased-Flag).
   */
  releaseImpulse() {
    if (this.wasReleased) {
      return;
    }

    this.wasReleased = true;
    for (const particle of this.particles) {
      particle.previous.y += this.config.releaseBoost;
      particle.previous.z += this.config.releaseDepthPush;
    }
  }

  /**
   * Schreibt die Partikel-Positionen in das BufferGeometry-Array
   * der Three.js-Mesh. Wird jeden Frame aufgerufen damit die
   * GPU die aktuellen Positionen bekommt.
   */
  writeToGeometry(positionArray) {
    for (let i = 0; i < this.particles.length; i += 1) {
      const offset = i * 3;
      const position = this.particles[i].position;
      positionArray[offset] = position.x;
      positionArray[offset + 1] = position.y;
      positionArray[offset + 2] = position.z;
    }
  }

  /** Höchster Y-Wert aller Partikel — für Sichtbarkeitsprüfung. */
  getMaxY() {
    let maxY = -Infinity;
    for (const particle of this.particles) {
      if (particle.position.y > maxY) {
        maxY = particle.position.y;
      }
    }

    return maxY;
  }

  /** Niedrigster Y-Wert aller Partikel — für Sichtbarkeitsprüfung und Cycle-Ende. */
  getMinY() {
    let minY = Infinity;
    for (const particle of this.particles) {
      if (particle.position.y < minY) {
        minY = particle.position.y;
      }
    }

    return minY;
  }

  /**
   * Bremst die oberen Reihen beim Übergang in den freien Fall ab.
   * Ohne das würden die ehemaligen Pin-Partikel wild herumspringen
   * weil sie plötzlich keine Führung mehr haben. velocityKeep
   * bestimmt wie viel Restbewegung erhalten bleibt (0.12 = 12%).
   */
  dampReleasedTopRows(rowCount, velocityKeep) {
    const rows = Math.min(rowCount, this.rows);

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const particle = this.particles[this.index(x, y)];
        phaseVelocity
          .subVectors(particle.position, particle.previous)
          .multiplyScalar(velocityKeep);
        particle.previous.copy(particle.position).sub(phaseVelocity);
      }
    }
  }
}

/**
 * Erzeugt die Three.js BufferGeometry für das Tuch-Mesh.
 * Ein einfaches Rechteck-Gitter mit UVs (für die Textur) und
 * berechneten Normalen. Die Positionen werden danach jeden Frame
 * von der Simulation überschrieben — hier geht's nur um die
 * Topologie (welcher Vertex mit welchem verbunden ist).
 */
function createClothGeometry(width, height, segmentsX, segmentsY) {
  const vertexCount = (segmentsX + 1) * (segmentsY + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = [];

  for (let y = 0; y <= segmentsY; y += 1) {
    for (let x = 0; x <= segmentsX; x += 1) {
      const index = x + y * (segmentsX + 1);
      const u = x / segmentsX;
      const v = y / segmentsY;
      const offset = index * 3;

      positions[offset] = u * width - width * 0.5;
      positions[offset + 1] = height * 0.5 - v * height;
      positions[offset + 2] = 0;

      normals[offset + 2] = 1;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = 1 - v;
    }
  }

  for (let y = 0; y < segmentsY; y += 1) {
    for (let x = 0; x < segmentsX; x += 1) {
      const a = x + y * (segmentsX + 1);
      const b = x + (y + 1) * (segmentsX + 1);
      const c = x + 1 + y * (segmentsX + 1);
      const d = x + 1 + (y + 1) * (segmentsX + 1);

      indices.push(a, b, c, c, b, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Erzeugt eine einfache Platzhalter-Textur per Canvas2D.
 * Wird angezeigt wenn die eigentliche Textur nicht geladen werden
 * kann (CORS, 404, etc.). Zeigt "Curtain Reveal" + Hinweis.
 */
function createFallbackTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1536;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, DEMO_CONFIG.texture.fallbackColorA);
  gradient.addColorStop(1, DEMO_CONFIG.texture.fallbackColorB);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.fillRect(96, 128, canvas.width - 192, canvas.height - 256);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = 10;
  ctx.strokeRect(122, 154, canvas.width - 244, canvas.height - 308);

  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.textAlign = "center";
  ctx.font = "700 108px Georgia, serif";
  ctx.fillText("Curtain", canvas.width * 0.5, 540);
  ctx.font = "600 86px Georgia, serif";
  ctx.fillText("Reveal", canvas.width * 0.5, 668);
  ctx.font = "500 32px Segoe UI, sans-serif";
  ctx.fillText("Replace this texture in main.js", canvas.width * 0.5, 938);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Prüft ob eine URL zur selben Domain gehört wie die aktuelle Seite.
 * Relative Pfade ("/images/x.jpg") sind immer same-origin.
 * Wird genutzt um zu entscheiden ob CORS-Handling nötig ist.
 */
function isSameOrigin(url) {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin;
  } catch {
    return true; // relative URLs are always same-origin
  }
}

/**
 * Lädt die Banner-Textur als Bild.
 *
 * Same-Origin URLs werden direkt über TextureLoader geladen.
 * Externe URLs (andere Domain) werden per fetch() als Blob geholt
 * um CORS-Probleme zu umgehen. Falls ein CORS_PROXY konfiguriert
 * ist, wird der als Fallback versucht.
 *
 * Bei Fehler → Fallback-Textur, kein Crash.
 */
function loadImageTexture(textureLoader, renderer) {
  const imageUrl = DEMO_CONFIG.texture.imageUrl;

  // Same-origin or relative path — load directly, no CORS issues
  if (isSameOrigin(imageUrl)) {
    return new Promise((resolve) => {
      textureLoader.load(
        imageUrl,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          resolve({ texture, videoElement: null });
        },
        undefined,
        () => {
          console.warn("[CurtainDropper] Bild nicht gefunden:", imageUrl);
          resolve({ texture: createFallbackTexture(), videoElement: null });
        }
      );
    });
  }

  // External URL — fetch as blob to avoid CORS issues with WebGL
  return (async () => {
    const urls = [imageUrl];
    if (CORS_PROXY) {
      urls.push(CORS_PROXY + encodeURIComponent(imageUrl));
    }

    for (const url of urls) {
      try {
        const response = await fetch(url, { mode: "cors" });
        if (!response.ok) continue;
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        return await new Promise((resolve) => {
          textureLoader.load(
            blobUrl,
            (texture) => {
              URL.revokeObjectURL(blobUrl);
              texture.colorSpace = THREE.SRGBColorSpace;
              texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
              resolve({ texture, videoElement: null });
            },
            undefined,
            () => {
              URL.revokeObjectURL(blobUrl);
              resolve(null);
            }
          );
        });
      } catch {
        // CORS blocked or network error — try next URL
      }
    }

    console.warn(
      "[CurtainDropper] Externes Bild konnte nicht geladen werden (CORS):", imageUrl,
      "\n→ Auf dem Ziel-Server funktioniert es automatisch (same-origin).",
      CORS_PROXY ? "" : "\n→ Für lokale Entwicklung: CORS_PROXY in main.js setzen."
    );
    return { texture: createFallbackTexture(), videoElement: null };
  })();
}

/**
 * Lädt die Banner-Textur als Video.
 * Das Video wird muted + inline abgespielt (Voraussetzung für Autoplay).
 * Mehrere Formate werden als <source>-Fallbacks angegeben.
 * Falls das Video nicht abspielbar ist → Fallback auf Bild-Textur.
 */
function loadVideoTexture(renderer) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";

    // Only set crossOrigin for external URLs
    const firstSource = DEMO_CONFIG.texture.videoSources[0] || "";
    if (!isSameOrigin(firstSource)) {
      video.crossOrigin = "anonymous";
    }

    for (let sourceUrl of DEMO_CONFIG.texture.videoSources) {
      if (!isSameOrigin(sourceUrl) && CORS_PROXY) {
        sourceUrl = CORS_PROXY + encodeURIComponent(sourceUrl);
      }
      const source = document.createElement("source");
      source.src = sourceUrl;
      video.appendChild(source);
    }

    const failover = () =>
      loadImageTexture(new THREE.TextureLoader(), renderer).then(resolve);

    video.addEventListener(
      "loadeddata",
      async () => {
        try {
          await video.play();
        } catch (error) {
          console.warn("Video autoplay blocked, texture stays paused.", error);
        }

        const texture = new THREE.VideoTexture(video);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        resolve({ texture, videoElement: video });
      },
      { once: true }
    );

    video.addEventListener("error", failover, { once: true });
    video.load();
  });
}

/** Entscheidet anhand von BANNER_SOURCE.type ob Bild oder Video geladen wird. */
async function loadClothTexture(renderer) {
  if (DEMO_CONFIG.texture.type === "video") {
    return loadVideoTexture(renderer);
  }

  return loadImageTexture(new THREE.TextureLoader(), renderer);
}

/** Viewport-Größe in Pixeln, berücksichtigt sowohl Container als auch Window. */
function getViewportSize(root) {
  // Container-Größe hat Vorrang — window nur als Fallback wenn Container 0 ist
  var w = root.clientWidth || root.offsetWidth || 0;
  var h = root.clientHeight || root.offsetHeight || 0;
  // Fallback auf Window nur wenn Container wirklich keine Größe hat
  if (w < 1) w = window.innerWidth || 1;
  if (h < 1) h = window.innerHeight || 1;
  return { width: w, height: h };
}

/** Schneller Start, sanftes Ende — gut für Abbremseffekte. */
function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

/** Sanfter Start UND sanftes Ende — wird für die Entrollung genutzt. */
function easeInOutQuad(value) {
  return value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2;
}

/** Begrenzt einen Wert auf den Bereich 0-1. */
function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Die State-Machine — bestimmt anhand der vergangenen Zeit welche
 * Animationsphase gerade aktiv ist und gibt alle Parameter zurück
 * die die Simulation für diesen Frame braucht.
 *
 * Phasen-Ablauf:
 *
 *   PRE_ENTRY (0.3s)
 *     Tuch ist unsichtbar, alles wartet.
 *
 *   DEPLOY_UNFURL (timing.deploy)
 *     Entrollung von oben nach unten. Gravitation steigt langsam,
 *     Deployment-Guidance führt die Partikel. Self-Collision ist
 *     gedrosselt um Artefakte zu vermeiden.
 *
 *   SETTLE_HOLD (0.8s)
 *     Tuch ist voll entrollt, pendelt aus. Guidance wird
 *     langsam auf 0 reduziert, Collision auf volle Stärke hochgefahren.
 *
 *   HOLD (timing.hold)
 *     Banner hängt ruhig. Nur leichter Wind, volle Physik.
 *     Hier sieht der Nutzer die Werbung.
 *
 *   RELEASE_ALL (0.4s)
 *     Pins werden sanft gelöst (pinStrength 1→0). Gravitation
 *     wird leicht erhöht für einen dynamischeren Fall.
 *
 *   EXIT_DROP (timing.fall)
 *     Tuch fällt frei nach unten. Kein Wind, keine Pins.
 *     Sobald es aus dem Viewport ist → Cleanup.
 *
 * Jede Phase gibt ein Objekt zurück mit:
 *   name, pinPreset, pinStrength, locked, gravityScale, windScale,
 *   collisionScale, deployState, releaseNow, ...
 */
function getPhaseState(timeSeconds) {
  // State-Machine: Pre-entry -> unfurl -> settle -> hold -> release (all pins) -> exit drop.
  const { phases, pins } = DEMO_CONFIG;
  const preEntryEnd = DEMO_CONFIG.spawn.entryDelay;
  const deployEnd = preEntryEnd + phases.deployDuration;
  const settleEnd = deployEnd + phases.settleDuration;
  const holdEnd = settleEnd + phases.holdDuration;
  const collapseEnd = holdEnd + phases.collapseDuration;
  const releaseEnd = collapseEnd + phases.releaseBlendDuration;

  if (timeSeconds < preEntryEnd) {
    return {
      name: "PRE_ENTRY",
      pinPreset: pins.holdFullTop.preset,
      pinStrength: 1,
      locked: true,
      pullIn: pins.holdFullTop.pullIn,
      dropOffset: pins.holdFullTop.dropOffset,
      supportRows: pins.holdFullTop.supportRows,
      supportStrength: pins.holdFullTop.supportStrength,
      anchorSpread: pins.holdFullTop.anchorSpread,
      profileRadius: pins.holdFullTop.profileRadius,
      gravityScale: 0,
      windScale: 0,
      collisionScale: 0,
      deployState: {
        active: true,
        amount: 0,
        strength: DEMO_CONFIG.deploy.guideStrength,
        releasedGuideStrength: DEMO_CONFIG.deploy.releasedGuideStrength,
        compactBandHeight: DEMO_CONFIG.deploy.compactBandHeight,
        compactWidth: DEMO_CONFIG.deploy.compactWidth,
        leadSoftness: DEMO_CONFIG.deploy.leadSoftness,
        constraintSoftness: DEMO_CONFIG.deploy.constraintSoftness,
        pullIn: pins.holdFullTop.pullIn,
        dropOffset: pins.holdFullTop.dropOffset,
        anchorSpread: pins.holdFullTop.anchorSpread,
      },
      releaseNow: false,
    };
  }

  if (timeSeconds < deployEnd) {
    const progress = clamp01((timeSeconds - preEntryEnd) / phases.deployDuration);
    return {
      name: "DEPLOY_UNFURL",
      pinPreset: pins.holdFullTop.preset,
      pinStrength: 1,
      locked: true,
      pullIn: pins.holdFullTop.pullIn,
      dropOffset: pins.holdFullTop.dropOffset,
      supportRows: pins.holdFullTop.supportRows,
      supportStrength: pins.holdFullTop.supportStrength,
      anchorSpread: pins.holdFullTop.anchorSpread,
      profileRadius: pins.holdFullTop.profileRadius,
      gravityScale: THREE.MathUtils.lerp(
        DEMO_CONFIG.deploy.gravityScaleStart,
        DEMO_CONFIG.deploy.gravityScaleEnd,
        easeInOutQuad(progress)
      ),
      windScale: DEMO_CONFIG.deploy.windScale,
      collisionScale: Math.pow(progress, 2) * 0.3,
      deployState: {
        active: true,
        amount: easeInOutQuad(progress),
        strength: DEMO_CONFIG.deploy.guideStrength,
        releasedGuideStrength: DEMO_CONFIG.deploy.releasedGuideStrength,
        compactBandHeight: DEMO_CONFIG.deploy.compactBandHeight,
        compactWidth: DEMO_CONFIG.deploy.compactWidth,
        leadSoftness: DEMO_CONFIG.deploy.leadSoftness,
        constraintSoftness: DEMO_CONFIG.deploy.constraintSoftness,
        pullIn: pins.holdFullTop.pullIn,
        dropOffset: pins.holdFullTop.dropOffset,
        anchorSpread: pins.holdFullTop.anchorSpread,
      },
      releaseNow: false,
    };
  }

  if (timeSeconds < settleEnd) {
    const progress = clamp01((timeSeconds - deployEnd) / phases.settleDuration);
    return {
      name: "SETTLE_HOLD",
      pinPreset: pins.holdFullTop.preset,
      pinStrength: 1,
      locked: true,
      pullIn: pins.holdFullTop.pullIn,
      dropOffset: pins.holdFullTop.dropOffset,
      supportRows: pins.holdFullTop.supportRows,
      supportStrength: pins.holdFullTop.supportStrength,
      anchorSpread: pins.holdFullTop.anchorSpread,
      profileRadius: pins.holdFullTop.profileRadius,
      gravityScale: THREE.MathUtils.lerp(0.68, 1, easeOutCubic(progress)),
      windScale: 0.02,
      collisionScale: THREE.MathUtils.lerp(0.3, 1.0, easeOutCubic(progress)),
      deployState: {
        active: true,
        amount: 1,
        strength: THREE.MathUtils.lerp(
          DEMO_CONFIG.deploy.guideStrength * 0.38,
          0,
          easeOutCubic(progress)
        ),
        releasedGuideStrength: DEMO_CONFIG.deploy.releasedGuideStrength,
        compactBandHeight: DEMO_CONFIG.deploy.compactBandHeight,
        compactWidth: DEMO_CONFIG.deploy.compactWidth,
        leadSoftness: DEMO_CONFIG.deploy.leadSoftness,
        constraintSoftness: DEMO_CONFIG.deploy.constraintSoftness,
        pullIn: pins.holdFullTop.pullIn,
        dropOffset: pins.holdFullTop.dropOffset,
        anchorSpread: pins.holdFullTop.anchorSpread,
      },
      releaseNow: false,
    };
  }

  if (timeSeconds < holdEnd) {
    return {
      name: "HOLD",
      pinPreset: pins.holdFullTop.preset,
      pinStrength: 1,
      locked: true,
      pullIn: pins.holdFullTop.pullIn,
      dropOffset: pins.holdFullTop.dropOffset,
      supportRows: pins.holdFullTop.supportRows,
      supportStrength: pins.holdFullTop.supportStrength,
      anchorSpread: pins.holdFullTop.anchorSpread,
      profileRadius: pins.holdFullTop.profileRadius,
      gravityScale: 1,
      windScale: 0.03,
      collisionScale: 1,
      deployState: null,
      releaseNow: false,
    };
  }

  if (timeSeconds < releaseEnd) {
    const progress = clamp01((timeSeconds - holdEnd) / phases.releaseBlendDuration);
    return {
      name: "RELEASE_ALL",
      pinPreset: pins.holdFullTop.preset,
      pinStrength: THREE.MathUtils.lerp(1.0, 0.0, easeOutCubic(progress)),
      locked: false,
      pullIn: pins.holdFullTop.pullIn,
      dropOffset: pins.holdFullTop.dropOffset,
      supportRows: pins.holdFullTop.supportRows,
      supportStrength: THREE.MathUtils.lerp(pins.holdFullTop.supportStrength, 0, progress),
      anchorSpread: pins.holdFullTop.anchorSpread,
      profileRadius: pins.holdFullTop.profileRadius,
      gravityScale: THREE.MathUtils.lerp(1.0, DEMO_CONFIG.release.gravityScale, easeOutCubic(progress)),
      windScale: 0,
      collisionScale: 1,
      deployState: null,
      releaseNow: progress < 0.05,
    };
  }

  return {
    name: "EXIT_DROP",
    pinPreset: PIN_PRESETS.none,
    pinStrength: 0,
    locked: false,
    pullIn: 0,
    dropOffset: 0,
    supportRows: 0,
    supportStrength: 0,
    anchorSpread: 1,
    profileRadius: 0.12,
    gravityScale: DEMO_CONFIG.release.gravityScale,
    windScale: 0,
    collisionScale: 1,
    deployState: null,
    releaseNow: timeSeconds >= releaseEnd,
  };
}

/**
 * Berechnet die sichtbaren Grenzen des Viewports in World-Koordinaten.
 * Wird gebraucht um zu wissen wo die Oberkante ist (für Anchor-Platzierung)
 * und wo die Unterkante (für Sichtbarkeitsprüfung + Cycle-Ende).
 */
function computeViewBounds(camera, targetZ = 0) {
  const distance = camera.position.z - targetZ;
  const halfHeight =
    Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * distance;
  const halfWidth = halfHeight * camera.aspect;
  return {
    top: camera.position.y + halfHeight,
    bottom: camera.position.y - halfHeight,
    left: camera.position.x - halfWidth,
    right: camera.position.x + halfWidth,
  };
}

/**
 * Erstellt den WebGL-Renderer. Immer transparent (alpha: true),
 * Canvas bekommt pointer-events: none damit die Seite darunter
 * weiterhin klickbar bleibt.
 */
function createRenderer(root) {
  const { width, height } = getViewportSize(root);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.45;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0);

  // Canvas fills overlay, doesn't block clicks on page below
  const canvas = renderer.domElement;
  Object.assign(canvas.style, {
    display: "block",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  });

  root.appendChild(canvas);
  return renderer;
}

/**
 * Szenen-Beleuchtung: Hemisphere (Grundlicht oben/unten), Ambient
 * (gleichmäßige Aufhellung), Key-Light (Hauptlicht mit Schatten)
 * und Rim-Light (blaues Gegenlicht für Kantendefinition).
 */
function createLights(scene) {
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x303040, 1.3);
  scene.add(hemisphere);

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(6.5, 9.2, 10.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  key.shadow.bias = -0.00018;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xdde0f0, 0.8);
  rim.position.set(-7.5, 5.4, -8.5);
  scene.add(rim);
}

/**
 * Shadow-Plane unter dem Tuch — fängt den Schlagschatten auf.
 * Im Overlay-Modus gibt es keinen sichtbaren Hintergrund,
 * aber der Schatten auf dem Boden sieht trotzdem gut aus.
 */
function createBackdrop(scene) {
  // No backdrop needed — overlay mode is always transparent.
  // Shadow plane still needed for cloth self-shadow.
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: 0.08 })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = -6.3;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);
}

/**
 * Material für die Vorderseite des Tuchs (MeshPhysicalMaterial).
 * Rendert nur FrontSide — die Rückseite wird von einem separaten
 * Mesh mit dunklem Material abgedeckt (siehe createBackfaceMaterial).
 *
 * Wichtig: sheen niedrig halten (< 0.1), sonst gibt es weiße
 * Blitzer an Dreiecken die schräg zur Kamera stehen.
 */
function createClothMaterial(texture) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(DEMO_CONFIG.material.color),
    map: texture,
    side: THREE.FrontSide,
    roughness: DEMO_CONFIG.material.roughness,
    metalness: DEMO_CONFIG.material.metalness,
    clearcoat: DEMO_CONFIG.material.clearcoat,
    sheen: DEMO_CONFIG.material.sheen,
    sheenColor: new THREE.Color("#ffffff"),
    sheenRoughness: DEMO_CONFIG.material.sheenRoughness,
    envMapIntensity: DEMO_CONFIG.material.envStrength,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/**
 * Dunkles Material für die Rückseite des Tuchs.
 * Wird erst ab der HOLD-Phase sichtbar (während der Entrollung
 * ausgeblendet um Z-Fighting zu vermeiden). Verhindert dass man
 * beim Fall "durch" das Tuch hindurch weiße Flächen sieht.
 */
function createBackfaceMaterial() {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color("#0a0d14"),
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/**
 * Baut die Szenen-Objekte zusammen: Geometrie + zwei Meshes
 * (Vorderseite mit Textur, Rückseite dunkel) die sich dieselbe
 * Geometrie teilen. Beide werden der Szene hinzugefügt.
 */
function createSceneEntities(scene, texture) {
  const geometry = createClothGeometry(
    DEMO_CONFIG.cloth.width,
    DEMO_CONFIG.cloth.height,
    DEMO_CONFIG.cloth.segmentsX,
    DEMO_CONFIG.cloth.segmentsY
  );

  const clothMesh = new THREE.Mesh(geometry, createClothMaterial(texture));
  clothMesh.castShadow = true;
  clothMesh.receiveShadow = true;
  scene.add(clothMesh);

  // Dark backface mesh - shares geometry, renders only back-facing triangles
  const backfaceMesh = new THREE.Mesh(geometry, createBackfaceMaterial());
  backfaceMesh.castShadow = false;
  backfaceMesh.receiveShadow = false;
  scene.add(backfaceMesh);

  return { clothMesh, backfaceMesh };
}

/**
 * Berechnet den Windvektor für den aktuellen Frame.
 * Mischung aus konstantem Grundwind und zeitabhängigen Böen
 * (Sinus-Kurven mit verschiedenen Frequenzen). Erzeugt ein
 * natürlich wirkendes, unregelmäßiges Windmuster.
 */
function computeWind(target, elapsed) {
  if (!DEMO_CONFIG.wind.enabled) {
    return target.set(0, 0, 0);
  }

  const gust =
    DEMO_CONFIG.wind.strength +
    (Math.sin(elapsed * 0.9) * 0.5 + 0.5) * DEMO_CONFIG.wind.gustStrength;
  return target
    .set(
      Math.sin(elapsed * 0.7) * DEMO_CONFIG.wind.swirl,
      Math.cos(elapsed * 0.42) * 0.08,
      Math.cos(elapsed * 0.58) * 0.42 + 0.22
    )
    .normalize()
    .multiplyScalar(gust);
}

/**
 * Subtile Kamerabewegung — kaum wahrnehmbar, aber gibt dem
 * Ganzen mehr Leben als eine komplett statische Kamera.
 * Sinus-Kurven mit sehr kleiner Amplitude und langsamer Frequenz.
 */
function updateCamera(camera, elapsed) {
  camera.position.x =
    DEMO_CONFIG.camera.position.x +
    Math.sin(elapsed * DEMO_CONFIG.camera.motionSpeed.x) *
      DEMO_CONFIG.camera.motionAmplitude.x;
  camera.position.y =
    DEMO_CONFIG.camera.position.y +
    Math.cos(elapsed * DEMO_CONFIG.camera.motionSpeed.y) *
      DEMO_CONFIG.camera.motionAmplitude.y;
  camera.position.z =
    DEMO_CONFIG.camera.position.z +
    Math.sin(elapsed * 0.11) * DEMO_CONFIG.camera.motionAmplitude.z;
  camera.lookAt(DEMO_CONFIG.camera.target);
}

/**
 * init() — Einstiegspunkt, baut alles auf und startet den Render-Loop.
 *
 * Ablauf:
 *   1. Overlay-Container (#curtain-overlay) erstellen und ins DOM hängen
 *   2. Renderer, Szene, Kamera, Lichter aufbauen
 *   3. Tuch-Mesh + Simulation erstellen (anfangs unsichtbar)
 *   4. Textur asynchron nachladen (Bild oder Video)
 *   5. Render-Loop starten (requestAnimationFrame)
 *
 * Der Render-Loop macht pro Frame:
 *   - Kamera updaten (subtile Bewegung)
 *   - Physik-Substeps abarbeiten (je nach Framerate 1-2 Stück)
 *   - Partikel-Positionen in die GPU-Geometry schreiben
 *   - Sichtbarkeit und Opacity steuern
 *   - Prüfen ob die Animation fertig ist → wenn ja: Cleanup
 *
 * Cleanup entfernt den kompletten Overlay-Container aus dem DOM,
 * disposed alle Three.js-Ressourcen und stoppt den Loop. Danach
 * ist nichts mehr übrig — kein Memory-Leak, keine GPU-Last.
 */

/**
 * Startet die Cloth-Engine in einem gegebenen DOM-Element.
 *
 * Die Engine kümmert sich NUR um Rendering und Physik.
 * DOM-Erstellung und -Aufräumung ist Sache des Callers (dom.js / index.js).
 *
 * @param {HTMLElement} mountElement — Das Element in das der Canvas gerendert wird
 * @param {Object} options — { timing, banner, corsProxy, onComplete, onCleanup }
 * @returns {{ destroy: Function }} — Handle zum Abbrechen der Animation
 */
export function startEngine(mountElement, options = {}) {
  const userTiming = { ...DEFAULT_TIMING, ...options.timing };
  const userBanner = typeof options.banner === "string"
    ? { type: "image", imageUrl: options.banner, videoUrls: [] }
    : { ...DEFAULT_BANNER, ...options.banner };
  const onComplete = options.onComplete || null;
  const onCleanup = options.onCleanup || null;
  let destroyed = false;

  // Eigene Config-Kopie für diese Instanz — wird vor jedem Frame
  // in die Module-Variablen geschrieben, damit mehrere Instanzen
  // nicht kollidieren (JS ist single-threaded, kein Interleaving).
  const myConfig = buildDemoConfig(userTiming, userBanner, options.size);
  const myCorsProxy = options.corsProxy || "";

  function activateInstanceContext() {
    DEMO_CONFIG = myConfig;
    CORS_PROXY = myCorsProxy;
  }

  // Initial setzen
  activateInstanceContext();

async function init() {
  // Kontext dieser Instanz sicherstellen
  activateInstanceContext();
  // Mount-Element kommt von außen (dom.js)
  const root = mountElement;

  const renderer = createRenderer(root);
  const scene = new THREE.Scene();
  const initialSize = getViewportSize(root);
  const camera = new THREE.PerspectiveCamera(
    DEMO_CONFIG.camera.fov,
    initialSize.width / initialSize.height,
    DEMO_CONFIG.camera.near,
    DEMO_CONFIG.camera.far
  );

  camera.position.copy(DEMO_CONFIG.camera.position);
  // Initialen Z-Abstand ans Container-Format anpassen
  const initAspect = initialSize.width / initialSize.height;
  const initHalfFov = THREE.MathUtils.degToRad(DEMO_CONFIG.camera.fov * 0.5);
  const initZ = THREE.MathUtils.clamp(
    (DEMO_CONFIG.cloth.width / 0.78) / (2 * Math.tan(initHalfFov) * initAspect),
    5, 28
  );
  camera.position.z = initZ;
  DEMO_CONFIG.camera.position.z = initZ;
  camera.lookAt(DEMO_CONFIG.camera.target);

  createLights(scene);
  createBackdrop(scene);

  const fallbackTexture = createFallbackTexture();
  const { clothMesh, backfaceMesh } = createSceneEntities(scene, fallbackTexture);
  clothMesh.visible = false;
  clothMesh.material.transparent = true;
  clothMesh.material.opacity = 0;
  backfaceMesh.visible = false;
  const cloth = new ClothSimulation(DEMO_CONFIG.cloth);
  const positionAttribute = clothMesh.geometry.getAttribute("position");
  const gravityForce = new THREE.Vector3(0, -DEMO_CONFIG.cloth.gravity, 0);
  const windForce = new THREE.Vector3();
  let activeTexture = fallbackTexture;
  let activeVideoElement = null;
  const totalCycleDuration =
    DEMO_CONFIG.spawn.entryDelay +
    DEMO_CONFIG.phases.deployDuration +
    DEMO_CONFIG.phases.settleDuration +
    DEMO_CONFIG.phases.holdDuration +
    DEMO_CONFIG.phases.collapseDuration +
    DEMO_CONFIG.phases.releaseBlendDuration +
    DEMO_CONFIG.phases.finishAfterRelease;

  const clock = new THREE.Clock();
  let accumulator = 0;
  let localTime = 0;
  let viewport = computeViewBounds(camera);
  let previousPhaseName = "";

  /**
   * Wird bei Fenster-Resize aufgerufen (und einmal beim Start).
   * Passt Kamera-Aspect, Renderer-Größe und Tuch-Positionierung
   * an die neue Viewport-Größe an. Setzt die Simulation zurück.
   */
  /**
   * Berechnet den optimalen Kamera-Abstand, damit das Tuch
   * ca. 78% der Container-Breite ausfüllt — egal wie groß der Container ist.
   */
  function computeIdealCameraZ(aspect) {
    const clothWidth = DEMO_CONFIG.cloth.width;
    const fillRatio = 0.78;
    const halfFovRad = THREE.MathUtils.degToRad(DEMO_CONFIG.camera.fov * 0.5);
    const tanHalf = Math.tan(halfFovRad);
    // Z so wählen, dass clothWidth genau fillRatio der sichtbaren Breite einnimmt
    const z = (clothWidth / fillRatio) / (2 * tanHalf * aspect);
    // Nicht zu nah (Clipping) und nicht zu weit (winzig)
    return THREE.MathUtils.clamp(z, 5, 28);
  }

  function syncLayout() {
    activateInstanceContext();
    const { width, height } = getViewportSize(root);
    camera.aspect = width / height;
    // Kamera-Abstand ans Container-Format anpassen
    const idealZ = computeIdealCameraZ(camera.aspect);
    DEMO_CONFIG.camera.position.z = idealZ;
    camera.position.z = idealZ;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    viewport = computeViewBounds(camera);
    cloth.setAnchorLine(
      viewport.top - DEMO_CONFIG.staging.anchorInsetTop,
      DEMO_CONFIG.cloth.width * DEMO_CONFIG.staging.anchorWidthScale
    );
    cloth.resetCloth(viewport.top);
    accumulator = 0;
    localTime = 0;
  }

  syncLayout();

  window.addEventListener("resize", syncLayout);

  loadClothTexture(renderer)
    .then(({ texture, videoElement }) => {
      if (activeTexture !== fallbackTexture) {
        activeTexture.dispose();
      }

      activeTexture = texture;
      activeVideoElement = videoElement;
      clothMesh.material.map = texture;
      clothMesh.material.needsUpdate = true;
    })
    .catch((error) => {
      console.warn("Texture loading failed, keeping fallback texture.", error);
    });

  /**
   * Der Render-Loop — läuft via requestAnimationFrame bis die
   * Animation vorbei ist. Nutzt einen Akkumulator für gleichmäßige
   * Physik-Substeps unabhängig von der tatsächlichen Framerate.
   *
   * Steuert außerdem:
   *   - Cloth-Sichtbarkeit (unsichtbar bis Entrollung startet)
   *   - Opacity-Fade-In (sanftes Einblenden über 0.4s)
   *   - Backface-Mesh (erst ab HOLD sichtbar)
   *   - End-Erkennung und Cleanup (Canvas entfernen, Ressourcen freigeben)
   */
  function renderFrame() {
    // Multi-Instanz: eigene Config aktivieren bevor irgendetwas gelesen wird
    activateInstanceContext();
    const delta = Math.min(clock.getDelta(), DEMO_CONFIG.cloth.maxFrameDelta);
    accumulator += delta;
    localTime += delta;

    updateCamera(camera, localTime);
    viewport = computeViewBounds(camera);
    cloth.setAnchorLine(
      viewport.top - DEMO_CONFIG.staging.anchorInsetTop,
      DEMO_CONFIG.cloth.width * DEMO_CONFIG.staging.anchorWidthScale
    );

    while (accumulator >= DEMO_CONFIG.cloth.timeStep) {
      const phase = getPhaseState(localTime);
      if (phase.name !== previousPhaseName) {
        if (phase.name === "EXIT_DROP") {
          cloth.dampReleasedTopRows(
            DEMO_CONFIG.release.topRowsVelocityDamping,
            DEMO_CONFIG.release.velocityKeep
          );
        }

        previousPhaseName = phase.name;
      }

      cloth.updatePins(phase);

      if (phase.releaseNow) {
        cloth.releaseImpulse();
      }

      computeWind(windForce, localTime);
      windForce.multiplyScalar(phase.windScale ?? 1);

      const collisionScale = phase.collisionScale ?? 1;
      const scaledCollision = collisionScale <= 0 ? {
        ...DEMO_CONFIG.collision,
        selfCollisionEnabled: false,
      } : {
        ...DEMO_CONFIG.collision,
        selfCollisionIterations: Math.max(1, Math.round(DEMO_CONFIG.collision.selfCollisionIterations * collisionScale)),
        collisionStiffness: DEMO_CONFIG.collision.collisionStiffness * collisionScale,
      };

      cloth.integrate(DEMO_CONFIG.cloth.timeStep, {
        gravity: gravityStep.copy(gravityForce).multiplyScalar(phase.gravityScale ?? 1),
        windEnabled: DEMO_CONFIG.wind.enabled,
        windForce,
        deployState: phase.deployState,
        collision: scaledCollision,
      });

      accumulator -= DEMO_CONFIG.cloth.timeStep;
    }

    cloth.writeToGeometry(positionAttribute.array);
    positionAttribute.needsUpdate = true;
    clothMesh.geometry.computeVertexNormals();

    if (activeVideoElement && activeVideoElement.readyState >= 2) {
      activeTexture.needsUpdate = true;
    }

    // Solange das Cloth noch komplett ausserhalb des Bilds liegt, soll auch kein isolierter Schatten zu sehen sein.
    const clothInView = cloth.getMinY() < viewport.top + 0.1 && cloth.getMaxY() > viewport.bottom - 0.2;
    const inPreEntry = localTime < DEMO_CONFIG.spawn.entryDelay;
    const deploySettleDone = localTime >= DEMO_CONFIG.spawn.entryDelay + DEMO_CONFIG.phases.deployDuration + DEMO_CONFIG.phases.settleDuration;

    // Hide cloth completely during PRE_ENTRY
    clothMesh.visible = clothInView && !inPreEntry;
    clothMesh.castShadow = clothInView && !inPreEntry;
    // Backface only after settle is done - avoids z-fighting during deployment
    backfaceMesh.visible = clothMesh.visible && deploySettleDone;

    // Smooth opacity fade-in during first 0.4s of deployment
    const deployStart = DEMO_CONFIG.spawn.entryDelay;
    const fadeInDuration = 0.4;
    if (localTime < deployStart + fadeInDuration) {
      const fadeProgress = Math.max(0, (localTime - deployStart) / fadeInDuration);
      clothMesh.material.opacity = easeOutCubic(fadeProgress);
      clothMesh.material.transparent = true;
    } else if (clothMesh.material.transparent && clothMesh.material.opacity < 1) {
      clothMesh.material.opacity = 1;
      clothMesh.material.transparent = false;
    }

    if (
      localTime >= totalCycleDuration &&
      cloth.getMaxY() < viewport.bottom - DEMO_CONFIG.release.resetMargin
    ) {
      // Animation fertig — GPU-Ressourcen aufräumen
      clothMesh.visible = false;
      backfaceMesh.visible = false;
      renderer.render(scene, camera);

      disposeGPU();
      window.removeEventListener("resize", syncLayout);
      if (onComplete) onComplete();
      if (onCleanup) onCleanup();
      return;
    }

    // Manuell abgebrochen?
    if (destroyed) {
      disposeGPU();
      window.removeEventListener("resize", syncLayout);
      if (onCleanup) onCleanup();
      return;
    }

    renderer.render(scene, camera);
    window.requestAnimationFrame(renderFrame);
  }

  /** Räumt alle GPU-Ressourcen und den Canvas auf. */
  function disposeGPU() {
    clothMesh.geometry.dispose();
    clothMesh.material.dispose();
    backfaceMesh.material.dispose();
    if (activeTexture) activeTexture.dispose();
    if (activeVideoElement) {
      activeVideoElement.pause();
      activeVideoElement.src = "";
    }
    // Canvas aus dem Mount-Element entfernen
    const canvas = renderer.domElement;
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    renderer.dispose();
  }

  renderFrame();
}

  // init starten
  init().catch((error) => {
    console.error("[CurtainDropper] Fehler beim Start:", error);
  });

  // Handle zurückgeben zum Abbrechen der Engine
  return {
    destroy() {
      destroyed = true;
    },
  };
}
