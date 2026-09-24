package com.thecoolboyhan.fishingfunds;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.thecoolboyhan.fishingfunds.plugins.ContextModulesPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册多端统一桥（对应 Electron 端 src/preload/index.ts）。须在 super.onCreate 前注册。
        registerPlugin(ContextModulesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
