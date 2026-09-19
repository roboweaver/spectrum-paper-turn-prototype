import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SINGLE_TILE_ANCHOR, resolveGrabAnchor } from '../../src/transition/grab-anchor';
import { backFaceUvs, buildPaperFrame } from '../../src/transition/geometry';
import { defaultMotionProfile } from '../../src/transition/motion-profile';
import type { Corner, GrabAnchor, RendererInput } from '../../src/transition/types';

// Every real geometry implementation is kept — only the call record is added.
// Two of the renderer's obligations are claims about calls rather than about
// output: back-face uvs are computed exactly once per instance, and every frame
// is folded about the one anchor resolved at activation.
vi.mock('../../src/transition/geometry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/transition/geometry')>();

  return {
    ...actual,
    backFaceUvs: vi.fn(actual.backFaceUvs),
    buildPaperFrame: vi.fn(actual.buildPaperFrame),
  };
});

vi.mock('three', () => {
  class MockBufferAttribute {
    array: ArrayLike<number>;
    itemSize: number;
    needsUpdate = false;

    constructor(array: ArrayLike<number>, itemSize: number) {
      this.array = array;
      this.itemSize = itemSize;
    }
  }

  class MockBufferGeometry {
    attributes: Record<string, MockBufferAttribute> = {};
    index: number[] | null = null;
    dispose = vi.fn();

    setAttribute(name: string, attribute: MockBufferAttribute) {
      this.attributes[name] = attribute;
      return this;
    }

    setIndex(index: number[]) {
      this.index = index;
      return this;
    }
  }

  class MockCanvasTexture {
    image: HTMLCanvasElement;
    colorSpace?: unknown;
    flipY?: boolean;
    dispose = vi.fn();

    constructor(image: HTMLCanvasElement) {
      this.image = image;
    }
  }

  class MockShaderMaterial {
    uniforms: Record<string, { value: unknown }>;
    vertexShader: string;
    fragmentShader: string;
    side: unknown;
    transparent: boolean;
    dispose = vi.fn();

    constructor(options: {
      uniforms: Record<string, { value: unknown }>;
      vertexShader: string;
      fragmentShader: string;
      side: unknown;
      transparent: boolean;
    }) {
      this.uniforms = options.uniforms;
      this.vertexShader = options.vertexShader;
      this.fragmentShader = options.fragmentShader;
      this.side = options.side;
      this.transparent = options.transparent;
    }
  }

  class MockMeshBasicMaterial {
    color: number;
    opacity: number;
    transparent: boolean;
    side: unknown;
    depthWrite: boolean;
    dispose = vi.fn();

    constructor(options: {
      color: number;
      opacity: number;
      transparent: boolean;
      side: unknown;
      depthWrite: boolean;
    }) {
      this.color = options.color;
      this.opacity = options.opacity;
      this.transparent = options.transparent;
      this.side = options.side;
      this.depthWrite = options.depthWrite;
    }
  }

  class MockMesh {
    geometry: MockBufferGeometry;
    material: MockShaderMaterial | MockMeshBasicMaterial;
    position = { set: vi.fn() };
    frustumCulled = true;

    constructor(geometry: MockBufferGeometry, material: MockShaderMaterial | MockMeshBasicMaterial) {
      this.geometry = geometry;
      this.material = material;
    }
  }

  class MockOrthographicCamera {
    left: number;
    right: number;
    top: number;
    bottom: number;
    near: number;
    far: number;
    position = { z: 0 };

    constructor(left: number, right: number, top: number, bottom: number, near: number, far: number) {
      this.left = left;
      this.right = right;
      this.top = top;
      this.bottom = bottom;
      this.near = near;
      this.far = far;
    }
  }

  class MockScene {
    objects: MockMesh[] = [];

    add(...objects: MockMesh[]) {
      this.objects.push(...objects);
    }

    remove(...objects: MockMesh[]) {
      this.objects = this.objects.filter((object) => !objects.includes(object));
    }
  }

  class MockWebGLRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    forceContextLoss = vi.fn();
  }

  const mockState = {
    geometries: [] as MockBufferGeometry[],
    materials: [] as Array<MockShaderMaterial | MockMeshBasicMaterial>,
    meshes: [] as MockMesh[],
    scenes: [] as MockScene[],
    cameras: [] as MockOrthographicCamera[],
    renderers: [] as MockWebGLRenderer[],
    textures: [] as MockCanvasTexture[],
    failAt: null as 'mesh-basic-material' | null,
    reset() {
      this.geometries.length = 0;
      this.materials.length = 0;
      this.meshes.length = 0;
      this.scenes.length = 0;
      this.cameras.length = 0;
      this.renderers.length = 0;
      this.textures.length = 0;
      this.failAt = null;
    },
  };

  return {
    BufferAttribute: class extends MockBufferAttribute {},
    BufferGeometry: class extends MockBufferGeometry {
      constructor() {
        super();
        mockState.geometries.push(this);
      }
    },
    CanvasTexture: class extends MockCanvasTexture {
      constructor(image: HTMLCanvasElement) {
        super(image);
        mockState.textures.push(this);
      }
    },
    DoubleSide: 'DoubleSide',
    Mesh: class extends MockMesh {
      constructor(geometry: MockBufferGeometry, material: MockShaderMaterial | MockMeshBasicMaterial) {
        super(geometry, material);
        mockState.meshes.push(this);
      }
    },
    MeshBasicMaterial: class extends MockMeshBasicMaterial {
      constructor(options: ConstructorParameters<typeof MockMeshBasicMaterial>[0]) {
        if (mockState.failAt === 'mesh-basic-material') {
          mockState.failAt = null;
          throw new Error('Mock mesh basic material failure');
        }
        super(options);
        mockState.materials.push(this);
      }
    },
    OrthographicCamera: class extends MockOrthographicCamera {
      constructor(left: number, right: number, top: number, bottom: number, near: number, far: number) {
        super(left, right, top, bottom, near, far);
        mockState.cameras.push(this);
      }
    },
    Scene: class extends MockScene {
      constructor() {
        super();
        mockState.scenes.push(this);
      }
    },
    ShaderMaterial: class extends MockShaderMaterial {
      constructor(options: ConstructorParameters<typeof MockShaderMaterial>[0]) {
        super(options);
        mockState.materials.push(this);
      }
    },
    SRGBColorSpace: 'SRGBColorSpace',
    WebGLRenderer: class extends MockWebGLRenderer {
      constructor() {
        super();
        mockState.renderers.push(this);
      }
    },
    __mock: mockState,
  };
});

