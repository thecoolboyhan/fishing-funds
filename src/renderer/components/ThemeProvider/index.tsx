import { PropsWithChildren } from 'react';
import { ConfigProvider, theme } from 'antd';

import * as Utils from '@/utils';
import * as CONST from '@/constants';

export interface ThemeProviderProps {
  target?: string;
  config: {
    darkMode: boolean;
    lowKey: boolean;
    lowKeyDegree: number;
    baseFontSize: number;
    primaryColor: string;
    /** 涨跌色反转（2026-11-23）：默认 false=红涨绿跌（A 股习惯）；true=绿涨红跌（美股/币圈习惯） */
    reverseRiseFall?: boolean;
  };
}
export type StylesProps = ThemeProviderProps;

const { useToken } = theme;
const baseAlgorithm: any[] = [];

const Styles: React.FC<StylesProps> = (props) => {
  const { config, target } = props;
  const { token } = useToken();

  // 涨跌色映射（2026-11-23）：默认红涨绿跌（A 股）；reverseRiseFall 时绿涨红跌（美股/币圈）。
  // CSS 变量与 JS 覆盖层共用这组值，切换开关时二者始终一致。danger-color 是删除语义色，
  // 不属于涨跌色，保持 token 原色不参与反转。
  const riseColor = config.reverseRiseFall ? token.colorSuccessText : token.colorErrorText;
  const riseBg = config.reverseRiseFall ? token.colorSuccessBg : token.colorErrorBg;
  const fallColor = config.reverseRiseFall ? token.colorErrorText : token.colorSuccessText;
  const fallBg = config.reverseRiseFall ? token.colorErrorBg : token.colorSuccessBg;

  // 2026-11-23：在 render 阶段（而非 effect）用当前 token 同步注入颜色覆盖层。
  // 这样本帧渲染的子组件（含 echarts 内联色）即可拿到新主题色，不必等 <style> commit。
  // 仅全局 ThemeProvider（无 target）注入；设置页预览用 target 限定作用域，不应污染全局。
  if (!target) {
    const colorMap: Record<string, string> = {
      '--background-color': token.colorBgContainer,
      '--primary-color': token.colorPrimary,
      '--increase-color': riseColor,
      '--increase-bg-color': riseBg,
      '--reduce-color': fallColor,
      '--reduce-bg-color': fallBg,
      '--cancel-color': token.colorFillSecondary,
      '--cancel-text-color': token.colorTextSecondary,
      '--main-text-color': token.colorText,
      '--secondary-main-text-color': token.colorTextTertiary,
      '--reverse-text-color': config.darkMode ? '#9a9a9a' : '#767676',
      '--border-color': token.colorFillQuaternary,
      '--inner-color': token.colorBgLayout,
      '--inner-text-color': token.colorTextTertiary,
      '--hover-color': token.colorPrimaryBg,
      '--selected-color': token.colorPrimaryBgHover,
      '--alipay-color': '#156dff',
      '--wechat-color': '#1fa131',
      '--svg-icon-color': token.colorTextSecondary,
      '--blur-color': config.darkMode ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.72)',
      '--tag-text-color': token.colorTextLightSolid,
      '--warn-color': token.colorWarningText,
      '--warn-bg-color': token.colorWarningBg,
      '--block-border-color': config.darkMode ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.5)',
      '--base-font-size': `${token.fontSize}px`,
      '--base-padding': `${token.paddingSM}px`,
      '--base-radius': `${token.borderRadiusLG}px`,
    };
    Utils.SetVariblesColorOverride(colorMap as Partial<Record<keyof typeof CONST.VARIBLES, string>>);
  }

  return (
    <style>
      {` ${target || ':root'} {
            filter: ${config.lowKey && `grayscale(${config.lowKeyDegree}%)`};
            font-size: ${token.fontSize}px;
            font-family: ${token.fontFamily};
            --base-padding: ${token.paddingSM}px;
            --base-radius: ${token.borderRadiusLG}px;
            --base-font-size: ${token.fontSize}px;

            --primary-color: ${token.colorPrimary};
            /* 2026-11-20：主色的「文字版」。--primary-color 同时承担背景（按钮/徽标）
               和文字（链接/选中态图标）两种角色，但二者对明度的要求相反：背景要够深
               才能托住白字，深色模式下当文字又要够浅。antd 的 darkAlgorithm 反而把
               seed 压暗（#9333EA → #802ECA，对 #141414 只有 2.77:1），所以这里按
               实际对比度自动往白色方向补，保证两套模式都可读。 */
            --primary-text-color: ${Utils.MakeReadableOn(token.colorPrimary, token.colorBgContainer)};
            /* 压在主色背景上的文字/图标色。预设色已保证白字 ≥4.5:1，但取色器允许
               任选颜色，这里按实际对比度在黑白间自动挑一个。 */
            --on-primary-color: ${Utils.GetContrastText(token.colorPrimary)};
            --hover-color: ${token.colorPrimaryBg};
            --selected-color: ${token.colorPrimaryBgHover};
            --background-color: ${token.colorBgContainer};
            --inner-color: ${token.colorBgLayout};
            --inner-text-color: ${token.colorTextTertiary};
            --main-text-color: ${token.colorText};
            --secondary-main-text-color: ${token.colorTextTertiary};
            --increase-color: ${riseColor};
            --increase-bg-color: ${riseBg};
            --reduce-color: ${fallColor};
            --reduce-bg-color: ${fallBg};
            --warn-color: ${token.colorWarningText};
            --warn-bg-color: ${token.colorWarningBg};
            /* 2026-11-20：删除/必填标记的语义色。原先 8 个文件硬编码 #d65746，
               与涨红不同源、深色模式下也不跟随，统一走 token。 */
            --danger-color: ${token.colorErrorText};
            --tag-text-color: ${token.colorTextLightSolid};
            --svg-icon-color: ${token.colorTextSecondary};
            --border-color: ${token.colorFillQuaternary};
            --cancel-color: ${token.colorFillSecondary};
            --cancel-text-color: ${token.colorTextSecondary};

            --reverse-text-color: ${config.darkMode ? '#9a9a9a' : '#767676'};
            --alipay-color: #156dff;
            --wechat-color: #1fa131;
            --blur-color: ${config.darkMode ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.72)'};
            --block-border-color: ${config.darkMode ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.5)'};
      }`}
    </style>
  );
};

