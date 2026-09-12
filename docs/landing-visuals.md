# Landing sculpture and space radio

The landing title is HTML over a decorative, rotating sculpture. The interactive stock/options example remains a separate section below it. The art stage stays midnight in both appearances; surrounding navigation and content follow the selected theme.

The sculpture was authored in Blender from the approved generated reference image. Hidden surfaces are an artistic reconstruction. The exported GLB has four meshes and 16,512 triangles, with embedded material texture data. The browser scene adapts the approved lighting with three material-specific environments, a soft floor reflection, and a fixed camera. Only the model's local annular axis rotates, completing a turn in 72 seconds. Blender area lights and light linking do not transfer automatically into glTF.

- Model: `public/landing/investor-orbit.glb`, SHA256 `1a68e01fd43f07ee22509ef88edf5cc67353c743288e15422463b386999edb53`.
- Original image fallback: `public/landing/investor-orbit-v1.png`, SHA256 `d256a5284557aa0e401e7d1e47d3ddab828aa75f9f9c78e576a396c8b4be9bcd`.
- Lighting/camera inputs: `src/lib/orbit-lighting.json`. These are authored scene parameters, not captured financial data.
- Renderer: `src/lib/landing-orbit-scene.ts`, adapted from the independently reviewed selective-lighting R4 proof, pinned to Three 0.186.0.
- Lifecycle: `src/lib/landing-orbit.ts` and `src/components/landing/OrbitArtwork.tsx`.

The renderer loads only when the art is visible and reduced motion is off. Pause, offscreen and hidden-document states stop frame scheduling. Reduced motion removes the canvas; model, shader or WebGL failures retain the original artwork. Navigation disposes the model, textures and graphics context. A returned back-forward-cache page mounts a new viewer. The title, workspace link and example remain available with JavaScript disabled.

Rendering is capped at 30 frames per second. Earlier isolated testing measured about 26 fps on an Apple M3 at a 1440×896 canvas; that is an environment-specific observation, not a promised rate on physical phones or all browsers. Viewport emulation does not establish mobile GPU performance.

Space radio remains independently controlled and starts only through a user action. Its sound is generated locally; no recordings, music service or brokerage connection are required.
