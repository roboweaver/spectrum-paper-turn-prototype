import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

import { backFaceUvs, buildPaperFrame } from './geometry';
import { paperTurnFragmentShader, paperTurnVertexShader } from './paper-shaders';
import type { PaperFrame, PaperRenderer, Rect, RendererInput } from './types';

/** Peak fraction of shadowStrength applied to the contact shadow at full curl. */
const SHADOW_LIFT_SCALE = 0.4;

function validateFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${field}: expected a finite number.`);
  }
}

function validatePositiveNumber(value: number, field: string): void {
  validateFiniteNumber(value, field);

  if (value <= 0) {
    throw new Error(`Invalid ${field}: expected a number greater than 0.`);
  }
}

function validatePositiveInteger(value: number, field: string): void {
  validateFiniteNumber(value, field);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${field}: expected an integer greater than or equal to 1.`);
  }
}

function validateRect(rect: Rect, field: string): void {
  validateFiniteNumber(rect.left, `${field}.left`);
  validateFiniteNumber(rect.top, `${field}.top`);
  validatePositiveNumber(rect.width, `${field}.width`);
  validatePositiveNumber(rect.height, `${field}.height`);
}

function validateUnitInterval(value: number, field: string): void {
  validateFiniteNumber(value, field);

  if (value < 0 || value > 1) {
    throw new Error(`Invalid ${field}: expected a number between 0 and 1 inclusive.`);
  }
}

function resolveDevicePixelRatio(documentRef: Document): number {
  const devicePixelRatio = documentRef.defaultView?.devicePixelRatio ?? 1;
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
}

function removeNode(node: ChildNode | null | undefined): void {
  node?.parentNode?.removeChild(node);
}

function cleanupConstruction(resources: {
  overlay?: HTMLDivElement;
  renderer?: WebGLRenderer;
  geometry?: BufferGeometry;
  paperMaterial?: ShaderMaterial;
  shadowMaterial?: MeshBasicMaterial;
  texture?: CanvasTexture;
  backTexture?: CanvasTexture;
  scene?: Scene;
  paperMesh?: Mesh<BufferGeometry, ShaderMaterial>;
  shadowMesh?: Mesh<BufferGeometry, MeshBasicMaterial>;
}): void {
  if (resources.scene && resources.paperMesh && resources.shadowMesh) {
    resources.scene.remove(resources.shadowMesh, resources.paperMesh);
  }

  resources.geometry?.dispose();
  resources.paperMaterial?.dispose();
  resources.shadowMaterial?.dispose();
  resources.texture?.dispose();
  resources.backTexture?.dispose();

  if (resources.renderer) {
    resources.renderer.dispose();
    resources.renderer.forceContextLoss();
    removeNode(resources.renderer.domElement);
  }

  removeNode(resources.overlay);
}

export function buildMeshIndices(columns: number, rows: number): number[] {
  validatePositiveInteger(columns, 'columns');
  validatePositiveInteger(rows, 'rows');

  const indices: number[] = [];
  const stride = columns + 1;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * stride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;

      indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
    }
  }

  return indices;
}

export function buildUvs(columns: number, rows: number): Float32Array {
  validatePositiveInteger(columns, 'columns');
  validatePositiveInteger(rows, 'rows');

  const uvs = new Float32Array((columns + 1) * (rows + 1) * 2);

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;

    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const index = (row * (columns + 1) + column) * 2;

      uvs[index] = u;
      uvs[index + 1] = v;
    }
  }

  return uvs;
}

export class PaperTurnRenderer implements PaperRenderer {
  private readonly input: RendererInput;
  private readonly overlay: HTMLDivElement;
  private readonly renderer: WebGLRenderer;
  private readonly camera: OrthographicCamera;
  private readonly scene: Scene;
  private readonly geometry: BufferGeometry;
  private readonly paperMaterial: ShaderMaterial;
  private readonly shadowMaterial: MeshBasicMaterial;
  private readonly texture: CanvasTexture;
  private readonly paperMesh: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly shadowMesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly backTexture: CanvasTexture | null;
  private readonly positions: Float32Array;
  private readonly shade: Float32Array;
  private readonly positionAttribute: BufferAttribute;
  private readonly shadeAttribute: BufferAttribute;
  private disposed = false;

