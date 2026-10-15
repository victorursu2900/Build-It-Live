/** Static tutorial content; always authored locally, never user-submitted. */
export const steps = [
  {
    eyebrow: '01 / THE GRID',
    title: 'THIS IS WHERE YOUR <i>BLOCKS CAN GO</i>',
    text: 'Think of the grid like a game board made from squares. One square can hold one block. In Digital Builder, you control these positions directly with your mouse.',
    points: [
      '<strong>Pick the build footprint.</strong> Start with the default 8×16 digital grid, or adjust the active area using Grid Settings.',
      '<strong>Build upward.</strong> You can stack blocks on top of other blocks, up to 16 layers high.',
      '<strong>Same place, same block.</strong> Each digital cell corresponds to one position in your editable model.'
    ],
    tip: 'Imagine the grid is graph paper. Left and right are the floor. Stacking blocks makes the build taller.',
    visual: 'grid'
  },
  {
    eyebrow: '02 / YOUR TOOLS',
    title: 'CHOOSE WHAT YOUR <i>CLICK WILL DO</i>',
    text: 'Before you click the model, choose a tool. Each tool gives your click a different job.',
    points: [
      '<strong>Standard block</strong> adds a virtual block to your model.',
      '<strong>Support block</strong> is a temporary helper for shapes that need something underneath.',
      '<strong>Eraser</strong> removes a block when you change your mind.'
    ],
    tip: 'The preview block shows where your next block will land. Look at the preview first, then click.',
    visual: 'blocks'
  },
  {
    eyebrow: '03 / BUILD',
    title: 'CLICK, STACK, AND <i>LOOK AROUND</i>',
    text: 'Build the shape one block at a time. You can also move the camera so you can see the front, back, top, and sides.',
    points: [
      '<strong>Click</strong> the preview to place a block.',
      '<strong>Free Move</strong> lets you look around without placing anything. Press M to switch it on.',
      '<strong>Continuous Build</strong> lets you hold the mouse and place several blocks faster.'
    ],
    tip: 'If a block cannot be placed, check the Feedback card. It tells you what went wrong and what to try next.',
    visual: 'build'
  },
  {
    eyebrow: '04 / LIVE DATA',
    title: 'THESE NUMBERS TELL YOU <i>WHAT YOU BUILT</i>',
    text: 'The Live Data card is a little scoreboard. It changes while you build, so you can check your model at a glance.',
    points: [
      '<strong>Grid</strong> tells you how big the building board is.',
      '<strong>Height</strong> tells you how many block layers your tallest part reaches.',
      '<strong>Blocks</strong> tells you how many blocks are in the model right now.'
    ],
    tip: 'These values describe the digital model you are editing; no physical board is required.',
    visual: 'data'
  },
  {
    eyebrow: '05 / LOOK INSIDE',
    title: 'PEEK INSIDE YOUR <i>BIG BUILD</i>',
    text: 'A tall model can hide blocks underneath. Layer View lets you temporarily hide the top so you can see what is happening lower down.',
    points: [
      '<strong>Blocks view</strong> shows the workspace blocks as simple rectangular shapes, without the brick\'s internal screw geometry.',
      '<strong>Smooth view</strong> rounds the shape while protecting openings and support spaces. Smooth automatically uses export detail. Compare Original Outline overlays your original block boundaries.',
      '<strong>Layer View</strong> shows the layer you choose and every layer below it.'
    ],
    tip: 'Choose a layer, then use EDIT LAYER inside the canvas at the top right to change only that layer. Blocks above stay in place. Replace any empty cell supporting hidden blocks; the canvas warning keeps you in the layer until it is filled. Choose ALL to show the complete model.',
    visual: 'inspect'
  },
  {
    eyebrow: '06 / SAVE',
    title: 'KEEP YOUR BUILD FOR <i>LATER</i>',
    text: 'Save your project when you want to come back and keep building another time. A saved project remembers the blocks, not just a picture of them.',
    points: [
      '<strong>Save Project</strong> makes a .BIL file that you can open again.',
      '<strong>Autosave</strong> keeps recent work in this browser for you.',
      '<strong>Recent Models</strong> lets you reopen, rename, or copy builds you made before.'
    ],
    tip: 'A .BIL file is like a saved game: open it later and continue from where you stopped.',
    visual: 'save'
  },
  {
    eyebrow: '07 / EXPORT',
    title: 'TURN YOUR BUILD INTO A <i>3D FILE</i>',
    text: 'Exporting makes a file that other 3D programs can understand. This is the step you use when you want to move your model outside Build It Live.',
    points: [
      '<strong>STL</strong> is the simple choice for sending a shape to 3D-printing software.',
      '<strong>GLB</strong> is a compact 3D file that can also carry visual information.',
      '<strong>OBJ</strong> is another common shape file used by many 3D programs.'
    ],
    tip: 'If you need a printable brick part instead of a complete multi-block model, use Brick Maker in chapter 02.',
    visual: 'export'
  }
];


export function visualMarkup(type: string): string {
  if (type === 'grid') return `<div class="step-visual step-visual--grid"><div class="grid-demo">${Array.from({length:36},(_,i)=>`<i class="${[14,15,20,21].includes(i)?'is-active':''}"></i>`).join('')}</div><div class="visual-tag">ONE SQUARE = ONE BLOCK PLACE</div></div>`;
  if (type === 'blocks') return `<div class="step-visual step-visual--blocks"><div class="demo-cube demo-cube--red"><b>01</b><span>ADD BLOCK</span></div><div class="demo-cube demo-cube--paper"><b>02</b><span>ADD SUPPORT</span></div><div class="demo-cube demo-cube--erase"><b>03</b><span>ERASE</span></div></div>`;
  if (type === 'build') return `<div class="step-visual step-visual--build"><div class="build-base"><i></i><i></i><i></i><i></i><i></i></div><div class="cursor-demo">↖<span>PREVIEW FIRST<br>THEN CLICK</span></div></div>`;
  if (type === 'data') return `<div class="step-visual step-visual--data"><div><small>BOARD SIZE</small><strong>8×16</strong></div><div><small>TALLEST POINT</small><strong>07 / 16</strong></div><div><small>BLOCKS USED</small><strong>042</strong></div></div>`;
  if (type === 'inspect') return `<div class="step-visual step-visual--inspect"><div class="inspect-stack">${Array.from({length:12},(_,i)=>`<i style="--z:${Math.floor(i/4)}"></i>`).join('')}</div><div class="layer-marker"><span>SHOWING</span><b>LAYERS 01–03</b></div></div>`;
  if (type === 'save') return `<div class="step-visual step-visual--save"><div class="file-card file-card--main"><small>EDITABLE PROJECT</small><b>.BIL</b><span>OPEN IT AND KEEP BUILDING</span></div><div class="save-arrow">→</div><div class="file-stack"><i>PROJECT FILE</i><i>AUTOSAVE</i><i>RECENT BUILDS</i></div></div>`;
  return `<div class="step-visual step-visual--export"><div class="export-source"><i></i><i></i><i></i><i></i><i></i></div><div class="export-arrow">→</div><div class="format-chips"><b>.STL</b><span>3D PRINTING</span><b>.GLB</b><span>3D VIEWING</span><b>.OBJ</b><span>3D SOFTWARE</span></div></div>`;
}

