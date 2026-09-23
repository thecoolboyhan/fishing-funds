package com.thecoolboyhan.fishingfunds.plugins;

import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.util.Base64;
import android.util.Log;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * 多端统一桥的安卓实现（对应 Electron 端 src/preload/index.ts）。
 * 详见仓库根 ARCHITECTURE.md §3。所有方法签名须与 Electron 预加载、src/renderer/typings/preload.d.ts 一致。
 *
 * 原始值（含基本类型）无法被 Capacitor 直接 resolve，故 get/all/readText/readFile/readStringFile/getVersion
 * 用 {__wrapped:true, value:<原始值>} 包裹，由渲染端桥引导脚本统一解包，保证四端契约一致。
 *
 * 注意：Capacitor 6 的 @PluginMethod 无 thread 属性，方法默认在 UI 线程执行；
 * 网络与文件 I/O 必须自行切到后台线程，再回到 UI 线程 resolve。
 */
@CapacitorPlugin(name = "ContextModules")
public class ContextModulesPlugin extends Plugin {

    private static final String TAG = "ContextModules";

    private String secret;

    @Override
    public void load() {
        // 复刻 httpClient.ts：每次启动生成随机 secret，用于 eastmoney 的 nid cookie
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        secret = sb.toString();
    }

    // ---------------- request ----------------
    @PluginMethod
    public void request(PluginCall call) {
        final String url = call.getString("url");
        final JSObject config = call.getData().has("config") ? call.getData().getJSObject("config") : new JSObject();
        new Thread(() -> {
            try {
                String method = config.has("method") ? config.getString("method") : "GET";
                JSObject headersObj = config.has("headers") ? config.getJSObject("headers") : new JSObject();
                JSObject searchParams = config.has("searchParams") ? config.getJSObject("searchParams") : new JSObject();
                String bodyStr = config.has("body") ? config.getString("body") : null;
                String responseType = config.has("responseType") ? config.getString("responseType") : "text";

                // query 拼接
                String reqUrl = url;
                if (searchParams.keys().hasNext()) {
                    StringBuilder q = new StringBuilder();
                    Iterator<String> it = searchParams.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        Object v = searchParams.get(k);
                        q.append(q.length() == 0 ? "?" : "&").append(k).append("=").append(Uri.encode(String.valueOf(v)));
                    }
                    reqUrl = reqUrl + q.toString();
                }

                URL u = new URL(reqUrl);
                HttpURLConnection conn = (HttpURLConnection) u.openConnection();
                conn.setRequestMethod(method);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent",
                    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
                conn.setRequestProperty("Host", u.getHost());

                Iterator<String> hit = headersObj.keys();
                while (hit.hasNext()) {
                    String k = hit.next();
                    conn.setRequestProperty(k, String.valueOf(headersObj.get(k)));
                }

                // eastmoney nid cookie（复刻 httpClient.ts）
                if (u.getHost().contains("eastmoney.com")) {
                    String key = new java.text.SimpleDateFormat("yyyy-MM-dd-HH").format(new java.util.Date());
                    conn.setRequestProperty("Cookie", "nid=" + md5(secret + "-" + key));
                }

                if (bodyStr != null && !bodyStr.isEmpty() && !method.equalsIgnoreCase("GET")) {
                    conn.setDoOutput(true);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(bodyStr.getBytes(StandardCharsets.UTF_8));
                    }
                }

                int code = conn.getResponseCode();
                // 与 Electron(undici) 契约对齐：4xx/5xx 也要返回响应体；
                // 响应体为空时必须给空串，绝不能整包丢弃（原实现遇 4xx 且 errorStream 为 null 会抛异常 → {}）
                InputStream in;
                if (code >= 400) {
                    in = conn.getErrorStream();
                    if (in == null) in = new ByteArrayInputStream(new byte[0]);
                } else {
                    in = conn.getInputStream();
                }
                byte[] data = readAll(in);
                in.close();

                JSObject result = new JSObject();
                if ("json".equals(responseType)) {
                    String text = new String(data, StandardCharsets.UTF_8);
                    if (text.isEmpty()) {
                        // 空响应体：桌面端 body.json() 会抛错并落到 {}，此处显式对齐
                        final JSObject empty = new JSObject();
                        getActivity().runOnUiThread(() -> call.resolve(empty));
                        return;
                    }
                    result.put("body", parseJson(text));
                } else if ("arraybuffer".equals(responseType)) {
                    // Capacitor 无法序列化 byte[]（会被 JSONObject 当作非法值静默吞掉，
                    // 退化成 "[B@xxxx" 字符串），统一改走 base64 + __binary 标记，
                    // 由渲染端桥引导脚本解码回 ArrayBuffer。
                    result.put("body", Base64.encodeToString(data, Base64.NO_WRAP));
                    result.put("__binary", true);
                } else {
                    result.put("body", new String(data, StandardCharsets.UTF_8));
                }

                JSObject hdrs = new JSObject();
                for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                    if (e.getKey() == null) continue;
                    hdrs.put(e.getKey(), String.join(", ", e.getValue()));
                }
                result.put("headers", hdrs);
                final JSObject res = result;
                getActivity().runOnUiThread(() -> call.resolve(res));
            } catch (Exception e) {
                // 复刻 httpClient.ts：出错返回空对象 {}。
                // 日志必须保留：否则安卓端数据层故障会完全静默（桌面端至少能在终端看到 undici 堆栈）。
                Log.e(TAG, "request failed: " + url, e);
                // 额外打一个 __failed 标记：与「真的拿到了空响应体」区分开，
                // 供渲染端桥引导脚本判断是否需要换用 WebView 浏览器栈重试（见 index.html）。
                // 标记对外语义不变——旧调用方读 body/headers 依旧拿到空对象。
                final JSObject failed = new JSObject();
                failed.put("__failed", true);
                failed.put("__error", String.valueOf(e));
                getActivity().runOnUiThread(() -> call.resolve(failed));
            }
        }).start();
    }

    // ---------------- electronStore ----------------
    @PluginMethod
    public void storeGet(PluginCall call) {
        String type = call.getString("type");
        String key = call.getString("key");
        android.content.SharedPreferences sp = getContext().getSharedPreferences(type, Context.MODE_PRIVATE);
        if (!sp.contains(key)) {
            resolveWrapped(call, call.getData().opt("init"));
            return;
        }
        resolveWrapped(call, parseJson(sp.getString(key, null)));
    }

    @PluginMethod
    public void storeSet(PluginCall call) {
        String type = call.getString("type");
        String key = call.getString("key");
        Object data = call.getData().opt("data");
        getContext().getSharedPreferences(type, Context.MODE_PRIVATE)
            .edit().putString(key, toJson(data)).apply();
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void storeDelete(PluginCall call) {
        String type = call.getString("type");
        String key = call.getString("key");
        getContext().getSharedPreferences(type, Context.MODE_PRIVATE)
            .edit().remove(key).apply();
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void storeCover(PluginCall call) {
        String type = call.getString("type");
        // 与 toJson 同一根因：结构化对象可能被 Capacitor 压成 JSON 文本传来。
        // 若只用 getJSObject("value")，遇到字符串会拿到 null，
        // 于是「先 clear() 再写空」——整个命名空间被静默清空（恢复备份时损失全部配置）。
        Object raw = call.getData().opt("value");
        // 同样要用基类 JSONObject 判断：Capacitor 经 JSObject(String) 解析出来的嵌套值是
        // org.json.JSONObject 本体，只判 JSObject 会得到 null → clear() 后什么都没写，
        // 整个命名空间被静默清空（恢复备份时损失全部配置）。
        JSONObject value = null;
        if (raw instanceof JSONObject) {
            value = (JSONObject) raw;
        } else if (raw instanceof String) {
            try {
                value = new JSObject((String) raw);
            } catch (Exception e) {
                Log.e(TAG, "storeCover: value 不是合法 JSON 对象，拒绝覆盖以免清空 " + type, e);
                call.reject("invalid value for storeCover");
                return;
            }
        }
        android.content.SharedPreferences.Editor ed = getContext()
            .getSharedPreferences(type, Context.MODE_PRIVATE).edit();
        ed.clear();
        if (value != null) {
            Iterator<String> it = value.keys();
            while (it.hasNext()) {
                String k = it.next();
                ed.putString(k, toJson(value.opt(k)));
            }
        }
        ed.apply();
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void storeAll(PluginCall call) {
        String type = call.getString("type");
        android.content.SharedPreferences sp = getContext().getSharedPreferences(type, Context.MODE_PRIVATE);
        JSObject map = new JSObject();
        for (Map.Entry<String, ?> e : sp.getAll().entrySet()) {
            map.put(e.getKey(), parseJson(String.valueOf(e.getValue())));
        }
        resolveWrapped(call, map);
    }

    // ---------------- shell.openExternal ----------------
    @PluginMethod
    public void openExternal(PluginCall call) {
        try {
            String url = call.getString("url");
            getActivity().runOnUiThread(() -> {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getActivity().startActivity(i);
                    call.resolve();
                } catch (Exception e) {
                    call.reject(e.getMessage());
                }
            });
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    // ---------------- clipboard ----------------
    @PluginMethod
    public void writeText(PluginCall call) {
        String value = call.getString("value");
        ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("fishing-funds", value == null ? "" : value));
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void readText(PluginCall call) {
        ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        String text = "";
        if (cm != null && cm.getPrimaryClip() != null && cm.getPrimaryClip().getItemCount() > 0) {
            CharSequence cs = cm.getPrimaryClip().getItemAt(0).getText();
            text = cs == null ? "" : cs.toString();
        }
        resolveWrapped(call, text);
    }

    // ---------------- io ----------------
    @PluginMethod
    public void saveString(PluginCall call) {
        final String path = call.getString("path");
        final String content = call.getString("content");
        new Thread(() -> {
            try {
                File f = resolveFile(path, "export.txt");
                try (FileOutputStream os = new FileOutputStream(f)) {
                    os.write(content == null ? new byte[0] : content.getBytes(StandardCharsets.UTF_8));
                }
                final JSObject r = new JSObject().put("path", f.getAbsolutePath());
                getActivity().runOnUiThread(() -> call.resolve(r));
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject(e.getMessage()));
            }
        }).start();
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        final String path = call.getString("path");
        final String dataUrl = call.getString("dataUrl");
        new Thread(() -> {
            try {
                String mime = "image/png";
                String base64 = dataUrl;
                int comma = dataUrl.indexOf(',');
                if (comma > 0) {
                    String meta = dataUrl.substring(0, comma);
                    base64 = dataUrl.substring(comma + 1);
                    if (meta.contains("jpeg")) mime = "image/jpeg";
                    else if (meta.contains("png")) mime = "image/png";
                    else if (meta.contains("webp")) mime = "image/webp";
                }
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
                if (ext == null) ext = "png";
                File f = resolveFile(path, "image." + ext);
                try (FileOutputStream os = new FileOutputStream(f)) {
                    os.write(bytes);
                }
                final JSObject r = new JSObject().put("path", f.getAbsolutePath());
                getActivity().runOnUiThread(() -> call.resolve(r));
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject(e.getMessage()));
            }
        }).start();
    }

    @PluginMethod
    public void saveJsonToCsv(PluginCall call) {
        final String path = call.getString("path");
        final JSArray json = call.getArray("json");
        new Thread(() -> {
            try {
                StringBuilder sb = new StringBuilder();
                if (json != null && json.length() > 0) {
                    Object first = json.get(0);
                    // 用基类 JSONObject：数组元素是 org.json.JSONObject 本体，只判 JSObject
                    // 会漏掉表头与所有数据行，导出出一个只有 BOM 的空 CSV。
                    if (first instanceof JSONObject) {
                        JSONObject row0 = (JSONObject) first;
                        Iterator<String> cols = row0.keys();
                        boolean firstCol = true;
                        while (cols.hasNext()) {
                            if (!firstCol) sb.append(",");
                            sb.append(csvCell(cols.next()));
                            firstCol = false;
                        }
                        sb.append("\n");
                    }
                    for (int i = 0; i < json.length(); i++) {
                        Object row = json.get(i);
                        if (row instanceof JSONObject) {
                            JSONObject r = (JSONObject) row;
                            Iterator<String> cols = r.keys();
                            boolean firstCol = true;
                            while (cols.hasNext()) {
                                if (!firstCol) sb.append(",");
                                sb.append(csvCell(String.valueOf(r.get(cols.next()))));
                                firstCol = false;
                            }
                            sb.append("\n");
                        }
                    }
                }
                File f = resolveFile(path, "export.csv");
                try (FileOutputStream os = new FileOutputStream(f)) {
                    os.write(sb.toString().getBytes(StandardCharsets.UTF_8));
                }
                final JSObject r = new JSObject().put("path", f.getAbsolutePath());
                getActivity().runOnUiThread(() -> call.resolve(r));
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject(e.getMessage()));
            }
        }).start();
    }

    @PluginMethod
    public void readStringFile(PluginCall call) {
        final String path = call.getString("path");
        new Thread(() -> {
            try {
                File f = resolveFile(path, "export.txt");
                String content = new String(readAll(new FileInputStream(f)), StandardCharsets.UTF_8);
                resolveWrappedAsync(call, content);
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject(e.getMessage()));
            }
        }).start();
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        final String path = call.getString("path");
        new Thread(() -> {
            try {
                File f = resolveFile(path, "export");
                byte[] data = readAll(new FileInputStream(f));
                resolveWrappedAsync(call, data);
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject(e.getMessage()));
            }
        }).start();
    }

    // ---------------- getVersion ----------------
    @PluginMethod
    public void getVersion(PluginCall call) {
        String v = "8.7.1";
        try {
            v = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0).versionName;
        } catch (Exception ignored) {
        }
        resolveWrapped(call, v);
    }

    // ---------------- helpers ----------------
    private void resolveWrapped(PluginCall call, Object value) {
        JSObject w = new JSObject();
        w.put("__wrapped", true);
        w.put("value", value == null ? JSONObject.NULL : value);
        call.resolve(w);
    }

    // 后台线程里解包后回到 UI 线程 resolve
    private void resolveWrappedAsync(PluginCall call, Object value) {
        JSObject w = new JSObject();
        w.put("__wrapped", true);
        w.put("value", value == null ? JSONObject.NULL : value);
        final JSObject res = w;
        getActivity().runOnUiThread(() -> call.resolve(res));
    }

    private File resolveFile(String path, String fallbackName) {
        File dir = new File(getActivity().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "fishing-funds");
        if (!dir.exists()) dir.mkdirs();
        String name = path == null ? null : new File(path).getName();
        if (name == null || name.isEmpty() || name.equals("/")) name = fallbackName;
        return new File(dir, name);
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    private static String md5(String s) throws Exception {
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] d = md.digest(s.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static Object parseJson(String txt) {
        if (txt == null) return JSONObject.NULL;
        txt = txt.trim();
        try {
            if (txt.startsWith("{")) return new JSObject(txt);
            if (txt.startsWith("[")) return new JSArray(txt);
        } catch (Exception ignored) {
        }
        if ("null".equals(txt)) return JSONObject.NULL;
        if ("true".equals(txt)) return true;
        if ("false".equals(txt)) return false;
        if (txt.matches("-?\\d+(\\.\\d+)?")) {
            try {
                if (txt.contains(".")) return Double.parseDouble(txt);
                return Integer.parseInt(txt);
            } catch (Exception ignored) {
            }
        }
        if (txt.length() >= 2 && txt.startsWith("\"") && txt.endsWith("\"")) {
            return txt.substring(1, txt.length() - 1);
        }
        return txt;
    }

    private static String toJson(Object o) {
        if (o == null || o == JSONObject.NULL) return "null";
        // ⚠️ 必须用 org.json 的基类 JSONObject / JSONArray 判断，不能只用 Capacitor 的
        // JSObject / JSArray：JSObject(String) 解析出来的嵌套值，opt() 返回的是
        // org.json.JSONObject / JSONArray 本体（不是 Capacitor 子类），
        // 只判子类会漏到最后一行的兜底分支 → String.valueOf(o) 得到 JSON 文本再被 quote 一次，
        // 形成「双重编码」：
        //   写：存储成  "[{\"a\":1}]"（多了一层引号）
        //   读：parseJson 剥掉外层引号 → 拿到的是 String，而不是数组/对象
        // 实测后果：all('config') 里 WALLET_SETTING 变成字符串，而 Utils.GetCodeMap(list)
        // 内部是 list.reduce(...)，在 String 上直接抛 TypeError → 钱包配置解析静默失效
        // （用户新增的基金/股票重启后丢失）。基类判断可同时覆盖两种子类。
        if (o instanceof JSONObject) return ((JSONObject) o).toString();
        if (o instanceof JSONArray) return ((JSONArray) o).toString();
        if (o instanceof Boolean || o instanceof Number) return o.toString();
        if (o instanceof String) {
            String s = (String) o;
            // 兜底：若拿到的字符串本身已是一段合法 JSON 对象/数组文本（某些 Capacitor
            // 调用路径会先把结构化值压成文本），按原样存储，避免再次 quote。
            String t = s.trim();
            if (isJsonStructure(t)) return t;
            return JSONObject.quote(s);
        }
        return JSONObject.quote(String.valueOf(o));
    }

    // 判断字符串本身是否是一段合法的 JSON 对象/数组文本（用于规避双重编码）
    private static boolean isJsonStructure(String t) {
        try {
            if (t.startsWith("{")) {
                new JSONObject(t);
                return true;
            }
            if (t.startsWith("[")) {
                new JSONArray(t);
                return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private static String csvCell(String s) {
        if (s == null) return "";
        if (s.contains(",") || s.contains("\"") || s.contains("\n")) {
            return "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }
}
