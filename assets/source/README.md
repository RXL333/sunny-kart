# Original fox kart

`kart.blend` is the editable Blender 5.2 source. `build_kart.py` rebuilds the entire asset from original procedural meshes and solid-color materials. No external models, textures, characters or paid generation services were used.

- Game export: `../../public/models/kart.glb`.
- Blender coordinates: Z up, -Y forward. glTF/Three.js coordinates: Y up, +Z forward.
- Origin: centered at ground level. Exported bounds: approximately 2.0 m wide, 2.6 m tall and 3.33 m long.
- 23,540 triangles, 120 glTF nodes, approximately 659 KB.
- Repaint the material named `KartPaint`; clone its material before recoloring individual opponents.
- Wheel animation groups: `WheelFrontL`, `WheelFrontR`, `WheelRearL`, `WheelRearR`. Rotate each group around its local X axis. Wheel meshes and hub details are grouped together.
- `FoxHead` is an independent mesh with its origin at the head center.
- Studio ground, lights and camera are only in the `.blend` preview, excluded from the game export.

`kart-preview.png` was rendered in Blender Cycles and visually inspected. `asset-report.json` records an independent parse of the GLB header, triangle count, hierarchy and world-space bounds.

Two additional pilots are authored as different meshes with the same chassis and wheel hierarchy: `kart-rabbit.glb` (23,208 triangles, long ears, pink nose, front teeth and cotton tail) and `kart-panda.glb` (23,268 triangles, round black ears, eye patches and black limbs). Their editable scenes and rendered previews use matching filenames in this folder. `variants-report.json` verifies the GLB format, triangle budgets, wheel groups and identical chassis/wheel positions.

Append `-- --character rabbit` or `-- --character panda` to the rebuild command to create the alternate exports without changing the fox files.

Rebuild in PowerShell:

```powershell
& 'D:\常用软件\Blender\blender.exe' --background --python '.\assets\source\build_kart.py'
```
