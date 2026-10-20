"""Original Sunny Sprint fox kart. Run with Blender 5.2 --background --python.
Blender forward -Y; glTF forward +Z. Dimensions about 2 x 3.4 x 2.5 m.
All materials, meshes and design are original procedural work.
"""
import bpy
import math
import os
import json
import sys
from mathutils import Vector

CHARACTER = sys.argv[sys.argv.index('--character')+1] if '--character' in sys.argv else 'fox'
assert CHARACTER in ('fox', 'rabbit', 'panda')
STEM = 'kart' if CHARACTER == 'fox' else 'kart-' + CHARACTER

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'models')
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in [bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.cameras, bpy.data.lights]:
    for block in list(datablocks):
        if block.users == 0:
            datablocks.remove(block)

def mat(name, color, rough=.55, metallic=0.0):
    m=bpy.data.materials.new(name)
    m.diffuse_color=(*color,1)
    m.use_nodes=True
    p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough
    p.inputs['Metallic'].default_value=metallic
    return m

paint=mat('KartPaint',(.025,.52,.57),.28,.12)
cream=mat('WarmIvory',(.98,.84,.56),.48)
orange=mat('FoxOrange',(1,.28,.055),.65)
white=mat('FoxCream',(1,.90,.71),.65)
dark=mat('TireCharcoal',(.025,.042,.052),.84)
seat=mat('SeatDarkTeal',(.015,.14,.18),.7)
steel=mat('BrushedAluminium',(.42,.53,.55),.35,.65)
hub=mat('HubGold',(1,.57,.075),.3,.38)
glass=mat('GogglesOcean',(.025,.16,.24),.18,.4)
pink=mat('InnerEarPeach',(1,.45,.3),.7)
black=mat('FoxNoseEyes',(.012,.022,.025),.24)
highlight=mat('EyeGlints',(1,1,.95),.2)
assets=[]
wheel_groups=[]

def finish(obj,name,material,smooth=True):
    obj.name=name
    obj.data.materials.append(material)
    if smooth and hasattr(obj.data,'polygons'):
        for p in obj.data.polygons:p.use_smooth=True
    assets.append(obj)
    return obj

def sphere(name,loc,scale,material,segments=20,rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=loc)
    o=bpy.context.object;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,material)

def box(name,loc,scale,material,bevel=.12):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        b=o.modifiers.new('Soft rounded corners','BEVEL');b.width=bevel;b.segments=3
        bpy.context.view_layer.objects.active=o
        bpy.ops.object.modifier_apply(modifier=b.name)
        n=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=n.name)
    return finish(o,name,material)

