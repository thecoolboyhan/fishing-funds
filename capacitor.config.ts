import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.thecoolboyhan.fishingfunds',
  appName: 'Fishing Funds',
  // 四端共用同一份 renderer：桌面端 electron-vite 构建产物即安卓端 web 资源
  webDir: 'release/app/dist/renderer',
  server: {
    // 用 https scheme 避免 capacitor:// 在部分 Android WebView 的 cleartext/同源问题
    androidScheme: 'https',
  },
};

export default config;
