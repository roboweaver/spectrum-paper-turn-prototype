export const paperTurnVertexShader = `
attribute float shade;
varying vec2 vUv;
varying float vShade;

void main() {
  vUv = uv;
  vShade = shade;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const paperTurnFragmentShader = `
uniform sampler2D paperTexture;
uniform float shadowStrength;
uniform float sheetAlpha;
varying vec2 vUv;
varying float vShade;

void main() {
  vec4 front = texture2D(paperTexture, vUv);
  vec3 reverse = mix(vec3(0.94, 0.93, 0.91), front.rgb, 0.12);
  float highlight = 0.68 + vShade * 0.32;
  vec3 face = gl_FrontFacing ? front.rgb : reverse;
  float reverseShadow = gl_FrontFacing ? 0.0 : shadowStrength * 0.30;
  gl_FragColor = vec4(face * highlight * (1.0 - reverseShadow), front.a * sheetAlpha);
  #include <colorspace_fragment>
}
`;
