// Interactive 3-D view. ECI (x, y, z) maps to three.js (x, z, −y) so the Earth's spin axis
// points up. 1 scene unit = 1 Earth radius. Rendering runs at the display frame rate and
// never advances the simulation.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { HistoryColumns } from '../sim/layout';
import { symEig3, unpackCov } from '../sim/linalg';
import type { Meta } from '../sim/types';
import { DEG, OMEGA_EARTH, R_EARTH } from '../sim/units';

const S = 1 / R_EARTH;
const toThree = (x: number, y: number, z: number, s = S) => new THREE.Vector3(x * s, z * s, -y * s);

export interface OrbitViewProps {
  meta: Meta;
  history: HistoryColumns;
  version: number;
  truthVisible: boolean;
  k3: number; // sqrt(χ²₃(p)) for the joint ellipsoid
  confidence: number;
  predicted: Float64Array | null;
  particles: Float64Array | null;
  follow: boolean;
  reducedMotion: boolean; // the view never auto-animates; camera motion is user-driven only
  onMagnification?: (m: number) => void;
}

// Rendering is on demand (frameloop="demand"): a frame is drawn only when the simulation
// advances, the camera moves, or damping/follow motion is still settling.
function Controls({ follow, target, version }: { follow: boolean; target: THREE.Vector3 | null; version: number }) {
  const { camera, gl, invalidate } = useThree();
  const ctl = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minDistance = 0.05;
    c.maxDistance = 40;
    c.keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };
    c.listenToKeyEvents(gl.domElement);
    const onChange = () => invalidate();
    c.addEventListener('change', onChange);
    c.addEventListener('start', onChange);
    ctl.current = c;
    return () => {
      c.removeEventListener('change', onChange);
      c.removeEventListener('start', onChange);
      c.dispose();
    };
  }, [camera, gl, invalidate]);
  useEffect(() => invalidate(), [version, follow, invalidate]);
  useFrame(() => {
    const c = ctl.current;
    if (!c) return;
    const goal = follow && target ? target : new THREE.Vector3(0, 0, 0);
    const moving = c.target.distanceTo(goal) > 1e-4;
    if (moving) c.target.lerp(goal, follow ? 0.15 : 0.08);
    // update() returns true while damping is still moving the camera
    if (c.update() || moving) invalidate();
  });
  return null;
}

function Stars() {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts: number[] = [];
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 1500; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 60;
      pts.push(r * Math.sqrt(1 - u * u) * Math.cos(th), r * u, r * Math.sqrt(1 - u * u) * Math.sin(th));
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return <points geometry={geom}><pointsMaterial size={0.12} color="#9fb4d9" sizeAttenuation transparent opacity={0.7} /></points>;
}

