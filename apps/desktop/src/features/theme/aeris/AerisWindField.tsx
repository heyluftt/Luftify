import { useId } from "react";

/** Open, tapering airfoils: the eye follows the wind out of the frame. */
export function AerisWindField() {
  const id = `aeris-wind-${useId().replaceAll(":", "")}`;
  const paint = (name: string) => `url(#${id}-${name})`;
  return <svg className="aeris-wind" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" fill="none" focusable="false">
    <defs>
      <linearGradient id={`${id}-silk`} x1=".15" y1="1" x2="1" y2=".1">
        <stop stopColor="var(--aeris-cloud)" stopOpacity="0" />
        <stop offset=".28" stopColor="var(--aeris-sky)" stopOpacity=".34" />
        <stop offset=".48" stopColor="var(--aeris-mist)" stopOpacity=".68" />
        <stop offset=".57" stopColor="var(--aeris-white)" stopOpacity=".8" />
        <stop offset=".65" stopColor="var(--aeris-foil)" stopOpacity=".55" />
        <stop offset=".87" stopColor="var(--aeris-steel)" stopOpacity=".36" />
        <stop offset="1" stopColor="var(--aeris-sky)" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${id}-fold`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="var(--aeris-foil)" stopOpacity="0" />
        <stop offset=".4" stopColor="var(--aeris-shadow)" stopOpacity=".4" />
        <stop offset=".62" stopColor="var(--aeris-sky)" stopOpacity=".5" />
        <stop offset=".8" stopColor="var(--aeris-mist)" stopOpacity=".28" />
        <stop offset="1" stopColor="var(--aeris-foil)" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${id}-edge`} x1="0" y1="1" x2="1" y2="0">
        <stop stopColor="var(--aeris-glint)" stopOpacity="0" />
        <stop offset=".38" stopColor="var(--aeris-glint)" stopOpacity=".3" />
        <stop offset=".6" stopColor="var(--aeris-paper)" stopOpacity=".6" />
        <stop offset=".83" stopColor="var(--aeris-glint)" stopOpacity=".32" />
        <stop offset="1" stopColor="var(--aeris-glint)" stopOpacity="0" />
      </linearGradient>
    </defs>
    <g className="aeris-sheet aeris-sheet-back">
      <path d="M1030-90C829 115 898 219 1060 338C1205 467 1092 582 838 674L934 724C1173 613 1297 528 1133 403C978 293 952 134 1150-90Z" fill={paint("fold")} />
      <path d="M1030-90C829 115 898 219 1060 338C1205 467 1092 582 838 674" stroke={paint("edge")} strokeWidth="1" />
    </g>
    <g className="aeris-sheet aeris-sheet-front">
      <path d="M350 1110C715 968 696 738 928 545C1175 336 1748 440 1782 215L1748 368C1400 556 1092 718 948 875C773 1057 559 1110 482 1122Z" fill={paint("silk")} />
      <path className="aeris-sheet-edge" d="M350 1110C715 968 696 738 928 545C1175 336 1748 440 1782 215" stroke={paint("edge")} strokeWidth="1.8" />
      <path d="M482 1122C709 1048 821 932 948 875C1165 778 1400 556 1748 368C1410 586 1218 823 1010 903C839 968 709 1080 482 1122Z" fill={paint("fold")} />
      <path d="M482 1122C709 1048 821 932 948 875C1165 778 1400 556 1748 368" stroke={paint("edge")} strokeWidth=".8" />
    </g>
    <g className="aeris-wind-lines" stroke={paint("edge")} strokeWidth=".7">
      {[0, 1, 2, 3].map(i => <path key={i} opacity={.7 - i * .12}
        d={`M${235 + i * 32} 1110C${640 + i * 27} ${932 + i * 18} ${618 + i * 22} ${730 + i * 14} ${879 + i * 20} ${509 + i * 11}S${1570 + i * 38} ${371 + i * 19} 1750 ${108 + i * 33}`} />)}
    </g>
  </svg>;
}
