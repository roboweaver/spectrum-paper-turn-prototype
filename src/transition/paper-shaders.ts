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
varying vec2 vUv;
varying float vShade;

void main() {
  vec4 front = texture2D(paperTexture, vUv);
  vec3 reverse = mix(vec3(0.86, 0.87, 0.89), front.rgb, 0.2);
  float highlight = 0.78 + vShade * 0.32;
  vec3 face = gl_FrontFacing ? front.rgb : reverse;
  float reverseShadow = gl_FrontFacing ? 0.0 : shadowStrength * 0.35;
  gl_FragColor = vec4(face * highlight * (1.0 - reverseShadow), front.a);
  #include <colorspace_fragment>
}
`;