function Graticule() {
  const geom = useMemo(() => {
    const pts: number[] = [];
    const r = 1.002;
    for (let lat = -60; lat <= 60; lat += 30)
      for (let lon = 0; lon < 360; lon += 4) {
        const a = lat * DEG, b = lon * DEG, b2 = (lon + 4) * DEG;
        pts.push(...toThree(r * Math.cos(a) * Math.cos(b), r * Math.cos(a) * Math.sin(b), r * Math.sin(a), 1).toArray());
        pts.push(...toThree(r * Math.cos(a) * Math.cos(b2), r * Math.cos(a) * Math.sin(b2), r * Math.sin(a), 1).toArray());
      }
    for (let lon = 0; lon < 360; lon += 30)
      for (let lat = -90; lat < 90; lat += 4) {
        const a = lat * DEG, a2 = (lat + 4) * DEG, b = lon * DEG;
        pts.push(...toThree(r * Math.cos(a) * Math.cos(b), r * Math.cos(a) * Math.sin(b), r * Math.sin(a), 1).toArray());
        pts.push(...toThree(r * Math.cos(a2) * Math.cos(b), r * Math.cos(a2) * Math.sin(b), r * Math.sin(a2), 1).toArray());
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return <lineSegments geometry={geom}><lineBasicMaterial color="#38e1ff" transparent opacity={0.22} /></lineSegments>;
}

function Earth({ theta, stations }: { theta: number; stations: { id: string; pos: THREE.Vector3; active: boolean }[] }) {
  return (
    <group rotation={[0, theta, 0]}>
      <mesh>
        <sphereGeometry args={[1, 64, 48]} />
        <meshStandardMaterial color="#0b2559" emissive="#071a3d" roughness={0.9} metalness={0.1} />
      </mesh>
      <Graticule />
      {/* prime meridian highlight so Earth's rotation is visible */}
      <mesh position={toThree(1.003, 0, 0, 1)}><sphereGeometry args={[0.012, 12, 12]} /><meshBasicMaterial color="#fbbf24" /></mesh>
      {stations.map((s) => (
        <mesh key={s.id} position={s.pos}>
          <coneGeometry args={[0.018, 0.05, 12]} />
          <meshBasicMaterial color={s.active ? '#a3e635' : '#64748b'} />
        </mesh>
      ))}
      <mesh scale={1.035}>
        <sphereGeometry args={[1, 48, 32]} />
        <meshBasicMaterial color="#38e1ff" transparent opacity={0.06} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

function Trail({ points, color, dashed = false, opacity = 0.9 }: { points: THREE.Vector3[]; color: string; dashed?: boolean; opacity?: number }) {
  const ref = useRef<THREE.Line>(null);
  const geom = useMemo(() => new THREE.BufferGeometry(), []);
  useEffect(() => {
    geom.setFromPoints(points);
    if (dashed && ref.current) ref.current.computeLineDistances();
  }, [points, geom, dashed]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — r3f's <line> clashes with the SVG element type
    <line ref={ref} geometry={geom}>
      {dashed ? <lineDashedMaterial color={color} dashSize={0.03} gapSize={0.02} transparent opacity={opacity} />
              : <lineBasicMaterial color={color} transparent opacity={opacity} />}
    </line>
  );
}

function sample<T>(n: number, max: number, f: (k: number) => T): T[] {
  const step = Math.max(1, Math.ceil(n / max));
  const out: T[] = [];
  for (let k = 0; k < n; k += step) out.push(f(k));
  if (n > 0 && (n - 1) % step !== 0) out.push(f(n - 1));
  return out;
}

export function OrbitView(p: OrbitViewProps) {
  const { meta, history: h, truthVisible } = p;
  const cw = meta.model === 'cw6';
  const k = h.t.length - 1;
  const t = k >= 0 ? h.t[k] : 0;

  // CW lab: relative frame, scaled to the motion (radial up, along-track right)
  const cwScale = useMemo(() => {
    if (!cw) return S;
    let m = 1;
    for (let i = 0; i < h.t.length; i++) m = Math.max(m, Math.abs(h.xTrue[0][i]), Math.abs(h.xTrue[1][i]), Math.abs(h.xTrue[2][i]));
    return 1.5 / m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cw, p.version]);
  const map = (x: number, y: number, z: number) => (cw ? new THREE.Vector3(y * cwScale, x * cwScale, z * cwScale) : toThree(x, y, z));

  const truth = useMemo(() => (k < 0 || !truthVisible ? [] : sample(h.t.length, 1500, (i) => map(h.xTrue[0][i], h.xTrue[1][i], h.xTrue[2][i]))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.version, truthVisible, cwScale]);
  const est = useMemo(() => (k < 0 ? [] : sample(h.t.length, 1500, (i) => map(h.xEst[0][i], h.xEst[1][i], h.xEst[2][i]))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.version, cwScale]);
  const predicted = useMemo(() => {
    const a = p.predicted;
    if (!a || a.length < 6) return [];
    const out: THREE.Vector3[] = [];
    for (let i = 0; i + 2 < a.length; i += 3) out.push(map(a[i], a[i + 1], a[i + 2]));
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.predicted, cwScale]);

  const estPos = k >= 0 ? map(h.xEst[0][k], h.xEst[1][k], h.xEst[2][k]) : null;
  const truePos = k >= 0 ? map(h.xTrue[0][k], h.xTrue[1][k], h.xTrue[2][k]) : null;

  // Joint position confidence ellipsoid, magnified to stay visible
  const ell = useMemo(() => {
    if (k < 0) return null;
    const P = unpackCov(h.posCov.map((c) => c[k]));
    const { values, vectors } = symEig3(P);
    const semi = values.map((v) => p.k3 * Math.sqrt(Math.max(v, 0)));
    const scale = cw ? cwScale : S;
    const want = cw ? 0.12 : 0.05; // target on-screen size (scene units)
    const raw = want / Math.max(1e-30, semi[0] * scale);
    const mag = raw <= 1 ? 1 : Math.pow(10, Math.floor(Math.log10(raw)));
    const m4 = new THREE.Matrix4();
    const ax = [0, 1, 2].map((c) => {
      const v = map(vectors[0][c], vectors[1][c], vectors[2][c]).divideScalar(cw ? cwScale : S).normalize();
      return v.multiplyScalar(Math.max(semi[c] * scale * mag, 1e-6));
    });
    m4.makeBasis(ax[0], ax[1], ax[2]);
    return { m4, mag };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.version, p.k3, cwScale]);
  const onMag = p.onMagnification;
  useEffect(() => {
    if (ell) onMag?.(ell.mag);
  }, [ell, onMag]);

  const theta = meta.greenwichAngleAtEpochRad + OMEGA_EARTH * t;
  const stations = useMemo(() => meta.sensors.filter((s) => s.station).map((s, idx) => {
    const st = s.station!;
    const r = 1 + st.altM / R_EARTH;
    const a = st.latDeg * DEG, b = st.lonDeg * DEG;
    const sensorIndex = meta.sensors.indexOf(s);
    return { id: s.id, idx, sensorIndex, pos: toThree(r * Math.cos(a) * Math.cos(b), r * Math.cos(a) * Math.sin(b), r * Math.sin(a), 1) };
  }), [meta.sensors]);
  const stationMarkers = stations.map((s) => ({ id: s.id, pos: s.pos, active: k >= 0 && h.sensorStatus[s.sensorIndex][k] === 1 }));
  const losLines = stations
    .filter((s) => k >= 0 && h.sensorStatus[s.sensorIndex][k] === 1 && truePos)
    .map((s) => ({ id: s.id, a: s.pos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), theta), b: truePos! }));

  const particleGeom = useMemo(() => {
    const a = p.particles;
    if (!a || a.length < 4 || !estPos || !ell) return null;
    const pts: number[] = [];
    const c = [h.xEst[0][k], h.xEst[1][k], h.xEst[2][k]];
    for (let i = 0; i + 3 < a.length + 1; i += 4) {
      // Offsets from the estimate, magnified by the same factor as the ellipsoid
      const v = map(c[0] + (a[i] - c[0]) * ell.mag, c[1] + (a[i + 1] - c[1]) * ell.mag, c[2] + (a[i + 2] - c[2]) * ell.mag);
      pts.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.particles, ell]);

  return (
    <Canvas frameloop="demand" camera={{ position: cw ? [0, 1.2, 3.2] : [0, 1.6, 3.6], fov: 45, near: 0.001, far: 500 }} dpr={[1, 1.5]}
      aria-label="3-D orbit view. Drag to rotate, scroll to zoom, arrow keys to pan." tabIndex={0}>
      <color attach="background" args={['#040812']} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 3, 4]} intensity={1.4} />
      <Stars />
      {!cw && <Earth theta={theta} stations={stationMarkers} />}
      {cw && (
        <group>
          <mesh><boxGeometry args={[0.06, 0.06, 0.06]} /><meshStandardMaterial color="#94a3b8" /></mesh>
          <gridHelper args={[4, 16, '#1b2b52', '#13203d']} rotation={[0, 0, 0]} />
          <axesHelper args={[0.6]} />
        </group>
      )}
      {losLines.map((l) => <Trail key={l.id} points={[l.a, l.b]} color="#a3e635" opacity={0.6} />)}
      {truthVisible && truth.length > 1 && <Trail points={truth} color="#2dd4bf" opacity={0.85} />}
      {est.length > 1 && <Trail points={est} color="#fbbf24" opacity={0.6} />}
      {predicted.length > 1 && <Trail points={predicted} color="#fbbf24" dashed opacity={0.5} />}
      {truthVisible && truePos && <mesh position={truePos}><sphereGeometry args={[0.014, 16, 16]} /><meshBasicMaterial color="#2dd4bf" /></mesh>}
      {estPos && <mesh position={estPos}><sphereGeometry args={[0.012, 16, 16]} /><meshBasicMaterial color="#fbbf24" /></mesh>}
      {estPos && ell && (
        <mesh matrixAutoUpdate={false} matrix={new THREE.Matrix4().makeTranslation(estPos.x, estPos.y, estPos.z).multiply(ell.m4)}>
          <sphereGeometry args={[1, 32, 24]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}
      {particleGeom && <points geometry={particleGeom}><pointsMaterial size={0.006} color="#a78bfa" transparent opacity={0.8} /></points>}
      <Controls follow={p.follow} target={estPos} version={p.version} />
    </Canvas>
  );
}