def cyl(name,loc,radius,depth,material,axis='Z',vertices=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
    o=bpy.context.object
    if axis=='X':o.rotation_euler[1]=math.pi/2
    if axis=='Y':o.rotation_euler[0]=math.pi/2
    b=o.modifiers.new('Rounded edge','BEVEL');b.width=min(.045,depth*.22);b.segments=2
    bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
    return finish(o,name,material)

def bar(name,a,b,radius,material):
    va,vb=Vector(a),Vector(b)
    o=cyl(name,(va+vb)/2,radius,(vb-va).length,material)
    o.rotation_euler=(vb-va).to_track_quat('Z','Y').to_euler()
    return o

def torus(name,loc,major,minor,material,rotation=(0,0,0),major_segments=24,minor_segments=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=major_segments,minor_segments=minor_segments,location=loc,rotation=rotation)
    return finish(bpy.context.object,name,material)

def ear(name,x,y,z,material,front=-.12,size=1):
    # Rounded triangular fox ears, bevelled as a solid rather than a cone.
    vertices=[(-.2,front,0),(.2,front,0),(.05,front,.57),(-.2,.17,0),(.2,.17,0),(.05,.17,.57)]
    vertices=[(x+vx*size,y+vy*size,z+vz*size) for vx,vy,vz in vertices]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    b=o.modifiers.new('Soft ear edges','BEVEL');b.width=.055*size;b.segments=3
    bpy.ops.object.modifier_apply(modifier=b.name)
    return finish(o,name,material)

# A sculpted, low toy chassis with broad fenders and a cream racing stripe.
box('Chassis',(0,0,.49),(1.45,2.56,.32),paint,.19)
box('Nose',(0,-.92,.64),(1.2,1.02,.38),paint,.2)
box('CreamNoseStripe',(0,-1.03,.85),(.27,.84,.045),cream,.02)
box('FrontBumper',(0,-1.56,.39),(1.61,.19,.2),cream,.08)
box('RearBumper',(0,1.44,.43),(1.5,.18,.18),cream,.07)
box('RearDeck',(0,1.06,.71),(1.14,.63,.22),paint,.11)
box('Footwell',(0,-.1,.73),(.92,1.0,.15),seat,.1)
for sx in [-1,1]:
    box('SidePod'+str(sx),(sx*.67,.11,.68),(.3,1.22,.27),paint,.13)
    box('SideIvoryFlash'+str(sx),(sx*.826,.13,.72),(.025,.53,.08),cream,.015)
    for yy in [-.04,.1,.24]:
        box('SideVent'+str(sx)+str(yy),(sx*.84,yy,.6),(.025,.06,.08),seat,.013)
    sphere('Headlight'+str(sx),(sx*.43,-1.433,.68),(.16,.045,.09),white,16,8)
    cyl('BumperBolt'+str(sx),(sx*.56,-1.665,.41),.04,.02,steel,'Y',12)
    cyl('Exhaust'+str(sx),(sx*.55,1.46,.74),.09,.27,steel,'Y',16)
    cyl('ExhaustDark'+str(sx),(sx*.55,1.607,.74),.061,.005,dark,'Y',16)

# Four tyres: torus rubber shoulders, inset cream hubs, gold caps and six spoke details.
for sx in [-1,1]:
    for yy,label in [(-.94,'Front'),(.93,'Rear')]:
        cx=sx*.86
        first=len(assets)
        o=torus('Tire'+label+('L' if sx<0 else 'R'),(cx,yy,.375),.256,.119,dark,(0,math.pi/2,0),28,10)
        o['part']='wheel';o['axle']='X'
        cyl('TireCore'+label+str(sx),(cx,yy,.375),.26,.22,dark,'X',24)
        outer=cx+sx*.125
        cyl('Rim'+label+str(sx),(outer,yy,.375),.222,.026,cream,'X',24)
        cyl('HubInset'+label+str(sx),(outer+sx*.019,yy,.375),.165,.025,paint,'X',20)
        for i in range(6):
            angle=i*math.tau/6
            a=(outer+sx*.038,yy+math.cos(angle)*.07,.375+math.sin(angle)*.07)
            b=(outer+sx*.038,yy+math.cos(angle)*.17,.375+math.sin(angle)*.17)
            bar('RimSpoke'+label+str(sx)+str(i),a,b,.018,cream)
        cyl('GoldHub'+label+str(sx),(outer+sx*.058,yy,.375),.072,.035,hub,'X',16)
        wheel_groups.append(('Wheel'+label+('L' if sx<0 else 'R'),(cx,yy,.375),list(assets[first:])))

# Bucket seat, fox flight suit and fox paws.
box('SeatBase',(0,.35,.88),(.7,.65,.2),seat,.11)
seatback=box('SeatBack',(0,.71,1.13),(.7,.19,.65),seat,.13)
seatback.rotation_euler[0]=-.12
sphere('FoxBody',(0,.3,1.18),(.34,.28,.45),orange)
sphere('FoxBib',(0,.04,1.23),(.24,.07,.29),white,16,10)
box('Harness',(0,-.025,1.12),(.075,.04,.39),paint,.018)
cyl('HarnessButton',(0,-.052,1.22),.055,.03,hub,'Y',12)
for sx in [-1,1]:
    sphere('FoxFoot'+str(sx),(sx*.22,-.41,.87),(.15,.26,.12),orange,16,8)
    bar('FoxArm'+str(sx),(sx*.29,.13,1.34),(sx*.35,-.4,1.14),.105,orange)
    sphere('FoxPaw'+str(sx),(sx*.31,-.47,1.16),(.13,.12,.115),white,16,8)

# Steering wheel (black ring with gold hub) is tilted toward the driver's paws.
bar('SteeringColumn',(0,-.72,.74),(0,-.5,1.16),.04,steel)
torus('SteeringWheel',(0,-.48,1.16),.29,.035,seat,(math.radians(62),0,0),24,8)
bar('SteeringSpokeA',(-.26,-.48,1.16),(.26,-.48,1.16),.023,steel)
bar('SteeringSpokeB',(0,-.48,1.16),(0,-.36,.93),.023,steel)
sphere('SteeringCentre',(0,-.485,1.16),(.075,.04,.075),hub,16,8)

# An original large-headed fox pilot with cream cheeks, dark eyes and raised goggles.
sphere('FoxHead',(0,.17,1.91),(.49,.4,.43),orange,24,16)
ear('FoxEarL',-.31,.18,2.16,orange)
ear('FoxEarR',.31,.18,2.16,orange)
ear('EarInnerL',-.31,.015,2.21,pink,front=-.015,size=.66)
ear('EarInnerR',.31,.015,2.21,pink,front=-.015,size=.66)
for sx in [-1,1]:
    cheek=sphere('FoxCheek'+str(sx),(sx*.205,-.165,1.78),(.28,.18,.195),white,20,12)
    cheek.rotation_euler[1]=sx*.18
    sphere('FoxEye'+str(sx),(sx*.195,-.206,1.99),(.065,.025,.084),black,16,10)
    sphere('FoxEyeGlint'+str(sx),(sx*.183,-.23,2.022),(.021,.012,.026),highlight,12,8)
    brow=bar('FoxBrow'+str(sx),(sx*.13,-.207,2.106),(sx*.25,-.19,2.113),.018,orange)
sphere('FoxMuzzle',(0,-.315,1.8),(.16,.125,.1),white,20,12)
sphere('FoxNose',(0,-.428,1.84),(.073,.047,.052),black,16,10)
bar('FoxSmileL',(-.01,-.417,1.775),(-.08,-.382,1.75),.012,black)
bar('FoxSmileR',(.01,-.417,1.775),(.08,-.382,1.75),.012,black)
# Raised aviator goggles leave the warm expressive eyes visible.
band=torus('GogglesBand',(0,.17,2.13),.396,.034,seat,(0,0,0),28,8)
band.scale=(1.15,.87,1)
for sx in [-1,1]:
    frame=torus('GoggleFrame'+str(sx),(sx*.19,-.147,2.22),.142,.027,cream,(math.pi/2,0,0),24,8)
    frame.scale=(1.04,1,.76)
    lens=sphere('GoggleLens'+str(sx),(sx*.19,-.149,2.22),(.132,.033,.106),glass,20,10)
    sphere('GoggleGlint'+str(sx),(sx*.19-.035,-.18,2.25),(.035,.006,.016),white,12,8)
bar('GoggleBridge',(-.05,-.16,2.22),(.05,-.16,2.22),.028,cream)
# Curled fox tail on the back, safely contained above the rear deck.
tail=sphere('FoxTail',(0,1.02,1.18),(.24,.54,.23),orange,20,12)
tail.rotation_euler[0]=-.53
tip=sphere('FoxTailTip',(0,1.34,1.42),(.2,.27,.21),white,20,12)
tip.rotation_euler[0]=-.53

# Numeric 07 badge, authored as simple geometry for reliable glTF export.
cyl('NoseBadge',(0,-1.405,.86),.145,.016,cream,'Y',24)
for dx in [-.044,.044]:
    # A pair of inset teal dots evoke a playful badge without texture dependencies.
    cyl('BadgeDot'+str(dx),(dx,-1.42,.86),.025,.009,paint,'Y',12)

# Alternate pilots use different face/ear/tail meshes, not recolors. Remember
# the fox bounds so every chassis and wheel has identical scale in all variants.
baseline_points=[o.matrix_world@Vector(v) for o in assets for v in o.bound_box]
baseline_min=Vector([min(p[i] for p in baseline_points) for i in range(3)])
baseline_max=Vector([max(p[i] for p in baseline_points) for i in range(3)])
if CHARACTER != 'fox':
    remove_prefixes=('FoxHead','FoxEar','EarInner','FoxCheek','FoxEye','FoxBrow','FoxMuzzle','FoxNose','FoxSmile','FoxTail')
    for o in list(assets):
        if o.name.startswith(remove_prefixes):
            assets.remove(o);bpy.data.objects.remove(o,do_unlink=True)
    fur=mat('RabbitMintFur',(.74,.94,.85),.7) if CHARACTER=='rabbit' else mat('PandaIvoryFur',(.96,.95,.89),.74)
    for o in assets:
        if o.name.startswith(('FoxBody','FoxFoot','FoxArm','FoxPaw','FoxBib')):
            o.data.materials.clear()
            o.data.materials.append(black if CHARACTER=='panda' and o.name.startswith(('FoxArm','FoxPaw','FoxFoot')) else fur)
            o.name=o.name.replace('Fox',CHARACTER.title())
    if CHARACTER=='rabbit':
        sphere('RabbitHead',(0,.17,1.88),(.45,.36,.37),fur,24,16)
        for sx in [-1,1]:
            e=sphere('RabbitLongEar'+str(sx),(sx*.235,.21,2.28),(.125,.115,.45),fur,20,12)
            e.rotation_euler[1]=sx*.12
            inner=sphere('RabbitEarPink'+str(sx),(sx*.235,.103,2.29),(.067,.019,.335),pink,16,10)
            inner.rotation_euler[1]=sx*.12
            sphere('RabbitCheek'+str(sx),(sx*.145,-.15,1.79),(.19,.13,.145),white,16,10)
            sphere('RabbitEye'+str(sx),(sx*.18,-.169,1.99),(.062,.029,.083),black,16,10)
            sphere('RabbitEyeGlint'+str(sx),(sx*.18-.016,-.194,2.019),(.02,.012,.025),highlight,12,8)
        sphere('RabbitPinkNose',(0,-.291,1.84),(.062,.042,.044),pink,16,10)
        bar('RabbitSmileL',(0,-.28,1.79),(-.07,-.255,1.765),.012,black)
        bar('RabbitSmileR',(0,-.28,1.79),(.07,-.255,1.765),.012,black)
        for sx in [-1,1]:box('RabbitTooth'+str(sx),(sx*.026,-.265,1.72),(.045,.034,.076),highlight,.009)
        sphere('RabbitCottonTail',(0,.88,1.18),(.22,.22,.22),white,20,12)
    else:
        sphere('PandaHead',(0,.17,1.94),(.49,.4,.44),fur,24,16)
        for sx in [-1,1]:
            sphere('PandaRoundEar'+str(sx),(sx*.365,.18,2.28),(.205,.14,.205),black,20,12)
            sphere('PandaEarInset'+str(sx),(sx*.365,.045,2.28),(.102,.02,.11),seat,16,10)
            patch=sphere('PandaEyePatch'+str(sx),(sx*.205,-.202,2.0),(.134,.058,.168),black,20,12)
            patch.rotation_euler[1]=sx*-.28
            sphere('PandaEye'+str(sx),(sx*.195,-.26,2.014),(.061,.023,.073),glass,16,10)
            sphere('PandaEyeGlint'+str(sx),(sx*.195-.016,-.281,2.039),(.023,.009,.027),highlight,12,8)
        sphere('PandaMuzzle',(0,-.222,1.8),(.195,.125,.12),white,20,12)
        sphere('PandaNose',(0,-.344,1.84),(.077,.044,.048),black,16,10)
        bar('PandaSmileL',(0,-.337,1.794),(-.065,-.31,1.771),.012,black)
        bar('PandaSmileR',(0,-.337,1.794),(.065,-.31,1.771),.012,black)
        sphere('PandaRoundTail',(0,.87,1.14),(.15,.15,.15),black,16,10)

# Apply all scales and then set original overall proportions to the requested dimensions.
for o in assets:
    o.select_set(False)
for o in assets:
    o.select_set(True)
    # Preserve silhouettes while staying below the 25k triangle game budget.
    if len(o.data.polygons)>100:
        bpy.context.view_layer.objects.active=o
        dec=o.modifiers.new('Game mesh optimization','DECIMATE');dec.ratio=.74
        bpy.ops.object.modifier_apply(modifier=dec.name)
bpy.context.view_layer.objects.active=assets[0]
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
all_points=[o.matrix_world@Vector(v) for o in assets for v in o.bound_box]
minv=Vector([min(p[i] for p in all_points) for i in range(3)])
maxv=Vector([max(p[i] for p in all_points) for i in range(3)])
if CHARACTER != 'fox':
    minv=baseline_min;maxv=baseline_max
scale=Vector((2/(maxv.x-minv.x),3.4/(maxv.y-minv.y),2.6/(maxv.z-minv.z)))
for o in assets:
    origin=Vector((o.location.x*scale.x,o.location.y*scale.y,(o.location.z-minv.z)*scale.z))
    for v in o.data.vertices:
        # Per-axis asset normalization, including object orientation.
        world=o.matrix_world@v.co
        world-=Vector((0,0,minv.z))
        v.co=Vector((world.x*scale.x,world.y*scale.y,world.z*scale.z))-origin
    o.matrix_world.identity()
    o.location=origin

for name,location,parts in wheel_groups:
    pivot=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(pivot)
    pivot.location=(location[0]*scale.x,location[1]*scale.y,(location[2]-minv.z)*scale.z)
    pivot['part']='wheel';pivot['spin_axis']='local X'
    bpy.context.view_layer.update()
    for part in parts:
        world=part.matrix_world.copy();part.parent=pivot;part.matrix_world=world
    pivot.select_set(True)

# Keep descriptive objects independent for easy repainting and source editing.
for o in assets:o.select_set(True)
bpy.context.view_layer.objects.active=assets[0]
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,STEM+'.glb'),export_format='GLB',use_selection=True,export_apply=True)
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in assets)
print('ASSET_REPORT '+json.dumps({'character':CHARACTER,'objects':len(assets),'triangles':triangles,'dimensions':[2,3.4,2.6],'forward_blender':'-Y','forward_gltf':'+Z','path':os.path.join(OUT,STEM+'.glb')}))