const ThemeProvider: React.FC<PropsWithChildren<ThemeProviderProps>> = (props) => {
  const { config, target } = props;

  return (
    <ConfigProvider
      theme={{
        cssVar: true,
        hashed: false,
        token: {
          colorPrimary: config.primaryColor,
          fontSize: config.baseFontSize,
          // 2026-11-19：原 token 未声明 fontFamily，中文在 macOS/Windows 上落到默认 sans-serif，
          // 安卓 WebView 更会退到 Roboto。显式给中英文混排栈，三端表现统一。
          fontFamily: [
            '-apple-system',
            'BlinkMacSystemFont',
            '"PingFang SC"',
            '"Hiragino Sans GB"',
            '"Microsoft YaHei"',
            '"Segoe UI"',
            'Roboto',
            '"Helvetica Neue"',
            'Arial',
            'sans-serif',
          ].join(', '),
          borderRadius: 8,
          borderRadiusLG: 12,
          // Material 3 动效参数（2026-11-20）：antd 内部所有动画（Tab 切换、抽屉、
          // 下拉、气泡、折叠）都读这几个 token，改这里等于全局校准一次。
          // 曲线换成 M3 的 emphasized/decelerate 是主要收益；时长仍比 CSS 变量层的
          // 页面级时长短一档（控件体量小，标签指示条用 400ms 会显得拖沓）。
          motionDurationFast: '100ms',
          motionDurationMid: '200ms',
          motionDurationSlow: '300ms',
          motionEaseInOut: 'cubic-bezier(0.2, 0, 0, 1)',
          motionEaseOut: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
          // ★ 涨跌色（2026-11-20 对比度修复）：原值 #F6465D / #2EBD85 是币安配色，
          // 在白底上实测只有 3.53:1 和 **2.40:1** —— 跌绿连 WCAG 大字号标准(3:1)都不到，
          // 长串跌停数字几乎看不清。antd 不会自动修正这两个色（colorErrorText 直接等于
          // 传入值），必须自己按明暗主题分别给达标值：
          //   浅色 红 #D03050 = 4.98:1 ✓ / 绿 #12855A = 4.64:1 ✓
          //   深色 红 #FF8A85 → 算法输出 #DC7874 = 6.12:1 ✓ / 绿 #36CF9A → #31B386 = 6.95:1 ✓
          // 深色必须传亮值：darkAlgorithm 会把颜色压暗一档，直接传浅色值会掉到 4:1 以下。
          colorSuccess: config.darkMode ? '#36CF9A' : '#12855A',
          colorWarning: '#F0B90B',
          colorError: config.darkMode ? '#FF8A85' : '#D03050',
        },
        algorithm: config.darkMode ? [...baseAlgorithm, theme.darkAlgorithm] : baseAlgorithm,
      }}
      button={{ autoInsertSpace: false }}
      componentSize="small"
      space={{ size: 'small' }}
    >
      <Styles config={config} target={target} />
      {props.children}
    </ConfigProvider>
  );
};
export default ThemeProvider;
