// Lighting and geometry adapted from the independently accepted R4 browser proof.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Reflector } from "three/addons/objects/Reflector.js";

import contract from "./orbit-lighting.json";

// Present in the pinned Three source; omitted by its matching type package.
const reflectorShader = (
  Reflector as typeof Reflector & {
    ReflectorShader: {
      uniforms: Record<string, THREE.IUniform>;
      vertexShader: string;
    };
  }
).ReflectorShader;

const fromBlender = ([x, y, z]: readonly number[]) =>
  new THREE.Vector3(x, z, -y);
const disposeObject = (object: THREE.Object3D) => {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  object.traverse((object) => {
    const child = object as THREE.Mesh;
    if (child.geometry) geometries.add(child.geometry);
    for (const material of child.material
      ? Array.isArray(child.material)
        ? child.material
        : [child.material]
      : []) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const texture of textures) {
    texture.dispose();
    (texture.source?.data as { close?: () => void } | undefined)?.close?.();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
};

export async function createScene(
  host: HTMLElement,
  {
    modelData: raw,
    signal,
    onContextLoss,
  }: {
    modelData: ArrayBuffer;
    signal: AbortSignal;
    onContextLoss: () => void;
  },
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.transmissionResolutionScale = 0.5;
  renderer.debug.onShaderError = () => {
    throw new Error("Shader compilation failed");
  };
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#050909");
  const camera = new THREE.OrthographicCamera(
    -3.05,
    3.05,
    1.72,
    -1.72,
    0.1,
    60,
  );
  camera.position.copy(fromBlender(contract.camera.location));
  camera.lookAt(-0.98, 1.26, 0);
  const center = new THREE.Vector3(0.49, 1.35, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environments: THREE.WebGLRenderTarget[] = [];
  let pmremReleased = false;
  const yieldToMain = async () => {
    // Let pending input/paint run between GPU setup phases.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  };
  const makeEnvironment = (receiver: string) => {
    const lighting = new THREE.Scene();
    const ambient =
      receiver === "Inner_Fold_Light_Receivers"
        ? [0.045, 0.058, 0.05]
        : receiver === "Titanium_Edge_Light_Receivers"
          ? [0.055, 0.065, 0.06]
          : [0.012, 0.015, 0.0135];
    lighting.background = new THREE.Color().setRGB(
      ambient[0],
      ambient[1],
      ambient[2],
    );
    try {
      for (const light of contract.lights.filter(
        (light) =>
          light.receiver_collection === "Sculpture_Light_Receivers" ||
          light.receiver_collection === receiver,
      )) {
        const tapered = light.name === "Inner_Fold_Readability_Card";
        const shape = new THREE.Shape([
          new THREE.Vector2(-2.0, -0.1),
          new THREE.Vector2(2.0, -0.035),
          new THREE.Vector2(2.0, 0.065),
          new THREE.Vector2(-2.0, 0.6),
        ]);
        const card = new THREE.Mesh(
          tapered
            ? new THREE.ShapeGeometry(shape)
            : new THREE.PlaneGeometry(light.size, light.size_y),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color()
              .setRGB(light.color[0], light.color[1], light.color[2])
              .multiplyScalar(light.energy / 40),
            side: THREE.DoubleSide,
          }),
        );
        card.position.copy(fromBlender(light.location)).sub(center);
        card.lookAt(0, 0, 0);
        lighting.add(card);
      }
      const environment = pmrem.fromScene(
        lighting,
        receiver === "Inner_Fold_Light_Receivers" ? 0.012 : 0.06,
        0.1,
        50,
        {
          size: 256,
        },
      );
      environments.push(environment);
      return environment.texture;
    } finally {
      disposeObject(lighting);
      lighting.clear();
    }
  };
  let model: THREE.Group | undefined, floor: Reflector | undefined;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  const loss = (event: Event) => {
    event.preventDefault();
    onContextLoss();
  };
  canvas.addEventListener("webglcontextlost", loss);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener("webglcontextlost", loss);
    disposeObject(scene);
    floor?.dispose();
    for (const environment of environments) environment.dispose();
    if (!pmremReleased) pmrem.dispose();
    renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
    canvas.remove();
  };
  try {
    await yieldToMain();
    scene.environment = makeEnvironment("Sculpture_Light_Receivers");
    await yieldToMain();
    const innerEnvironment = makeEnvironment("Inner_Fold_Light_Receivers");
    await yieldToMain();
    const titaniumEnvironment = makeEnvironment(
      "Titanium_Edge_Light_Receivers",
    );
    pmrem.dispose();
    pmremReleased = true;
    await yieldToMain();
    const gltf = await new GLTFLoader().parseAsync(
      raw,
      new URL(".", location.href).href,
    );
    model = gltf.scene;
    if (signal.aborted) {
      disposeObject(model);
      throw new DOMException("Aborted", "AbortError");
    }
    scene.add(model);
    const spin = model.getObjectByName("Orbit_Actual_Rotation_Local_Normal");
    const rig = model.getObjectByName("Orbit_Fixed_Sculptural_Tilt");
    if (!spin || !rig) throw new Error("Expected sculpture hierarchy missing");
    let triangles = 0,
      meshes = 0;
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.MeshPhysicalMaterial;
        if (material.name === "Inset_Smoked_Glass") {
          material.envMap = innerEnvironment;
          material.envMapIntensity = 1.2;
          material.roughness = 0.145;
          material.clearcoatRoughness = 0.085;
        }
        if (material.name === "Titanium_Brushed")
          material.envMap = titaniumEnvironment;
        if (material.name === "Inner_Lip_Sage")
          material.emissiveIntensity = 3.2;
        meshes++;
        triangles +=
          (child.geometry.index?.count ??
            child.geometry.attributes.position.count) / 3;
      }
    });
    const shader = THREE.UniformsUtils.clone(reflectorShader.uniforms);
    shader.reflectionTexel = { value: new THREE.Vector2(1 / 512, 1 / 512) };
    const fragment = `
    uniform sampler2D tDiffuse;
    uniform vec2 reflectionTexel;
    varying vec4 vUv;
    varying vec3 floorPosition;
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      // A contiguous 5x5 binomial blur in nine bilinear texture samples.
      // All offsets are measured in source texels, avoiding displaced copies.
      vec2 step = reflectionTexel * 1.2;
      vec3 reflection = texture2D(tDiffuse, uv).rgb * .140625;
      reflection += texture2D(tDiffuse, uv + vec2(step.x, 0.)).rgb * .1171875;
      reflection += texture2D(tDiffuse, uv - vec2(step.x, 0.)).rgb * .1171875;
      reflection += texture2D(tDiffuse, uv + vec2(0., step.y)).rgb * .1171875;
      reflection += texture2D(tDiffuse, uv - vec2(0., step.y)).rgb * .1171875;
      reflection += texture2D(tDiffuse, uv + step).rgb * .09765625;
      reflection += texture2D(tDiffuse, uv - step).rgb * .09765625;
      reflection += texture2D(tDiffuse, uv + vec2(step.x, -step.y)).rgb * .09765625;
      reflection += texture2D(tDiffuse, uv + vec2(-step.x, step.y)).rgb * .09765625;
      float grain = fract(sin(dot(floorPosition.xy, vec2(12.9898,78.233))) * 43758.5453);
      vec2 groundOffset = floorPosition.xy - vec2(.49, 0.);
      float pool = exp(-length(groundOffset * vec2(.65, .8)));
      float reflectionFade = 1. - smoothstep(1.0, 4.0, length(groundOffset));
      vec3 base = vec3(.0035,.005,.0046) + (grain-.5)*.0006 + pool*vec3(.020,.034,.026);
      gl_FragColor = vec4(base + reflection * .24 * reflectionFade, 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
    floor = new Reflector(new THREE.PlaneGeometry(40, 40), {
      textureWidth: 512,
      textureHeight: 512,
      multisample: Math.min(2, renderer.capabilities.maxSamples),
      shader: {
        name: "SoftStageReflection",
        uniforms: shader,
        vertexShader: reflectorShader.vertexShader
          .replace(
            "varying vec4 vUv;",
            "varying vec4 vUv; varying vec3 floorPosition;",
          )
          .replace(
            "vUv = textureMatrix",
            "floorPosition = position; vUv = textureMatrix",
          ),
        fragmentShader: fragment,
      },
    });
    // Transmission and main passes draw the floor with the same camera. Keep
    // one reflection per camera per scene frame; its pixels do not change
    // between those passes. A new frame or resize still refreshes it.
    const updateReflection = floor.onBeforeRender.bind(floor);
    const reflectedCameras = new Set<THREE.Camera>();
    floor.onBeforeRender = (...args) => {
      const reflectionCamera = args[2];
      if (reflectedCameras.has(reflectionCamera)) return;
      reflectedCameras.add(reflectionCamera);
      updateReflection(...args);
    };
    floor.rotation.x = -Math.PI / 2;
    floor.name = "Fixed_Floor_Reflection";
    scene.add(floor);
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 64);
    gradient.addColorStop(0, "rgba(0,0,0,0.8)");
    gradient.addColorStop(0.4, "rgba(0,0,0,0.4)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 1.6),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(shadowCanvas),
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.name = "Fixed_Soft_Contact_Shadow";
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0.49, 0.005, 0);
    scene.add(shadow);
    const baseRotation = spin.quaternion.clone();
    const rotationAxis = new THREE.Vector3(0, 1, 0);
    const rotationStep = new THREE.Quaternion();
    let dirty = true;
    let previousWidth = 0,
      previousHeight = 0,
      previousPixelRatio = 0;
    let angle = 0,
      frameCount = 0,
      mainCalls = 0,
      allCalls = 0;
    const rotate = (radians: number) => {
      if (angle === radians) return;
      angle = radians;
      dirty = true;
      spin.quaternion
        .copy(baseRotation)
        .multiply(rotationStep.setFromAxisAngle(rotationAxis, radians));
    };
    const resize = () => {
      const width = host.clientWidth,
        height = host.clientHeight;
      if (!width || !height) return;
      const mobile = width <= 760;
      const pixelRatio = mobile ? 1 : Math.min(devicePixelRatio, 1.5);
      if (
        width === previousWidth &&
        height === previousHeight &&
        pixelRatio === previousPixelRatio
      )
        return;
      previousWidth = width;
      previousHeight = height;
      previousPixelRatio = pixelRatio;
      dirty = true;
      const span = mobile ? 3.9 : 6.1;
      const vertical = (span * height) / width;
      camera.left = -span / 2;
      camera.right = span / 2;
      camera.top = vertical / 2;
      camera.bottom = -vertical / 2;
      camera.position.copy(fromBlender(contract.camera.location));
      camera.position.x = mobile ? 0.49 : -0.98;
      camera.lookAt(mobile ? 0.49 : -0.98, 1.26, 0);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      // Match the view aspect and retain enough samples for narrow metal edges.
      // Keep the longest side bounded even on high-DPI desktop displays.
      const scale = Math.min(1, 1024 / Math.max(width, height));
      const reflectionWidth = Math.max(1, Math.round(width * scale));
      const reflectionHeight = Math.max(1, Math.round(height * scale));
      floor!.getRenderTarget().setSize(reflectionWidth, reflectionHeight);
      (
        floor!.material as THREE.ShaderMaterial
      ).uniforms.reflectionTexel.value.set(
        1 / reflectionWidth,
        1 / reflectionHeight,
      );
    };
    const render = () => {
      if (disposed || !dirty) return;
      reflectedCameras.clear();
      renderer.info.reset();
      renderer.render(scene, camera);
      dirty = false;
      frameCount++;
      allCalls = renderer.info.render.calls;
      mainCalls = meshes + 2;
      if (renderer.getContext().isContextLost())
        throw new Error("Context lost");
    };
    resize();
    await renderer.compileAsync(scene, camera);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    render();
    host.append(canvas);
    return {
      render,
      resize,
      rotate,
      dispose,
      loseContext: () => renderer.forceContextLoss(),
      stats: () => ({
        three: THREE.REVISION,
        modelBytes: raw.byteLength,
        triangles,
        meshes,
        frameCount,
        estimatedMainMeshDraws: mainCalls,
        allPassCalls: allCalls,
        reflectionTarget: [
          floor!.getRenderTarget().width,
          floor!.getRenderTarget().height,
        ],
        transmissionResolutionScale: renderer.transmissionResolutionScale,
        angleDegrees: (angle * 180) / Math.PI,
        rigQuaternion: rig.quaternion.toArray(),
        spinQuaternion: spin.quaternion.toArray(),
        cameraPosition: camera.position.toArray(),
        floorPosition: floor!.position.toArray(),
        pixelRatio: renderer.getPixelRatio(),
        canvas: [canvas.width, canvas.height],
        geometryCount: renderer.info.memory.geometries,
        textureCount: renderer.info.memory.textures,
        environmentBuilds: environments.length,
      }),
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