  constructor(input: RendererInput, documentRef: Document = document) {
    validatePositiveInteger(input.profile.meshColumns, 'profile.meshColumns');
    validatePositiveInteger(input.profile.meshRows, 'profile.meshRows');
    validatePositiveNumber(input.profile.maxTextureDpr, 'profile.maxTextureDpr');
    validateUnitInterval(input.profile.shadowStrength, 'profile.shadowStrength');
    validateRect(input.sourceRect, 'sourceRect');
    validateRect(input.destinationRect, 'destinationRect');

    this.input = input;

    const resources: {
      overlay?: HTMLDivElement;
      renderer?: WebGLRenderer;
      geometry?: BufferGeometry;
      paperMaterial?: ShaderMaterial;
      shadowMaterial?: MeshBasicMaterial;
      texture?: CanvasTexture;
      backTexture?: CanvasTexture;
      scene?: Scene;
      paperMesh?: Mesh<BufferGeometry, ShaderMaterial>;
      shadowMesh?: Mesh<BufferGeometry, MeshBasicMaterial>;
    } = {};

    try {
      const vertexCount = (input.profile.meshColumns + 1) * (input.profile.meshRows + 1);
      const overlay = documentRef.createElement('div');
      overlay.className = 'paper-turn-overlay';
      overlay.dataset.meshVertices = String(vertexCount);
      overlay.setAttribute('aria-hidden', 'true');
      overlay.setAttribute('role', 'presentation');
      resources.overlay = overlay;

      const renderer = new WebGLRenderer({ alpha: true, antialias: false });
      resources.renderer = renderer;
      renderer.domElement.setAttribute('aria-hidden', 'true');

      const devicePixelRatio = resolveDevicePixelRatio(documentRef);
      renderer.setPixelRatio(Math.min(devicePixelRatio, input.profile.maxTextureDpr));
      renderer.setSize(input.destinationRect.width, input.destinationRect.height, false);
      overlay.append(renderer.domElement);
      documentRef.body.append(overlay);

      const camera = new OrthographicCamera(
        input.destinationRect.left,
        input.destinationRect.left + input.destinationRect.width,
        input.destinationRect.top,
        input.destinationRect.top + input.destinationRect.height,
        -1000,
        1000,
      );
      camera.position.z = 500;

      const geometry = new BufferGeometry();
      resources.geometry = geometry;
      const positions = new Float32Array(vertexCount * 3);
      const shade = new Float32Array(vertexCount);
      const positionAttribute = new BufferAttribute(positions, 3);
      const uvAttribute = new BufferAttribute(buildUvs(input.profile.meshColumns, input.profile.meshRows), 2);
      const shadeAttribute = new BufferAttribute(shade, 1);
      geometry.setAttribute('position', positionAttribute);
      geometry.setAttribute('uv', uvAttribute);
      geometry.setAttribute('shade', shadeAttribute);
      geometry.setAttribute(
        'backUv',
        new BufferAttribute(
          backFaceUvs(input.grabbedCorner, input.profile.meshColumns, input.profile.meshRows),
          2,
        ),
      );
      geometry.setIndex(buildMeshIndices(input.profile.meshColumns, input.profile.meshRows));

      const texture = new CanvasTexture(input.texture);
      texture.colorSpace = SRGBColorSpace;
      // The mesh uses screen-space y (row 0 at the top), so the default
      // bottom-up sampling would render the captured card upside down.
      texture.flipY = false;
      resources.texture = texture;

      // The sheet is one page: the source is printed on the front and the
      // destination on the back. Without a destination capture the reverse
      // degrades to blank paper rather than failing the transition.
      let backTexture: CanvasTexture | undefined;

      if (input.backTexture) {
        backTexture = new CanvasTexture(input.backTexture);
        backTexture.colorSpace = SRGBColorSpace;
        backTexture.flipY = false;
        resources.backTexture = backTexture;
      }

      const paperMaterial = new ShaderMaterial({
        uniforms: {
          paperTexture: { value: texture },
          backTexture: { value: backTexture ?? texture },
          backTextureMix: { value: backTexture ? 1 : 0 },
          shadowStrength: { value: input.profile.shadowStrength },
          sheetAlpha: { value: 1 },
        },
        vertexShader: paperTurnVertexShader,
        fragmentShader: paperTurnFragmentShader,
        side: DoubleSide,
        transparent: true,
      });
      resources.paperMaterial = paperMaterial;

      const paperMesh = new Mesh(geometry, paperMaterial);
      paperMesh.frustumCulled = false;
      resources.paperMesh = paperMesh;

      const shadowMaterial = new MeshBasicMaterial({
        color: 0x000000,
        opacity: 0,
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
      });
      resources.shadowMaterial = shadowMaterial;

      const shadowMesh = new Mesh(geometry, shadowMaterial);
      shadowMesh.position.set(10, 14, -12);
      shadowMesh.frustumCulled = false;
      resources.shadowMesh = shadowMesh;

      const scene = new Scene();
      scene.add(shadowMesh, paperMesh);
      resources.scene = scene;

      this.overlay = overlay;
      this.renderer = renderer;
      this.camera = camera;
      this.scene = scene;
      this.geometry = geometry;
      this.paperMaterial = paperMaterial;
      this.shadowMaterial = shadowMaterial;
      this.texture = texture;
      this.backTexture = backTexture ?? null;
      this.paperMesh = paperMesh;
      this.shadowMesh = shadowMesh;
      this.positions = positions;
      this.shade = shade;
      this.positionAttribute = positionAttribute;
      this.shadeAttribute = shadeAttribute;
    } catch (error) {
      cleanupConstruction(resources);
      throw error;
    }
  }

  render(progress: number): PaperFrame {
    if (this.disposed) {
      throw new Error('PaperTurnRenderer cannot render after disposal');
    }

    const frame = buildPaperFrame(
      this.input.sourceRect,
      this.input.destinationRect,
      this.input.grabbedCorner,
      progress,
      this.input.profile,
    );

    this.positions.set(frame.positions);
    this.shade.set(frame.shade);
    this.positionAttribute.needsUpdate = true;
    this.shadeAttribute.needsUpdate = true;
    this.paperMaterial.uniforms.sheetAlpha!.value = frame.alpha;
    // Gate the contact shadow on lift so a settled sheet never tints the page.
    this.shadowMaterial.opacity =
      this.input.profile.shadowStrength * SHADOW_LIFT_SCALE * frame.lift * frame.alpha;
    this.overlay.dataset.progress = progress.toFixed(3);
    this.renderer.render(this.scene, this.camera);

    return frame;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.scene.remove(this.shadowMesh, this.paperMesh);
    this.geometry.dispose();
    this.paperMaterial.dispose();
    this.shadowMaterial.dispose();
    this.texture.dispose();
    this.backTexture?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    removeNode(this.renderer.domElement);
    removeNode(this.overlay);
  }
}
