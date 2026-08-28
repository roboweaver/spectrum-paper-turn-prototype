export const paperTurnVertexShader = `
attribute float shade;
attribute vec2 backUv;
varying vec2 vUv;
varying vec2 vBackUv;
varying float vShade;

void main() {
  vUv = uv;
  vBackUv = backUv;
  vShade = shade;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const paperTurnFragmentShader = `
uniform sampler2D paperTexture;
uniform sampler2D backTexture;
uniform float backTextureMix;
uniform float shadowStrength;
uniform float sheetAlpha;
varying vec2 vUv;
varying vec2 vBackUv;
varying float vShade;

void main() {
  vec4 front = texture2D(paperTexture, vUv);
  vec4 back = texture2D(backTexture, vBackUv);
  vec3 blank = mix(vec3(0.94, 0.93, 0.91), front.rgb, 0.12);
  vec3 reverse = mix(blank, back.rgb, backTextureMix * back.a);
  float highlight = 0.68 + vShade * 0.32;
  vec3 face = gl_FrontFacing ? front.rgb : reverse;
  float reverseShadow = gl_FrontFacing ? 0.0 : shadowStrength * 0.30;
  float alpha = gl_FrontFacing ? front.a : max(front.a, backTextureMix * back.a);
  gl_FragColor = vec4(face * highlight * (1.0 - reverseShadow), alpha * sheetAlpha);
  #include <colorspace_fragment>
}
`;
