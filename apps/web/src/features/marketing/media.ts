/**
 * Photographs of the extrusion trade's world from Wikimedia Commons. None of
 * them is an orrn customer's plant; each caption says what the picture shows
 * and the footer carries the credit and licence (CC BY-SA asks for both).
 */
import billetsLg from "./media/billets-lg.webp";
import billetsSm from "./media/billets-sm.webp";
import dieLg from "./media/die-lg.webp";
import dieSm from "./media/die-sm.webp";
import furnaceLg from "./media/furnace-lg.webp";
import furnaceSm from "./media/furnace-sm.webp";
import gateLg from "./media/gate-lg.webp";
import gateSm from "./media/gate-sm.webp";
import pressLg from "./media/press-lg.webp";
import pressSm from "./media/press-sm.webp";
import profilesLg from "./media/profiles-lg.webp";
import profilesSm from "./media/profiles-sm.webp";
import scrapLg from "./media/scrap-lg.webp";
import scrapSm from "./media/scrap-sm.webp";
import yardLg from "./media/yard-lg.webp";
import yardSm from "./media/yard-sm.webp";

export const STAGES = ["scrap", "cast", "die", "press", "age", "pack", "dispatch"] as const;
export type Stage = (typeof STAGES)[number];

export type Photo = {
  lg: string;
  sm: string;
  /** Intrinsic size of `lg`; every `sm` file is 960px wide. */
  width: number;
  height: number;
  /** `object-position` that keeps the subject in frame when cropped. */
  focus: string;
  /** `contain` for a cut-out on a transparent ground that must not be cropped. */
  fit?: "contain";
  /** Ground colour sampled from the picture, shown while it loads. */
  ground: string;
  credit: { title: string; author: string; licence: string; licenceUrl: string; page: string };
};

const BY_SA_3 = "https://creativecommons.org/licenses/by-sa/3.0";
const BY_SA_4 = "https://creativecommons.org/licenses/by-sa/4.0";

export const PHOTOS = {
  furnace: {
    lg: furnaceLg,
    sm: furnaceSm,
    width: 1920,
    height: 1280,
    focus: "38% 62%",
    ground: "#1a120c",
    credit: {
      title: "Metallurgical Furnace in Guwahati, Assam",
      author: "Donvikro",
      licence: "CC BY-SA 4.0",
      licenceUrl: BY_SA_4,
      page: "https://commons.wikimedia.org/wiki/File:Metallurgical_Furnace_in_Guwahati,_Assam.jpg",
    },
  },
  scrap: {
    lg: scrapLg,
    sm: scrapSm,
    width: 1729,
    height: 1412,
    focus: "50% 60%",
    ground: "#6d7071",
    credit: {
      title: "DillingenAluminiumSchrott",
      author: "Lokilech",
      licence: "CC BY-SA 3.0",
      licenceUrl: BY_SA_3,
      page: "https://commons.wikimedia.org/wiki/File:DillingenAluminiumSchrott.jpg",
    },
  },
  billets: {
    lg: billetsLg,
    sm: billetsSm,
    width: 1920,
    height: 1184,
    focus: "30% 50%",
    ground: "#3a3a36",
    credit: {
      title: "Alba's Products - Billets",
      author: "Albasmelter",
      licence: "CC BY-SA 4.0",
      licenceUrl: BY_SA_4,
      page: "https://commons.wikimedia.org/wiki/File:Alba%27s_Products_-_Billets.jpg",
    },
  },
  die: {
    lg: dieLg,
    sm: dieSm,
    width: 1361,
    height: 1326,
    focus: "50% 50%",
    fit: "contain",
    ground: "#0c0c0e",
    credit: {
      title: "Aluminium extrusion die front",
      author: "Wizard191",
      licence: "CC BY-SA 3.0",
      licenceUrl: BY_SA_3,
      page: "https://commons.wikimedia.org/wiki/File:Aluminium_extrusion_die_front.png",
    },
  },
  press: {
    lg: pressLg,
    sm: pressSm,
    width: 1920,
    height: 1440,
    focus: "45% 50%",
    ground: "#4b4f52",
    credit: {
      title: "Al extrusion machine with dies",
      author: "Swoolverton",
      licence: "CC BY-SA 3.0",
      licenceUrl: BY_SA_3,
      page: "https://commons.wikimedia.org/wiki/File:Al_extrusion_machine_with_dies.jpg",
    },
  },
  profiles: {
    lg: profilesLg,
    sm: profilesSm,
    width: 1920,
    height: 833,
    focus: "50% 55%",
    ground: "#5a4a38",
    credit: {
      title: "Extruded aluminium section x3",
      author: "Mike1024",
      licence: "Public domain",
      licenceUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
      page: "https://commons.wikimedia.org/wiki/File:Extruded_aluminium_section_x3.jpg",
    },
  },
  gate: {
    lg: gateLg,
    sm: gateSm,
    width: 1920,
    height: 1440,
    focus: "50% 60%",
    ground: "#8aa5bf",
    credit: {
      title: "Dedicated lane for truck weighbridges",
      author: "Fumikas Sagisavas",
      licence: "CC0",
      licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      page: "https://commons.wikimedia.org/wiki/File:Dedicated_lane_for_truck_weighbridges.jpg",
    },
  },
  yard: {
    lg: yardLg,
    sm: yardSm,
    width: 1920,
    height: 1280,
    focus: "40% 70%",
    ground: "#6f8db3",
    credit: {
      title: "Alba's Products - Extrusion Billets",
      author: "Albasmelter",
      licence: "CC BY-SA 4.0",
      licenceUrl: BY_SA_4,
      page: "https://commons.wikimedia.org/wiki/File:Alba%27s_Products_-_Extrusion_Billets.jpg",
    },
  },
} as const satisfies Record<string, Photo>;

/** The photograph each stage of the chain shows; packing shows the label orrn prints instead. */
export const STAGE_PHOTO: Record<Exclude<Stage, "pack">, Photo> = {
  scrap: PHOTOS.scrap,
  cast: PHOTOS.billets,
  die: PHOTOS.die,
  press: PHOTOS.press,
  age: PHOTOS.profiles,
  dispatch: PHOTOS.gate,
};

export const PHOTO_CREDITS = Object.values(PHOTOS).map((photo) => photo.credit);

/** `srcset` for a photograph: the 960px `sm` file and the full-size `lg` file. */
export function srcSet(photo: Photo): string {
  return `${photo.sm} 960w, ${photo.lg} ${photo.width}w`;
}
