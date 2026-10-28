// Shared theme definitions; no playback or library state is touched.
(function(root){
 const themes=[
  {
    "id": "original-purple",
    "name": "Original Purple",
    "description": "Deep indigo \u00b7 vibrant pink",
    "bg": "#100c24",
    "surface": "#1b1435",
    "raised": "#292047",
    "hover": "#392b5b",
    "line": "#645681",
    "accent": "#ff70c9",
    "strong": "#ed3faa",
    "secondary": "#a78bfa",
    "muted": "#c1b7d4",
    "hue": 268,
    "accentHue": 330
  },
  {
    "id": "sunset-orange",
    "name": "Sunset Orange",
    "description": "Warm dusk \u00b7 glowing orange",
    "bg": "#1c100d",
    "surface": "#2b1b16",
    "raised": "#3d2921",
    "hover": "#50372b",
    "line": "#81604e",
    "accent": "#ffb077",
    "strong": "#fb9147",
    "secondary": "#f9c49a",
    "muted": "#d3beb3",
    "hue": 22,
    "accentHue": 32
  },
  {
    "id": "forest-green",
    "name": "Forest Green",
    "description": "Dark forest \u00b7 emerald light",
    "bg": "#091b15",
    "surface": "#102a20",
    "raised": "#1b3b2e",
    "hover": "#28513f",
    "line": "#4d7c64",
    "accent": "#6ee7ae",
    "strong": "#38cc8c",
    "secondary": "#9bdbc3",
    "muted": "#b4d0c1",
    "hue": 155,
    "accentHue": 145
  },
  {
    "id": "ocean-blue",
    "name": "Ocean Blue",
    "description": "Deep navy \u00b7 electric blue",
    "bg": "#091525",
    "surface": "#10243b",
    "raised": "#19344f",
    "hover": "#23486a",
    "line": "#4c7194",
    "accent": "#7bc8ff",
    "strong": "#43aff5",
    "secondary": "#a3bfff",
    "muted": "#b5c9dd",
    "hue": 225,
    "accentHue": 200
  },
  {
    "id": "ruby-red",
    "name": "Ruby Red",
    "description": "Dark burgundy \u00b7 ruby pink",
    "bg": "#210d17",
    "surface": "#321522",
    "raised": "#472335",
    "hover": "#5e3045",
    "line": "#87546b",
    "accent": "#ff91b1",
    "strong": "#f7618a",
    "secondary": "#e8a1cc",
    "muted": "#d8b8c9",
    "hue": 340,
    "accentHue": 325
  },
  {
    "id": "midnight",
    "name": "Midnight",
    "description": "Quiet charcoal \u00b7 soft periwinkle",
    "bg": "#10131c",
    "surface": "#1b2030",
    "raised": "#292f43",
    "hover": "#3a425b",
    "line": "#636e90",
    "accent": "#b5bcff",
    "strong": "#929df4",
    "secondary": "#c2c9ed",
    "muted": "#bfc5d9",
    "hue": 232,
    "accentHue": 245
  }
];
 const storageKey='evertale.appearance.theme';
 const normalize=id=>themes.some(t=>t.id===id)?id:'original-purple';
 function createController({storage,apply}){
  let current='original-purple';
  try{current=normalize(storage.getItem(storageKey));}catch{}
  apply(current);
  return {get current(){return current;},select(id){
   const next=normalize(id);
   // Persist before applying so a storage failure never claims the preference was saved.
   storage.setItem(storageKey,next);current=next;apply(next);return next;
  }};
 }
 const api={themes,storageKey,normalize,createController};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else{
  root.EverTaleThemes=api;
  let storage;try{storage=root.localStorage;}catch{storage={getItem(){},setItem(){throw Error('Local preferences are unavailable');}};}
  api.controller=createController({storage,apply:id=>{
   document.documentElement.dataset.theme=id;
   for(const image of document.querySelectorAll('[data-brand-logo]'))image.src=`assets/logo-${id}.png`;
  }});
 }
})(typeof window==='undefined'?globalThis:window);
