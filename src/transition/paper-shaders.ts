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
  vec3 reverseBase = vec3(0.86, 0.87, 0.89) * 0.8 + front.rgb * 0.2;
  float highlight = 0.78 + vShade * 0.32;
  vec3 reverse = reverseBase * highlight;
  vec3 color = gl_FrontFacing ? front.rgb : reverse;

  if (!gl_FrontFacing) {
    color *= 1.0 - shadowStrength * 0.35;
  }

  gl_FragColor = vec4(color, front.a);
}
`;