import * as threeModule from 'three';
import { paperTurnFragmentShader, paperTurnVertexShader } from '../../src/transition/paper-shaders';
import { PaperTurnRenderer, buildMeshIndices, buildUvs } from '../../src/transition/paper-turn-renderer';

const threeMock = (
  threeModule as unknown as {
    __mock: {
      geometries: Array<{
        attributes: Record<
          string,
          { array: ArrayLike<number>; itemSize: number; needsUpdate: boolean }
        >;
        dispose: ReturnType<typeof vi.fn>;
      }>;
      materials: Array<
        Record<string, unknown> & {
          uniforms?: Record<string, { value: unknown }>;
          dispose: ReturnType<typeof vi.fn>;
        }
      >;
      meshes: Array<{ position: { set: ReturnType<typeof vi.fn> } }>;
      scenes: Array<{ objects: unknown[] }>;
      cameras: Array<Record<string, unknown>>;
      renderers: Array<{
        setPixelRatio: ReturnType<typeof vi.fn>;
        setSize: ReturnType<typeof vi.fn>;
        render: ReturnType<typeof vi.fn>;
        dispose: ReturnType<typeof vi.fn>;
        forceContextLoss: ReturnType<typeof vi.fn>;
      }>;
      textures: Array<{
        image: HTMLCanvasElement;
        colorSpace?: unknown;
        flipY?: boolean;
        dispose: ReturnType<typeof vi.fn>;
      }>;
      failAt: 'mesh-basic-material' | null;
      reset(): void;
    };
  }
).__mock;