# Lighting and display scene are kept out of the exported game mesh.
floor=mat('PreviewFloor',(.73,.88,.83),.9)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.014))
ground=bpy.context.object;ground.name='PreviewGround';ground.data.materials.append(floor)
world=bpy.data.worlds.new('SunnyStudio') if not bpy.data.worlds else bpy.data.worlds[0]
bpy.context.scene.world=world;world.use_nodes=True
next(n for n in world.node_tree.nodes if n.type=='BACKGROUND').inputs['Color'].default_value=(.66,.82,1,1)
next(n for n in world.node_tree.nodes if n.type=='BACKGROUND').inputs['Strength'].default_value=.45
for name,loc,power,size in [('Key',(-4,-5,7),1000,5),('Fill',(5,-1,4),700,4),('Rim',(2,4,6),1000,3)]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size
    o.rotation_euler=(Vector((0,0,1.1))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(5,-7,4.1))
camera=bpy.context.object;camera.name='KartPortrait';camera.rotation_euler=(Vector((0,0,1.15))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=5.5
scene=bpy.context.scene;scene.camera=camera
try:scene.render.engine='CYCLES'
except TypeError:pass
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=os.path.join(ROOT,'assets','source',STEM+'-preview.png')
try:scene.view_settings.view_transform='AgX'
except TypeError:pass
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets','source',STEM+'.blend'))
bpy.ops.render.render(write_still=True)
print('DONE original fox kart asset and preview')
