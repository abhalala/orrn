import { useId } from "react";

export const PROCESS_STAGES = ["scrap", "cast", "die", "press", "age", "pack", "dispatch"] as const;
export type ProcessStage = (typeof PROCESS_STAGES)[number];

/** Original process illustrations, not product screenshots or measured plant data. */
export function ExtrusionArt() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 1440 460" fill="none" focusable="false" className="marketing-extrusion">
      <defs>
        <linearGradient id={`${id}-heat`} x1="90" y1="130" x2="790" y2="310" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--tone-amber-to)" stopOpacity="0" />
          <stop offset=".45" stopColor="var(--tone-amber-to)" />
          <stop offset=".7" stopColor="var(--tone-amber-from)" />
          <stop offset="1" stopColor="var(--foreground)" />
        </linearGradient>
        <linearGradient id={`${id}-steel`} x1="720" y1="160" x2="1120" y2="430" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--foreground)" />
          <stop offset=".3" stopColor="var(--input)" />
          <stop offset=".52" stopColor="var(--foreground)" />
          <stop offset=".56" stopColor="var(--muted-foreground)" />
          <stop offset="1" stopColor="var(--card)" />
        </linearGradient>
        <linearGradient id={`${id}-die`} x1="660" y1="80" x2="820" y2="350" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--input)" />
          <stop offset=".4" stopColor="var(--card)" />
          <stop offset="1" stopColor="var(--background)" />
        </linearGradient>
      </defs>
      <g stroke="var(--border)" opacity=".65">
        <path d="M0 385H1440M0 450 1440 335M160 460 850 80M520 460 1000 80M920 460 1160 80" />
      </g>
      <g className="marketing-molten">
        <path d="M0 165C180 110 265 265 390 194S550 132 724 204L744 253C610 192 548 262 423 238S205 191 0 245Z" fill={`url(#${id}-heat)`} />
        <path d="M30 192C240 153 270 239 401 212S574 184 725 226" stroke="var(--tone-amber-from)" strokeWidth="2" opacity=".8" />
        <path d="M120 143C320 177 350 99 490 167S630 166 713 202" stroke="var(--tone-amber-to)" opacity=".4" />
      </g>
      <g>
        <path d="M695 98 742 76C807 77 854 137 849 216S802 359 744 365L697 340Z" fill={`url(#${id}-die)`} stroke="var(--input)" />
        <ellipse cx="700" cy="220" rx="92" ry="123" fill={`url(#${id}-die)`} stroke="var(--input)" />
        <ellipse cx="700" cy="220" rx="67" ry="96" stroke="var(--muted-foreground)" opacity=".5" />
        <path d="m675 189 33-10 26 22-10 18 17 16-26 29-38-9 5-23-17-18Z" fill="var(--background)" stroke="var(--tone-amber-to)" strokeWidth="2" />
        <circle cx="675" cy="123" r="4" fill="var(--input)" /><circle cx="745" cy="154" r="4" fill="var(--input)" />
        <circle cx="650" cy="300" r="4" fill="var(--input)" /><circle cx="752" cy="288" r="4" fill="var(--input)" />
      </g>
      <g className="marketing-profile">
        <path d="m709 198 506 83 55 54-32 26-48-24-6 36-62 24-411-156 28-19Z" fill={`url(#${id}-steel)`} stroke="var(--muted-foreground)" />
        <path d="m709 198 506 83-33 24-481-98M701 230l483 143M733 222l505 139M711 241l411 156" stroke="var(--foreground)" opacity=".6" />
        <path d="m1215 281 55 54-32 26-48-24-6 36-62 24 9-40 36-18-22-24Z" fill="var(--card)" stroke="var(--foreground)" />
        <path d="m1213 300 34 34-11 9-60-26-25 8 32 21-30 15-3 16 16-6 6-50 41 18" stroke="var(--muted-foreground)" strokeWidth="2" />
      </g>
    </svg>
  );
}

