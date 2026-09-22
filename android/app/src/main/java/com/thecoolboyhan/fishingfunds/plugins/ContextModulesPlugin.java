package com.thecoolboyhan.fishingfunds.plugins;

import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.util.Base64;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

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
                InputStream in = (code >= 400 && conn.getErrorStream() != null) ? conn.getErrorStream() : conn.getInputStream();
                byte[] data = readAll(in);
                if (in != null) in.close();

                JSObject result = new JSObject();
                if ("json".equals(responseType)) {
                    result.put("body", parseJson(new String(data, StandardCharsets.UTF_8)));
                } else if ("arraybuffer".equals(responseType)) {
                    result.put("body", data);
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
                // 复刻 httpClient.ts：出错返回空对象 {}
                getActivity().runOnUiThread(() -> call.resolve(new JSObject()));
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
        JSObject value = call.getData().getJSObject("value");
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
                    if (first instanceof JSObject) {
                        JSObject row0 = (JSObject) first;
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
                        if (row instanceof JSObject) {
                            JSObject r = (JSObject) row;
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
        if (o == null) return "null";
        if (o instanceof JSObject) return ((JSObject) o).toString();
        if (o instanceof JSArray) return ((JSArray) o).toString();
        if (o instanceof Boolean || o instanceof Integer || o instanceof Double
            || o instanceof Long || o instanceof Float) return o.toString();
        if (o instanceof String) return JSONObject.quote((String) o);
        return JSONObject.quote(String.valueOf(o));
    }

    private static String csvCell(String s) {
        if (s == null) return "";
        if (s.contains(",") || s.contains("\"") || s.contains("\n")) {
            return "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }
}
