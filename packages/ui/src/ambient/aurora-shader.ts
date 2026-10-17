/** Full-screen triangle; the fragment shader does all the work. */
export const AURORA_VERTEX = /* glsl */ `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

/**
 * Slow mesh-gradient aurora: four soft colour fields orbiting on incommensurate periods over the
 * theme base, with a whisper of grain to avoid banding on 8-bit panels (BRIEF §7.3).
 */
export const AURORA_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uBase;
uniform vec3 uColors[4];
uniform float uIntensity;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = vUv * aspect;
  float t = uTime * 0.035;

  vec2 centers[4];
  centers[0] = vec2(0.18 + 0.10 * sin(t * 1.0), 0.78 + 0.08 * cos(t * 1.3)) * aspect;
  centers[1] = vec2(0.62 + 0.14 * cos(t * 0.7), 0.30 + 0.10 * sin(t * 0.9)) * aspect;
  centers[2] = vec2(0.92 + 0.08 * sin(t * 1.1 + 1.7), 0.86 + 0.07 * sin(t * 0.6)) * aspect;
  centers[3] = vec2(0.40 + 0.12 * sin(t * 0.5 + 3.1), 0.05 + 0.08 * cos(t * 0.8)) * aspect;
  float radii[4];
  radii[0] = 0.55; radii[1] = 0.62; radii[2] = 0.48; radii[3] = 0.50;

  vec3 color = uBase;
  for (int i = 0; i < 4; i++) {
    float d = distance(p, centers[i]) / radii[i];
    float w = exp(-d * d * 2.2) * uIntensity;
    color = mix(color, uColors[i], clamp(w, 0.0, 1.0));
  }
  // Vignette keeps edges calm behind the server rail and member list.
  float v = smoothstep(1.25, 0.25, distance(vUv, vec2(0.5)));
  color = mix(uBase, color, 0.55 + 0.45 * v);
  color += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}
`;