export function ProcessArt({ stage }: { stage: ProcessStage }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 520 400" fill="none" focusable="false" data-process-art data-stage={stage}>
      <defs>
        <linearGradient id={`${id}-metal`} x1="100" y1="80" x2="360" y2="340" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--foreground)" /><stop offset=".3" stopColor="var(--input)" />
          <stop offset=".52" stopColor="var(--foreground)" /><stop offset="1" stopColor="var(--card)" />
        </linearGradient>
        <linearGradient id={`${id}-hot`} x1="140" y1="70" x2="330" y2="320" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--tone-amber-from)" /><stop offset="1" stopColor="var(--tone-amber-to)" stopOpacity=".25" />
        </linearGradient>
      </defs>
      <g stroke="var(--border)"><path d="m30 310 230-140 230 140-230 75Z" /><path d="M260 170V45M30 310v-85M490 310v-85" /></g>
      <g data-metal-stage="scrap" fill={`url(#${id}-metal)`} stroke="var(--input)">
        <path d="m100 245 86-76 39 12-51 75 43 22-58 27Z" /><path d="m210 170 57-58 55 38-19 41-43-23-22 31Z" />
        <path d="m277 250 67-68 70 30-26 55-71 41-44-26 43-28Z" /><path d="m195 292 59-64 41 16-45 84Z" />
      </g>
      <g data-metal-stage="cast">
        <path d="m162 100 95-39 70 33-36 66-94 21Z" fill={`url(#${id}-metal)`} stroke="var(--input)" />
        <path d="M287 139c-24 60 31 66 6 122" stroke={`url(#${id}-hot)`} strokeWidth="12" />
        <ellipse cx="265" cy="275" rx="91" ry="38" fill={`url(#${id}-hot)`} />
        <path d="M174 275v40c0 50 182 50 182 0v-40" fill={`url(#${id}-metal)`} stroke="var(--input)" />
        <ellipse cx="265" cy="275" rx="91" ry="38" stroke="var(--tone-amber-from)" />
      </g>
      <g data-metal-stage="die">
        <path d="m238 90 47-15c126 16 126 232 0 250l-47-15" fill={`url(#${id}-metal)`} stroke="var(--input)" />
        <ellipse cx="238" cy="200" rx="99" ry="112" fill={`url(#${id}-metal)`} stroke="var(--input)" />
        <ellipse cx="238" cy="200" rx="75" ry="88" stroke="var(--muted-foreground)" />
        <path d="m204 176 35-15 33 18-13 25 19 16-35 25-33-17 10-24-22-12Z" fill="var(--background)" stroke="var(--tone-amber-to)" strokeWidth="2" />
      </g>
      <g data-metal-stage="press" fill={`url(#${id}-metal)`} stroke="var(--input)">
        <path d="m105 133 80-40 247 164-75 57Z" /><path d="m105 133 252 181v-37L105 99Z" />
        <path d="m357 277 75-57v37l-75 57Z" fill="var(--card)" /><path d="m123 137 234 161 55-41M357 298v-21" stroke="var(--foreground)" />
      </g>
      <g data-metal-stage="age" stroke="var(--input)">
        <path d="m100 160 150-79 173 94v139l-154 58-169-82Z" fill="var(--card)" />
        <path d="m100 160 169 90 154-75M269 250v122" /><path d="m128 193 111 60v64l-111-54Z" fill={`url(#${id}-hot)`} />
        <path d="m142 214 86 46m-86-24 86 46m-86-24 86 46" stroke="var(--foreground)" />
        <path d="m310 220 76-31m-76 62 76-31m-76 62 76-31" />
      </g>
      <g data-metal-stage="pack" fill={`url(#${id}-metal)`} stroke="var(--input)">
        <path d="m95 185 94-54 244 145-99 60Z" /><path d="m95 185 239 151v-42L95 143Z" />
        <path d="m334 294 99-59v41l-99 60Z" fill="var(--card)" />
        <path d="m174 140 238 145m-26-131-95 55v44m189-98-96 56v43" stroke="var(--foreground)" />
        <path d="m243 249 43 28v35l-43-27Z" fill="var(--foreground)" />
      </g>
      <g data-metal-stage="dispatch" stroke="var(--input)">
        <path d="m76 180 145-80 199 113-150 85Z" fill={`url(#${id}-metal)`} />
        <path d="M76 180v56l194 115v-53M270 351l150-87v-51" fill="var(--card)" />
        <path d="m124 161 194 113m-145-140 196 112M105 216l137 79" />
        <path d="m323 123 36-21 61 35-36 22Z" fill="var(--tone-amber-to)" /><path d="m384 159 0 38 36-21v-39" fill={`url(#${id}-hot)`} />
      </g>
    </svg>
  );
}
