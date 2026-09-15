import Svg, { Circle, Path, Rect } from "react-native-svg";

import { useAppTheme } from "@/hooks/use-app-theme";

/**
 * The megaphone for notices and push notices.
 *
 * Drawn rather than shipped as a PNG so it takes the theme's own green in light
 * and dark, and never brings a colour of its own. Decorative: hidden from
 * screen readers, the text beside it says what the screen is.
 */
export function NoticeArt({ size = 72 }: { size?: number }) {
  const { colors } = useAppTheme();

  return (
    <Svg
      accessibilityElementsHidden
      height={size}
      importantForAccessibility="no-hide-descendants"
      viewBox="0 0 120 120"
      width={size}
    >
      <Circle cx={58} cy={62} fill={colors.primary} fillOpacity={0.1} r={50} />
      <Circle cx={104} cy={100} fill={colors.primary} fillOpacity={0.14} r={7} />
      <Circle cx={14} cy={30} fill={colors.primary} fillOpacity={0.14} r={5} />
      <Path
        d="M40 72 L47 95 Q48 99 52 99 L57 99 Q61 99 60 95 L54 74 Z"
        fill={colors.primary}
        fillOpacity={0.55}
      />
      <Rect fill={colors.primary} fillOpacity={0.8} height={26} rx={6} width={16} x={22} y={50} />
      <Path d="M36 52 L78 32 Q82 30 82 35 L82 91 Q82 96 78 94 L36 74 Z" fill={colors.primary} />
      <Path
        d="M44 55 L74 41 L74 47 L44 61 Z"
        fill={colors.primaryForeground}
        fillOpacity={0.28}
      />
      <Rect fill={colors.primary} fillOpacity={0.85} height={70} rx={4} width={8} x={80} y={28} />
      <Path
        d="M96 50 Q103 63 96 76"
        fill="none"
        stroke={colors.primary}
        strokeLinecap="round"
        strokeWidth={4}
      />
      <Path
        d="M106 42 Q117 63 106 84"
        fill="none"
        stroke={colors.primary}
        strokeLinecap="round"
        strokeOpacity={0.5}
        strokeWidth={4}
      />
      <Circle cx={84} cy={26} fill={colors.warning} r={9} stroke={colors.card} strokeWidth={3} />
    </Svg>
  );
}