function createInput(): RendererInput {
  return {
    sourceRect: { left: 100, top: 80, width: 240, height: 160 },
    destinationRect: { left: 0, top: 0, width: 1000, height: 700 },
    grabAnchor: 'top-right',
    texture: document.createElement('canvas'),
    backTexture: null,
    profile: defaultMotionProfile,
  };
}

/** The eight published anchor literals, in clockwise order from `top-left`. */
const allAnchors: readonly GrabAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-right',
  'bottom-right',
  'bottom-center',
  'bottom-left',
  'middle-left',
] as const;

const backFaceUvsSpy = vi.mocked(backFaceUvs);
const buildPaperFrameSpy = vi.mocked(buildPaperFrame);

function requireOverlay(documentRef: Document = document): HTMLElement {
  const overlay = documentRef.body.querySelector<HTMLElement>('.paper-turn-overlay');

  if (!overlay) {
    throw new Error('Expected the paper turn overlay to be attached');
  }

  return overlay;
}

/**
 * Every attribute anywhere in the document whose value carries the anchor
 * string, reported as `element[attribute]`, so a second carrier shows up by name
 * rather than as a bare count mismatch.
 */
function anchorCarriers(anchor: GrabAnchor, documentRef: Document = document): string[] {
  const carriers: string[] = [];

  for (const element of Array.from(documentRef.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.value.includes(anchor)) {
        carriers.push(`${element.localName}[${attribute.name}]`);
      }
    }
  }

  return carriers;
}

function createDocumentWithDevicePixelRatio(devicePixelRatio?: number): Document {
  const documentRef = document.implementation.createHTMLDocument('paper-turn');
  Object.defineProperty(documentRef, 'defaultView', {
    configurable: true,
    value: devicePixelRatio === undefined ? undefined : { devicePixelRatio },
  });
  return documentRef;
}

const originalDevicePixelRatio = window.devicePixelRatio;

beforeEach(() => {
  document.body.innerHTML = '';
  threeMock.reset();
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: 3,
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: originalDevicePixelRatio,
  });
});

describe('paper mesh buffers', () => {
  it('creates two triangles per cell for a 20x14 mesh', () => {
    const indices = buildMeshIndices(20, 14);

    expect(indices).toHaveLength(20 * 14 * 6);
    expect(Math.max(...indices)).toBe((20 + 1) * (14 + 1) - 1);
  });

  it('creates normalized UVs for every vertex', () => {
    expect(Array.from(buildUvs(2, 1))).toEqual([0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1]);
  });

  it.each([
    ['columns', 0, 1],
    ['columns', 1.5, 1],
    ['columns', NaN, 1],
    ['rows', 1, 0],
    ['rows', 1, 1.5],
    ['rows', 1, Infinity],
  ] as const)('rejects invalid %s dimensions', (_field, columns, rows) => {
    expect(() => buildMeshIndices(columns, rows)).toThrow(/greater than or equal to 1|finite number/);
    expect(() => buildUvs(columns, rows)).toThrow(/greater than or equal to 1|finite number/);
  });
});

describe('paper shaders', () => {
  it('forwards uv and shade through the vertex shader', () => {
    expect(paperTurnVertexShader).toContain('attribute float shade;');
    expect(paperTurnVertexShader).toContain('attribute vec2 backUv;');
    expect(paperTurnVertexShader).toContain('varying vec2 vUv;');
    expect(paperTurnVertexShader).toContain('varying vec2 vBackUv;');
    expect(paperTurnVertexShader).toContain('varying float vShade;');
    expect(paperTurnVertexShader).toContain('vUv = uv;');
    expect(paperTurnVertexShader).toContain('vBackUv = backUv;');
    expect(paperTurnVertexShader).toContain('vShade = shade;');
    expect(paperTurnVertexShader).toContain(
      'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    );
  });

  it('uses front and reverse fragment shading rules', () => {
    const normalizedShader = paperTurnFragmentShader.replace(/\s+/g, ' ').trim();

    expect(paperTurnFragmentShader).toContain('uniform sampler2D paperTexture;');
    expect(paperTurnFragmentShader).toContain('uniform sampler2D backTexture;');
    expect(paperTurnFragmentShader).toContain('uniform float backTextureMix;');
    expect(paperTurnFragmentShader).toContain('uniform float shadowStrength;');
    expect(paperTurnFragmentShader).toContain('uniform float sheetAlpha;');
    expect(normalizedShader).toContain(
      'vec4 back = texture2D(backTexture, vBackUv); vec3 blank = mix(vec3(0.94, 0.93, 0.91), front.rgb, 0.12); vec3 reverse = mix(blank, back.rgb, backTextureMix * back.a); float highlight = 0.68 + vShade * 0.32; vec3 face = gl_FrontFacing ? front.rgb : reverse; float reverseShadow = gl_FrontFacing ? 0.0 : shadowStrength * 0.30; float alpha = gl_FrontFacing ? front.a : max(front.a, backTextureMix * back.a); gl_FragColor = vec4(face * highlight * (1.0 - reverseShadow), alpha * sheetAlpha); #include <colorspace_fragment>',
    );
    expect(normalizedShader).not.toContain('reverseBase');
  });
});

describe('PaperTurnRenderer reverse face', () => {
  it('prints the destination capture on the back with mirrored uvs', () => {
    const backTexture = document.createElement('canvas');
    const input: RendererInput = { ...createInput(), backTexture };
    const renderer = new PaperTurnRenderer(input);
    const geometry = threeMock.geometries[0];
    const uniforms = threeMock.materials[0]?.uniforms;

    expect(threeMock.textures).toHaveLength(2);
    expect(threeMock.textures[1]?.image).toBe(backTexture);
    // Screen-space y means the default bottom-up sampling would invert the page.
    expect(threeMock.textures[1]?.flipY).toBe(false);
    expect(uniforms?.backTexture?.value).toBe(threeMock.textures[1]);
    expect(uniforms?.backTextureMix?.value).toBe(1);

    const backUv = geometry?.attributes.backUv;
    expect(backUv?.itemSize).toBe(2);
    expect(backUv?.array).toEqual(
      backFaceUvs(
        input.grabAnchor as Corner,
        input.profile.meshColumns,
        input.profile.meshRows,
      ),
    );

    renderer.dispose();

    expect(threeMock.textures[1]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('degrades to blank paper when the destination capture is unavailable', () => {
    const renderer = new PaperTurnRenderer({ ...createInput(), backTexture: null });
    const uniforms = threeMock.materials[0]?.uniforms;

    expect(threeMock.textures).toHaveLength(1);
    expect(uniforms?.backTexture?.value).toBe(threeMock.textures[0]);
    expect(uniforms?.backTextureMix?.value).toBe(0);

    renderer.dispose();

    expect(threeMock.textures[0]?.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('PaperTurnRenderer', () => {
  it('creates the disposable scene and updates mesh buffers on render', () => {
    const input = createInput();
    const renderer = new PaperTurnRenderer(input);
    const overlay = document.body.querySelector('.paper-turn-overlay');
    const canvas = document.querySelector('canvas');

    expect(overlay?.getAttribute('data-mesh-vertices')).toBe(
      String((input.profile.meshColumns + 1) * (input.profile.meshRows + 1)),
    );
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(overlay?.getAttribute('role')).toBe('presentation');
    expect(document.body.children).toHaveLength(1);
    expect(document.body.firstElementChild).toBe(overlay);
    expect(overlay?.children).toHaveLength(1);
    expect(overlay?.firstElementChild).toBe(canvas);
    expect(document.body.querySelectorAll('canvas')).toHaveLength(1);
    expect(canvas?.getAttribute('aria-hidden')).toBe('true');
    expect(threeMock.renderers[0]?.setPixelRatio).toHaveBeenCalledWith(input.profile.maxTextureDpr);
    expect(threeMock.renderers[0]?.setSize).toHaveBeenCalledWith(
      input.destinationRect.width,
      input.destinationRect.height,
      false,
    );
    expect(threeMock.cameras[0]).toMatchObject({
      left: input.destinationRect.left,
      right: input.destinationRect.left + input.destinationRect.width,
      top: input.destinationRect.top,
      bottom: input.destinationRect.top + input.destinationRect.height,
      near: -1000,
      far: 1000,
      position: { z: 500 },
    });

    const frame = renderer.render(0.375);
    const expected = buildPaperFrame(
      input.sourceRect,
      input.destinationRect,
      input.grabAnchor as Corner,
      0.375,
      input.profile,
    );
    const geometry = threeMock.geometries[0];

    expect(geometry).toBeDefined();

    if (!geometry) {
      throw new Error('Expected mesh geometry to be created');
    }

    expect(Array.from(frame.positions)).toEqual(Array.from(expected.positions));
    expect(Array.from(frame.shade)).toEqual(Array.from(expected.shade));
    expect(frame.revealClipPath).toBe(expected.revealClipPath);
    expect(Array.from(geometry.attributes.position!.array)).toEqual(Array.from(expected.positions));
    expect(Array.from(geometry.attributes.shade!.array)).toEqual(Array.from(expected.shade));
    expect(geometry.attributes.position!.needsUpdate).toBe(true);
    expect(geometry.attributes.shade!.needsUpdate).toBe(true);
    expect(overlay?.getAttribute('data-progress')).toBe('0.375');
    expect(threeMock.renderers[0]?.render).toHaveBeenCalledTimes(1);
    expect(threeMock.scenes[0]?.objects).toHaveLength(2);
    expect(threeMock.scenes[0]?.objects[0]).toBe(threeMock.meshes[1]);
    expect(threeMock.scenes[0]?.objects[1]).toBe(threeMock.meshes[0]);
    expect(threeMock.meshes[1]?.position.set).toHaveBeenCalledWith(10, 14, -12);
    expect(threeMock.textures[0]?.colorSpace).toBe('SRGBColorSpace');
    expect(threeMock.materials[0]).toMatchObject({
      uniforms: {
        paperTexture: { value: threeMock.textures[0] },
        shadowStrength: { value: input.profile.shadowStrength },
      },
      vertexShader: paperTurnVertexShader,
      fragmentShader: paperTurnFragmentShader,
      side: 'DoubleSide',
      transparent: true,
    });
    expect(threeMock.materials[1]).toMatchObject({
      color: 0x000000,
      transparent: true,
      side: 'DoubleSide',
      depthWrite: false,
    });
  });

  it('gates the contact shadow so a settled sheet never tints the page', () => {
    const input = createInput();
    const renderer = new PaperTurnRenderer(input);
    const shadowMaterial = threeMock.materials[1] as unknown as { opacity: number };

    expect(shadowMaterial.opacity).toBe(0);

    renderer.render(0);
    expect(shadowMaterial.opacity).toBeCloseTo(0, 6);

    renderer.render(0.5);
    expect(shadowMaterial.opacity).toBeGreaterThan(0);
    expect(shadowMaterial.opacity).toBeLessThan(input.profile.shadowStrength);

    renderer.render(1);
    expect(shadowMaterial.opacity).toBeCloseTo(0, 6);

    renderer.dispose();
  });

  it('keeps the sheet opaque so the page is never drawn twice', () => {
    const input = createInput();
    const renderer = new PaperTurnRenderer(input);
    const paperMaterial = threeMock.materials[0] as unknown as {
      uniforms: { sheetAlpha: { value: number } };
    };

    for (const progress of [0, 0.5, 0.78, 1]) {
      expect(renderer.render(progress).alpha).toBe(1);
      expect(paperMaterial.uniforms.sheetAlpha.value).toBe(1);
    }

    renderer.dispose();
  });

  it('uses the provided document window device pixel ratio instead of the global window', () => {
    const input = createInput();
    const documentRef = createDocumentWithDevicePixelRatio(1.5);

    new PaperTurnRenderer(input, documentRef);

    expect(threeMock.renderers[0]?.setPixelRatio).toHaveBeenCalledWith(1.5);
    expect(documentRef.body.querySelector('.paper-turn-overlay')).not.toBeNull();
    expect(document.body.querySelector('.paper-turn-overlay')).toBeNull();
  });

  it('falls back to a device pixel ratio of 1 when the provided document window value is invalid', () => {
    const input = createInput();
    const documentRef = createDocumentWithDevicePixelRatio(Number.POSITIVE_INFINITY);

    new PaperTurnRenderer(input, documentRef);

    expect(threeMock.renderers[0]?.setPixelRatio).toHaveBeenCalledWith(1);
  });

  it.each([
    ['destinationRect.left', { left: Number.NaN }],
    ['destinationRect.top', { top: Number.POSITIVE_INFINITY }],
  ] as const)('rejects invalid %s values before camera setup', (_field, destinationRect) => {
    const input = {
      ...createInput(),
      destinationRect: {
        ...createInput().destinationRect,
        ...destinationRect,
      },
    };

    expect(() => new PaperTurnRenderer(input)).toThrow(/Invalid destinationRect\.(left|top)/);
    expect(document.body.children).toHaveLength(0);
    expect(threeMock.renderers).toHaveLength(0);
  });

  it.each([
    ['sourceRect.left', { left: Number.NaN }],
    ['sourceRect.top', { top: Number.POSITIVE_INFINITY }],
    ['sourceRect.width', { width: 0 }],
    ['sourceRect.height', { height: -1 }],
  ] as const)('rejects invalid %s values before overlay and renderer creation', (field, sourceRect) => {
    const input = createInput();

    expect(() =>
      new PaperTurnRenderer({
        ...input,
        sourceRect: {
          ...input.sourceRect,
          ...sourceRect,
        },
      }),
    ).toThrow(new RegExp(`Invalid ${field.replace('.', '\\.')}`));
    expect(document.body.querySelector('.paper-turn-overlay')).toBeNull();
    expect(threeMock.renderers).toHaveLength(0);
  });

  it.each([-0.01, 1.01])('rejects out-of-range shadowStrength values: %s', (shadowStrength) => {
    const input = {
      ...createInput(),
      profile: {
        ...defaultMotionProfile,
        shadowStrength,
      },
    };

    expect(() => new PaperTurnRenderer(input)).toThrow(/Invalid profile\.shadowStrength/);
    expect(threeMock.renderers).toHaveLength(0);
  });

  it('cleans up attached DOM and partial resources when construction fails after renderer attachment', () => {
    const input = createInput();
    threeMock.failAt = 'mesh-basic-material';

    expect(() => new PaperTurnRenderer(input)).toThrow('Mock mesh basic material failure');

    expect(document.body.querySelector('.paper-turn-overlay')).toBeNull();
    expect(document.body.querySelectorAll('canvas')).toHaveLength(0);
    expect(threeMock.geometries[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(threeMock.materials[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(threeMock.textures[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(threeMock.renderers[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(threeMock.renderers[0]?.forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it('throws when rendering after disposal and releases DOM and rendering resources idempotently', () => {
    const input = createInput();
    const renderer = new PaperTurnRenderer(input);
    const [geometry] = threeMock.geometries;
    const [paperMaterial, shadowMaterial] = threeMock.materials;
    const [texture] = threeMock.textures;
    const [webglRenderer] = threeMock.renderers;

    renderer.dispose();
    renderer.dispose();

    expect(() => renderer.render(0.5)).toThrow('PaperTurnRenderer cannot render after disposal');
    expect(document.body.querySelector('.paper-turn-overlay')).toBeNull();
    expect(document.body.querySelectorAll('canvas')).toHaveLength(0);
    expect(geometry?.dispose).toHaveBeenCalledTimes(1);
    expect(paperMaterial?.dispose).toHaveBeenCalledTimes(1);
    expect(shadowMaterial?.dispose).toHaveBeenCalledTimes(1);
    expect(texture?.dispose).toHaveBeenCalledTimes(1);
    expect(webglRenderer?.dispose).toHaveBeenCalledTimes(1);
    expect(webglRenderer?.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(threeMock.scenes[0]?.objects).toHaveLength(0);
  });
});

describe('PaperTurnRenderer resolved anchor', () => {
  beforeEach(() => {
    backFaceUvsSpy.mockClear();
    buildPaperFrameSpy.mockClear();
  });

  it.each(allAnchors)(
    'computes back-face uvs once for %s and folds every frame about that anchor',
    (anchor) => {
      const input: RendererInput = { ...createInput(), grabAnchor: anchor };
      const renderer = new PaperTurnRenderer(input);

      // Back-face uvs depend on the anchor alone, so construction is the only
      // place they may be computed.
      expect(backFaceUvsSpy).toHaveBeenCalledTimes(1);
      expect(backFaceUvsSpy).toHaveBeenCalledWith(
        anchor,
        input.profile.meshColumns,
        input.profile.meshRows,
      );
      expect(buildPaperFrameSpy).not.toHaveBeenCalled();

      const progresses = [0, 0.25, 0.5, 0.875, 1];

      for (const progress of progresses) {
        renderer.render(progress);
      }

      expect(backFaceUvsSpy).toHaveBeenCalledTimes(1);
      expect(buildPaperFrameSpy).toHaveBeenCalledTimes(progresses.length);

      for (const call of buildPaperFrameSpy.mock.calls) {
        expect(call[2]).toBe(anchor);
      }

      renderer.dispose();

      expect(backFaceUvsSpy).toHaveBeenCalledTimes(1);
    },
  );

  it.each(allAnchors)('publishes %s on the overlay dataset and nowhere else', (anchor) => {
    const input: RendererInput = { ...createInput(), grabAnchor: anchor };
    const renderer = new PaperTurnRenderer(input);
    const overlay = requireOverlay();

    // Written when the overlay is created, so it is already readable before the
    // first frame writes a progress value.
    expect(overlay.dataset.progress).toBeUndefined();
    expect(overlay.dataset.grabAnchor).toBe(anchor);
    expect(allAnchors).toContain(overlay.dataset.grabAnchor);
    expect(overlay.getAttribute('data-grab-anchor')).toBe(anchor);
    expect(overlay.dataset.grabAnchor).toBe(overlay.dataset.grabAnchor?.trim());
    expect(overlay.dataset.grabAnchor).toMatch(/^[a-z]+-[a-z]+$/);
    expect(overlay.dataset.meshVertices).toBe(
      String((input.profile.meshColumns + 1) * (input.profile.meshRows + 1)),
    );

    for (const progress of [0, 0.25, 0.5, 1]) {
      renderer.render(progress);

      expect(overlay.dataset.grabAnchor).toBe(anchor);
      expect(overlay.dataset.progress).toBe(progress.toFixed(3));
    }

    // The dataset attribute is the whole diagnostic: no second element, no
    // second attribute, and no debug panel text.
    expect(anchorCarriers(anchor)).toEqual(['div[data-grab-anchor]']);
    expect(document.querySelectorAll('[data-grab-anchor]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-grabbed-corner]')).toHaveLength(0);
    expect(document.body.textContent ?? '').not.toContain(anchor);

    renderer.dispose();

    expect(document.querySelectorAll('[data-grab-anchor]')).toHaveLength(0);
  });

  it.each([
    ['an empty tile list', [] as const, 0],
    ['a collapsed activated tile', [{ left: 0, top: 0, width: 0, height: 0 }] as const, 0],
    ['an out-of-range tile index', [{ left: 0, top: 0, width: 240, height: 160 }] as const, 4],
  ] as const)('publishes bottom-right when resolution collapsed from %s', (_case, rects, index) => {
    const collapsed = resolveGrabAnchor(rects, index);

    expect(collapsed).toBe(SINGLE_TILE_ANCHOR);

    const renderer = new PaperTurnRenderer({ ...createInput(), grabAnchor: collapsed });
    const overlay = requireOverlay();

    expect(overlay.dataset.grabAnchor).toBe('bottom-right');
    expect(backFaceUvsSpy).toHaveBeenCalledWith(
      'bottom-right',
      defaultMotionProfile.meshColumns,
      defaultMotionProfile.meshRows,
    );

    renderer.render(0.5);

    expect(buildPaperFrameSpy.mock.calls[0]?.[2]).toBe('bottom-right');

    renderer.dispose();
  });

  it.each([
    ['profile\\.meshColumns', { meshColumns: 21 }],
    ['profile\\.meshRows', { meshRows: 15 }],
    ['profile\\.meshColumns and profile\\.meshRows', { meshColumns: 21, meshRows: 15 }],
  ] as const)('rejects an odd mesh naming %s before allocating anything', (named, overrides) => {
    const input: RendererInput = {
      ...createInput(),
      profile: { ...defaultMotionProfile, ...overrides },
    };

    expect(() => new PaperTurnRenderer(input)).toThrow(new RegExp(`Invalid ${named}: expected an even integer`));

    // Validation runs first, so no overlay, canvas, mesh, or texture is ever
    // allocated and there is nothing for the fallback path to clean up.
    expect(document.body.children).toHaveLength(0);
    expect(document.querySelector('[data-grab-anchor]')).toBeNull();
    expect(threeMock.renderers).toHaveLength(0);
    expect(threeMock.geometries).toHaveLength(0);
    expect(threeMock.materials).toHaveLength(0);
    expect(threeMock.textures).toHaveLength(0);
    expect(backFaceUvsSpy).not.toHaveBeenCalled();
    expect(buildPaperFrameSpy).not.toHaveBeenCalled();
  });

  it('keeps the mobile mesh budget and the twice-viewport canvas cap', () => {
    const viewport = { width: 390, height: 844 };
    const input: RendererInput = {
      ...createInput(),
      grabAnchor: 'top-center',
      destinationRect: { left: 0, top: 0, ...viewport },
    };
    const vertexCount = (input.profile.meshColumns + 1) * (input.profile.meshRows + 1);

    expect(input.profile.meshColumns).toBe(20);
    expect(input.profile.meshRows).toBe(14);
    expect(vertexCount).toBe(315);

    const renderer = new PaperTurnRenderer(input);
    const overlay = requireOverlay();
    const geometry = threeMock.geometries[0];

    if (!geometry) {
      throw new Error('Expected mesh geometry to be created');
    }

    expect(threeMock.geometries).toHaveLength(1);
    expect(overlay.dataset.meshVertices).toBe('315');
    expect(geometry.attributes.position!.array).toHaveLength(315 * 3);
    expect(geometry.attributes.shade!.array).toHaveLength(315);
    expect(geometry.attributes.uv!.array).toHaveLength(315 * 2);
    expect(geometry.attributes.backUv!.array).toHaveLength(315 * 2);

    // The canvas is the destination rect scaled by the capped pixel ratio, so
    // the backing store stays within twice the viewport in each dimension.
    const pixelRatio = threeMock.renderers[0]?.setPixelRatio.mock.calls[0]?.[0] as number;

    expect(pixelRatio).toBe(input.profile.maxTextureDpr);
    expect(pixelRatio).toBeLessThanOrEqual(2);
    expect(threeMock.renderers[0]?.setSize).toHaveBeenCalledWith(
      viewport.width,
      viewport.height,
      false,
    );
    expect(viewport.width * pixelRatio).toBeLessThanOrEqual(2 * viewport.width);
    expect(viewport.height * pixelRatio).toBeLessThanOrEqual(2 * viewport.height);

    renderer.render(0.5);

    expect(backFaceUvsSpy).toHaveBeenCalledTimes(1);

    renderer.dispose();
  });
});
